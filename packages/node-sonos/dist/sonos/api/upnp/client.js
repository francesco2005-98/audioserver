"use strict";
// Sonos S1 client, speaking UPnP/SOAP directly.
//
// Exposes the same `subscribe/connect/start/disconnect/player/groups` surface as
// the S2 SonosClient, so a consumer can switch backends on a single dispatcher
// decision. S1 firmware has no WebSocket API: state arrives through GENA events
// (see ./events) and commands go out as SOAP (see ./transport), with the household
// topology read from ZoneGroupTopology.
Object.defineProperty(exports, "__esModule", { value: true });
exports.S1Client = void 0;
const constants_1 = require("../../constants");
const errors_1 = require("../../errors");
const description_1 = require("./description");
const didl_1 = require("./didl");
const events_1 = require("./events");
const group_1 = require("./group");
const models_1 = require("./models");
const player_1 = require("./player");
const soap_1 = require("./soap");
const topology_1 = require("./topology");
const transport_1 = require("./transport");
class S1Client {
    player = null;
    playerId = '';
    householdId = '';
    playerIp;
    port;
    logger;
    positionPollIntervalMs;
    topologyPollIntervalMs;
    description = null;
    events = null;
    groupMap = new Map();
    zoneGroups = [];
    subscribers = [];
    positionPollTimer = null;
    topologyPollTimer = null;
    stopRequested = false;
    // Speaker state, kept current by the GENA events and primed on connect.
    transportState;
    volumeLevel;
    mutedState;
    constructor(playerIp, options = {}) {
        this.playerIp = playerIp;
        this.port = options.port ?? soap_1.SONOS_UPNP_PORT;
        this.logger = options.logger ?? console;
        this.positionPollIntervalMs = options.positionPollIntervalMs ?? 5_000;
        this.topologyPollIntervalMs = options.topologyPollIntervalMs ?? 30_000;
    }
    // -------- public surface (mirrors SonosClient) --------
    get groups() {
        return Array.from(this.groupMap.values());
    }
    subscribe(cb, eventFilter, objectIdFilter) {
        const eventSet = eventFilter == null
            ? undefined
            : Array.isArray(eventFilter)
                ? new Set(eventFilter)
                : new Set([eventFilter]);
        const objectSet = objectIdFilter == null
            ? undefined
            : Array.isArray(objectIdFilter)
                ? new Set(objectIdFilter)
                : new Set([objectIdFilter]);
        const sub = { cb, eventFilter: eventSet, objectIdFilter: objectSet };
        this.subscribers.push(sub);
        return () => {
            this.subscribers = this.subscribers.filter((s) => s !== sub);
        };
    }
    signalEvent(event) {
        for (const sub of this.subscribers) {
            if (sub.eventFilter && !sub.eventFilter.has(event.eventType))
                continue;
            if (sub.objectIdFilter && event.objectId && !sub.objectIdFilter.has(event.objectId)) {
                continue;
            }
            try {
                sub.cb(event);
            }
            catch (err) {
                this.logger.warn?.('S1 subscriber threw', err);
            }
        }
    }
    async connect() {
        this.stopRequested = false;
        const description = await (0, description_1.loadDeviceDescription)(this.playerIp, { port: this.port });
        this.description = description;
        this.playerId = description.uuid;
        // S1 has no household id of its own; consumers only compare these for equality,
        // so the player's own uuid is a stable enough stand-in.
        this.householdId = description.uuid;
        this.player = new player_1.S1SonosPlayer(this, {
            id: description.uuid,
            name: description.name,
            host: description.host,
        });
        await this.refreshTopology();
        await this.primeState();
        await this.startEvents();
        this.signalEvent({ eventType: constants_1.EventType.CONNECTED, objectId: this.playerId });
        this.startPositionPolling();
        this.startTopologyPolling();
    }
    /** Kept for parity with the S2 client, where it bootstraps the event listener. */
    async start() {
        /* no-op: connect() already subscribed */
    }
    async disconnect() {
        this.stopRequested = true;
        if (this.positionPollTimer) {
            clearInterval(this.positionPollTimer);
            this.positionPollTimer = null;
        }
        if (this.topologyPollTimer) {
            clearInterval(this.topologyPollTimer);
            this.topologyPollTimer = null;
        }
        this.events?.dispose();
        this.events = null;
        this.signalEvent({ eventType: constants_1.EventType.DISCONNECTED, objectId: this.playerId });
    }
    // -------- state the group adapter reads --------
    get currentTransportState() {
        return this.transportState;
    }
    get currentVolume() {
        return this.volumeLevel;
    }
    get currentMuted() {
        return this.mutedState;
    }
    /**
     * Run a transport command against a group's coordinator. Only the coordinator
     * accepts them; sending to a joined member is silently ignored by the speaker.
     */
    async runTransportCommand(groupId, command) {
        const { host, port } = this.coordinatorEndpointFor(groupId);
        await (0, transport_1.sendTransportCommand)(host, command, { port });
    }
    /**
     * Where to send a group's commands. The topology carries each member's own
     * address, which is what to trust — a household is normally all on 1400, but
     * nothing about the protocol says it has to be.
     */
    coordinatorEndpointFor(groupId) {
        const coordinator = this.zoneGroups.find((g) => g.groupId === groupId)?.coordinator;
        if (!coordinator?.host) {
            return { host: this.playerIp, port: this.port };
        }
        return { host: coordinator.host, port: coordinator.port || this.port };
    }
    // -------- topology --------
    async refreshTopology() {
        let zones;
        try {
            zones = await (0, topology_1.getZoneGroups)(this.playerIp, { port: this.port });
        }
        catch (err) {
            throw new errors_1.CannotConnect(`Sonos S1 GetZoneGroupState failed (${err.message})`, err instanceof Error ? err : undefined);
        }
        this.applyTopology(zones);
    }
    applyTopology(zones) {
        this.zoneGroups = zones;
        const seenIds = new Set();
        for (const zone of zones) {
            const seed = {
                id: zone.groupId,
                coordinatorId: zone.coordinator?.uuid ?? zone.groupId,
                name: zone.name,
                playerIds: zone.members.map((m) => m.uuid),
            };
            seenIds.add(seed.id);
            const existing = this.groupMap.get(seed.id);
            if (existing) {
                if (existing.updateSeed(seed)) {
                    this.signalEvent({
                        eventType: constants_1.EventType.GROUP_UPDATED,
                        objectId: existing.id,
                        data: existing,
                    });
                }
            }
            else {
                const group = new group_1.S1SonosGroup(this, seed);
                this.groupMap.set(group.id, group);
                this.signalEvent({
                    eventType: constants_1.EventType.GROUP_ADDED,
                    objectId: group.id,
                    data: group,
                });
            }
        }
        for (const id of Array.from(this.groupMap.keys())) {
            if (!seenIds.has(id)) {
                const removed = this.groupMap.get(id);
                this.groupMap.delete(id);
                if (removed) {
                    this.signalEvent({
                        eventType: constants_1.EventType.GROUP_REMOVED,
                        objectId: id,
                        data: removed,
                    });
                }
            }
        }
        this.resolveActiveGroup();
    }
    resolveActiveGroup() {
        if (!this.player)
            return;
        const found = this.groups.find((g) => g.coordinatorId === this.player.id || g.playerIds.includes(this.player.id)) ?? null;
        this.player.setActiveGroup(found);
    }
    startTopologyPolling() {
        if (this.topologyPollTimer || this.topologyPollIntervalMs <= 0)
            return;
        // ZoneGroupTopology events already report reshuffles; this only covers a NOTIFY
        // that never arrived. Cheap — one SOAP call.
        this.topologyPollTimer = setInterval(() => {
            if (this.stopRequested)
                return;
            void this.refreshTopology().catch(() => undefined);
        }, this.topologyPollIntervalMs);
        this.topologyPollTimer.unref?.();
    }
    // -------- initial state + event wiring --------
    /**
     * Events only report *changes*, so a speaker that has been sitting still since
     * before we subscribed would tell us nothing. Read the current state once.
     */
    async primeState() {
        const group = this.player?.group ?? null;
        const { host, port } = group
            ? this.coordinatorEndpointFor(group.id)
            : { host: this.playerIp, port: this.port };
        const [state, position, media, volume, muted] = await Promise.all([
            (0, transport_1.getTransportState)(host, { port }).catch(() => undefined),
            (0, transport_1.getPositionInfo)(host, { port }).catch(() => undefined),
            (0, transport_1.getMediaInfo)(host, { port }).catch(() => undefined),
            (0, transport_1.getVolume)(this.playerIp, { port: this.port }).catch(() => undefined),
            (0, transport_1.getMute)(this.playerIp, { port: this.port }).catch(() => undefined),
        ]);
        this.transportState = toTransportState(state);
        this.volumeLevel = volume;
        this.mutedState = muted;
        if (!group) {
            return;
        }
        if (position) {
            group.applyCurrentTrackUri(position.trackUri ?? '');
            group.applyCurrentTrack(this.parseTrack(position.trackMetadata, host));
            group.setPosition((0, didl_1.parseClockToSec)(position.relTime));
        }
        if (media) {
            group.applyEnqueuedTrackUri(media.currentUri ?? '');
            group.applyEnqueuedTrack(this.parseTrack(media.currentUriMetadata, host));
        }
        group.emitUpdated();
    }
    async startEvents() {
        const bridge = new events_1.S1EventBridge(this.playerIp, {
            onTransport: (event) => {
                if (event.transportState !== undefined) {
                    this.transportState = toTransportState(event.transportState);
                }
                const group = this.player?.group ?? null;
                if (!group)
                    return;
                if (event.currentTrackUri !== undefined) {
                    group.applyCurrentTrackUri(event.currentTrackUri);
                }
                if (event.currentTrackMetadata !== undefined) {
                    group.applyCurrentTrack(this.parseTrack(event.currentTrackMetadata, this.playerIp));
                }
                if (event.enqueuedTransportUri !== undefined) {
                    group.applyEnqueuedTrackUri(event.enqueuedTransportUri);
                }
                if (event.enqueuedTransportMetadata !== undefined) {
                    group.applyEnqueuedTrack(this.parseTrack(event.enqueuedTransportMetadata, this.playerIp));
                }
                group.emitUpdated();
            },
            onRendering: (event) => {
                if (event.volume !== undefined)
                    this.volumeLevel = event.volume;
                if (event.muted !== undefined)
                    this.mutedState = event.muted;
                this.player?.group?.emitUpdated();
            },
            onTopology: (groups) => {
                if (this.stopRequested)
                    return;
                this.applyTopology(groups);
            },
        }, { port: this.port, logger: this.logger });
        this.events = bridge;
        try {
            await bridge.start();
        }
        catch (err) {
            // Without events we still have the polls and the primed state, so this is a
            // degraded connection rather than a failed one.
            this.logger.warn?.('S1 event subscription failed; falling back to polling', {
                host: this.playerIp,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
    parseTrack(metadata, host) {
        return (0, didl_1.parseTrackMetadata)(metadata, { host, port: this.port });
    }
    // -------- position polling --------
    startPositionPolling() {
        if (this.positionPollTimer || this.positionPollIntervalMs <= 0)
            return;
        this.positionPollTimer = setInterval(() => {
            if (this.stopRequested)
                return;
            void this.refreshPosition();
        }, this.positionPollIntervalMs);
        this.positionPollTimer.unref?.();
    }
    async refreshPosition() {
        const group = this.player?.group ?? null;
        if (!group)
            return;
        if (this.transportState !== models_1.UpnpTransportState.Playing)
            return;
        try {
            const { host, port } = this.coordinatorEndpointFor(group.id);
            const position = await (0, transport_1.getPositionInfo)(host, { port });
            const seconds = (0, didl_1.parseClockToSec)(position.relTime);
            if (seconds !== null) {
                group.setPosition(seconds);
                group.emitUpdated();
            }
        }
        catch {
            // best-effort
        }
    }
}
exports.S1Client = S1Client;
function toTransportState(value) {
    if (!value)
        return undefined;
    const known = Object.values(models_1.UpnpTransportState);
    return known.includes(value) ? value : undefined;
}
