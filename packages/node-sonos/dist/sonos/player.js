"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SonosPlayer = void 0;
const constants_1 = require("./constants");
class SonosPlayer {
    client;
    data;
    volumeData = null;
    activeGroup = null;
    constructor(client, data) {
        this.client = client;
        this.data = data;
        this.activeGroup = this.client.groups.find((g) => g.coordinatorId === this.id || g.playerIds.includes(this.id)) ?? null;
    }
    async init() {
        this.volumeData = await this.client.api.playerVolume.getVolume(this.id);
        await this.client.api.playerVolume.subscribe(this.id, (data) => this.handleVolumeUpdate(data));
    }
    get id() {
        return this.data.id;
    }
    get name() {
        return this.data.name;
    }
    get icon() {
        return this.data.icon ?? '';
    }
    get volumeLevel() {
        return this.volumeData?.volume;
    }
    get volumeMuted() {
        return this.volumeData?.muted;
    }
    get hasFixedVolume() {
        return this.volumeData?.fixed;
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
    async setVolume(volume, muted) {
        await this.client.api.playerVolume.setVolume(this.id, volume, muted);
    }
    async duck(durationMillis) {
        await this.client.api.playerVolume.duck(this.id, durationMillis);
    }
    async leaveGroup() {
        if (!this.group)
            return;
        await this.client.api.groups.modifyGroupMembers(this.group.id, [], [this.id]);
    }
    async joinGroup(groupId) {
        await this.client.api.groups.modifyGroupMembers(groupId, [this.id], []);
    }
    async playAudioClip(url, options = {}) {
        await this.client.api.audioClip.loadAudioClip(this.id, {
            name: options.name ?? 'lox-sonos',
            appId: 'lox-sonos',
            streamUrl: url,
            volume: options.volume,
        });
    }
    async loadHomeTheaterPlayback() {
        await this.client.api.homeTheater.loadHomeTheaterPlayback(this.id);
    }
    updateData(newData) {
        this.checkActiveGroup();
        let changed = false;
        for (const [key, value] of Object.entries(newData)) {
            if (this.data[key] !== value) {
                this.data[key] = value;
                changed = true;
            }
        }
        if (changed) {
            this.client.signalEvent({
                eventType: constants_1.EventType.PLAYER_UPDATED,
                objectId: this.id,
                data: this,
            });
        }
    }
    checkActiveGroup() {
        const prevGroupId = this.activeGroup?.id;
        this.activeGroup =
            this.client.groups.find((g) => g.coordinatorId === this.id || g.playerIds.includes(this.id)) ?? null;
        if (prevGroupId !== this.activeGroup?.id) {
            this.client.signalEvent({
                eventType: constants_1.EventType.PLAYER_UPDATED,
                objectId: this.id,
                data: this,
            });
        }
    }
    handleVolumeUpdate(data) {
        this.volumeData = data;
        this.client.signalEvent({
            eventType: constants_1.EventType.PLAYER_UPDATED,
            objectId: this.id,
            data: this,
        });
    }
}
exports.SonosPlayer = SonosPlayer;
