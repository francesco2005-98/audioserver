"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaybackNamespace = void 0;
const namespace_1 = require("../namespace");
class PlaybackNamespace extends namespace_1.SonosNamespace {
    constructor(api) {
        super(api, 'playback', 'playbackStatus', 'groupId');
    }
    async getPlaybackStatus(groupId) {
        return this.api.sendCommand(this.namespace, 'getPlaybackStatus', undefined, { groupId });
    }
    async loadLineIn(groupId, deviceId, playOnCompletion = false) {
        const options = {};
        if (deviceId)
            options.deviceId = deviceId;
        options.playOnCompletion = playOnCompletion;
        await this.api.sendCommand(this.namespace, 'loadLineIn', options, { groupId });
    }
    async loadContent(groupId, content) {
        await this.api.sendCommand(this.namespace, 'loadContent', content, { groupId });
    }
    async pause(groupId) {
        await this.api.sendCommand(this.namespace, 'pause', undefined, { groupId });
    }
    async play(groupId) {
        await this.api.sendCommand(this.namespace, 'play', undefined, { groupId });
    }
    async togglePlayPause(groupId) {
        await this.api.sendCommand(this.namespace, 'togglePlayPause', undefined, { groupId });
    }
    async setPlayModes(groupId, playModes) {
        await this.api.sendCommand(this.namespace, 'setPlayModes', { playModes }, { groupId });
    }
    async seek(groupId, positionMillis, itemId) {
        const options = { positionMillis };
        if (itemId)
            options.itemId = itemId;
        await this.api.sendCommand(this.namespace, 'seek', options, { groupId });
    }
    async seekRelative(groupId, deltaMillis, itemId) {
        const options = { deltaMillis };
        if (itemId)
            options.itemId = itemId;
        await this.api.sendCommand(this.namespace, 'seekRelative', options, { groupId });
    }
    async skipToNextTrack(groupId) {
        await this.api.sendCommand(this.namespace, 'skipToNextTrack', undefined, { groupId });
    }
    async skipToPreviousTrack(groupId) {
        await this.api.sendCommand(this.namespace, 'skipToPreviousTrack', undefined, { groupId });
    }
    async subscribe(groupId, callback) {
        return this.handleSubscribe(groupId, callback);
    }
}
exports.PlaybackNamespace = PlaybackNamespace;
