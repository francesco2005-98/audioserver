"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupVolumeNamespace = void 0;
const namespace_1 = require("../namespace");
class GroupVolumeNamespace extends namespace_1.SonosNamespace {
    constructor(api) {
        super(api, 'groupVolume', 'groupVolume', 'groupId');
    }
    async setVolume(groupId, volume) {
        await this.api.sendCommand(this.namespace, 'setVolume', { volume }, { groupId });
    }
    async getVolume(groupId) {
        return this.api.sendCommand(this.namespace, 'getVolume', undefined, { groupId });
    }
    async setMute(groupId, muted) {
        await this.api.sendCommand(this.namespace, 'setMute', { muted }, { groupId });
    }
    async setRelativeVolume(groupId, volumeDelta) {
        await this.api.sendCommand(this.namespace, 'setRelativeVolume', { volumeDelta }, { groupId });
    }
    async subscribe(groupId, callback) {
        return this.handleSubscribe(groupId, callback);
    }
}
exports.GroupVolumeNamespace = GroupVolumeNamespace;
