"use strict";
// S1-backed equivalent of SonosPlayer.
Object.defineProperty(exports, "__esModule", { value: true });
exports.S1SonosPlayer = void 0;
const constants_1 = require("../../constants");
class S1SonosPlayer {
    client;
    seed;
    activeGroup = null;
    constructor(client, seed) {
        this.client = client;
        this.seed = seed;
    }
    get id() {
        return this.seed.id;
    }
    get name() {
        return this.seed.name;
    }
    get host() {
        return this.seed.host;
    }
    get icon() {
        return '';
    }
    get group() {
        return this.activeGroup;
    }
    get groupMembers() {
        return this.group?.playerIds ?? [];
    }
    get isCoordinator() {
        return Boolean(this.group && this.group.coordinatorId === this.id);
    }
    get isPassive() {
        return Boolean(this.group && this.group.coordinatorId !== this.id);
    }
    // Unimplemented on S1 — callers in lox-audioserver catch the rejection and
    // fall back to their own SOAP path.
    async leaveGroup() {
        throw new Error('S1: leaveGroup not implemented; use direct SOAP via consumer');
    }
    async joinGroup(groupId) {
        // Joining on S1 means pointing this player's transport at the coordinator
        // (`x-rincon:<uuid>`), which the consumer's own SOAP path already does with the
        // grouping semantics it wants. Leave it to them rather than guessing here.
        void groupId;
        throw new Error('S1: joinGroup not implemented; use direct SOAP via consumer');
    }
    async setVolume(_volume, _muted) {
        throw new Error('S1: per-player setVolume not implemented; use group volume');
    }
    updateSeed(seed) {
        let changed = false;
        if (this.seed.name !== seed.name) {
            this.seed.name = seed.name;
            changed = true;
        }
        if (this.seed.host !== seed.host) {
            this.seed.host = seed.host;
            changed = true;
        }
        return changed;
    }
    setActiveGroup(group) {
        const prevId = this.activeGroup?.id ?? null;
        this.activeGroup = group;
        if (prevId !== (group?.id ?? null)) {
            this.client.signalEvent({
                eventType: constants_1.EventType.PLAYER_UPDATED,
                objectId: this.id,
                data: this,
            });
        }
    }
    notifyUpdated() {
        this.client.signalEvent({
            eventType: constants_1.EventType.PLAYER_UPDATED,
            objectId: this.id,
            data: this,
        });
    }
}
exports.S1SonosPlayer = S1SonosPlayer;
