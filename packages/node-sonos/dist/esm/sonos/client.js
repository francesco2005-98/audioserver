"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SonosClient = void 0;
const websocket_1 = require("./api/websocket");
const constants_1 = require("./constants");
const errors_1 = require("./errors");
const group_1 = require("./group");
const player_1 = require("./player");
const utils_1 = require("./utils");
class SonosClient {
    playerIp;
    api;
    playerId;
    householdId;
    player = null;
    groupMap = new Map();
    subscribers = [];
    logger;
    bootstrapPromise = null;
    connectedPlayerIds = new Set();
    constructor(playerIp, options = {}) {
        this.playerIp = playerIp;
        this.logger = options.logger ?? console;
    }
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
        const sub = {
            cb,
            eventFilter: eventSet,
            objectIdFilter: objectSet,
        };
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
            sub.cb(event);
        }
    }
    async connect(options) {
        let discovery;
        try {
            discovery = await (0, utils_1.getDiscoveryInfo)(this.playerIp, options);
        }
        catch (err) {
            this.logger.warn?.('Sonos discovery failed', {
                playerIp: this.playerIp,
                message: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
        this.logger.debug?.('Sonos discovery info', {
            playerIp: this.playerIp,
            playerId: discovery.playerId,
            householdId: discovery.householdId,
            websocketUrl: discovery.websocketUrl,
        });
        this.playerId = discovery.playerId;
        this.householdId = discovery.householdId;
        this.api = new websocket_1.SonosWebSocketApi(discovery.websocketUrl, {
            heartbeatIntervalMs: options?.heartbeatIntervalMs,
            retryDelayMs: options?.retryDelayMs,
            retryJitterMs: options?.retryJitterMs,
            maxReconnects: options?.maxReconnects,
        });
        if (options?.logger)
            this.api.logger = options.logger;
        this.api.onConnect = () => this.handleSocketConnected();
        this.api.onDisconnect = (reason) => this.handleSocketDisconnected(reason);
        await this.api.connect();
    }
    async disconnect() {
        for (const group of this.groupMap.values()) {
            group.cleanup();
        }
        await this.api.disconnect();
    }
    async start() {
        await this.bootstrap();
        await this.api.startListening();
    }
    async bootstrap(reconnect = false) {
        if (this.bootstrapPromise)
            return this.bootstrapPromise;
        this.bootstrapPromise = (async () => {
            if (!this.api || !this.api.connected) {
                await this.connect();
            }
            if (reconnect || this.groupMap.size) {
                for (const group of this.groupMap.values())
                    group.cleanup();
                this.groupMap.clear();
            }
            const groupsData = await this.api.groups.getGroups(this.householdId, true);
            for (const groupData of groupsData.groups) {
                await this.setupGroup(groupData);
            }
            const playerData = groupsData.players.find((p) => p.id === this.playerId);
            if (!playerData) {
                throw new errors_1.FailedCommand('playerNotFound', 'Local player not returned in groups response');
            }
            this.player = new player_1.SonosPlayer(this, playerData);
            await this.player.init();
            this.connectedPlayerIds = new Set(groupsData.players.map((p) => p.id));
            await this.api.groups.subscribe(this.householdId, (data) => this.handleGroupsEvent(data));
            this.signalEvent({ eventType: constants_1.EventType.CONNECTED, objectId: this.playerId });
        })();
        try {
            await this.bootstrapPromise;
        }
        finally {
            this.bootstrapPromise = null;
        }
    }
    async createGroup(playerIds, musicContextGroupId) {
        await this.api.groups.createGroup(this.householdId, playerIds, musicContextGroupId);
    }
    async setupGroup(groupData) {
        const group = new group_1.SonosGroup(this, groupData);
        this.groupMap.set(group.id, group);
        await group.init();
        if (this.player)
            this.player.checkActiveGroup();
    }
    handleGroupsEvent(groupsData) {
        for (const groupData of groupsData.groups) {
            const existing = this.groupMap.get(groupData.id);
            if (existing) {
                existing.updateData(groupData);
                continue;
            }
            void this.setupGroup(groupData);
        }
        const removedIds = new Set(this.groupMap.keys());
        for (const g of groupsData.groups)
            removedIds.delete(g.id);
        for (const removedId of removedIds) {
            const group = this.groupMap.get(removedId);
            group?.cleanup();
            this.groupMap.delete(removedId);
            this.signalEvent({
                eventType: constants_1.EventType.GROUP_REMOVED,
                objectId: removedId,
                data: group,
            });
        }
        const incomingPlayers = new Set(groupsData.players.map((p) => p.id));
        // removals
        for (const prev of Array.from(this.connectedPlayerIds)) {
            if (!incomingPlayers.has(prev)) {
                this.signalEvent({
                    eventType: constants_1.EventType.PLAYER_REMOVED,
                    objectId: prev,
                    data: prev,
                });
                this.connectedPlayerIds.delete(prev);
            }
        }
        // updates/additions
        for (const playerData of groupsData.players) {
            if (playerData.id === this.playerId && this.player) {
                this.player.updateData(playerData);
            }
            if (!this.connectedPlayerIds.has(playerData.id)) {
                this.connectedPlayerIds.add(playerData.id);
                this.signalEvent({
                    eventType: constants_1.EventType.PLAYER_ADDED,
                    objectId: playerData.id,
                    data: playerData,
                });
            }
        }
        // Re-resolve the local player's active group after any groups-event change.
        // Without this, the cached activeGroup goes stale when Sonos reshuffles
        // groups (e.g. after pause), causing follow-up commands to be dropped.
        this.player?.checkActiveGroup();
    }
    async handleSocketConnected() {
        try {
            await this.bootstrap(true);
        }
        catch (err) {
            this.logger.error?.('Failed to bootstrap after reconnect', err);
        }
    }
    handleSocketDisconnected(reason) {
        this.signalEvent({
            eventType: constants_1.EventType.DISCONNECTED,
            objectId: this.playerId,
            data: reason,
        });
    }
}
exports.SonosClient = SonosClient;
