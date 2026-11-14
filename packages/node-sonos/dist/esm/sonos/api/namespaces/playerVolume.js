"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayerVolumeNamespace = void 0;
const namespace_1 = require("../namespace");
class PlayerVolumeNamespace extends namespace_1.SonosNamespace {
    constructor(api) {
        super(api, 'playerVolume', 'playerVolume', 'playerId');
    }
    async setVolume(playerId, volume, muted) {
        const options = {};
        if (typeof volume === 'number')
            options.volume = volume;
        if (typeof muted === 'boolean')
            options.muted = muted;
        await this.api.sendCommand(this.namespace, 'setVolume', options, { playerId });
    }
    async getVolume(playerId) {
        return this.api.sendCommand(this.namespace, 'getVolume', undefined, { playerId });
    }
    async duck(playerId, durationMillis) {
        await this.api.sendCommand(this.namespace, 'duck', durationMillis ? { durationMillis } : undefined, { playerId });
    }
    async unduck(playerId) {
        await this.api.sendCommand(this.namespace, 'unduck', undefined, { playerId });
    }
    async setMute(playerId, muted) {
        await this.api.sendCommand(this.namespace, 'setMute', { muted }, { playerId });
    }
    async setRelativeVolume(playerId, volumeDelta, muted) {
        const options = {};
        if (typeof volumeDelta === 'number')
            options.volumeDelta = volumeDelta;
        if (typeof muted === 'boolean')
            options.muted = muted;
        await this.api.sendCommand(this.namespace, 'setRelativeVolume', options, { playerId });
    }
    async subscribe(playerId, callback) {
        return this.handleSubscribe(playerId, callback);
    }
}
exports.PlayerVolumeNamespace = PlayerVolumeNamespace;
