"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaybackMetadataNamespace = void 0;
const namespace_1 = require("../namespace");
class PlaybackMetadataNamespace extends namespace_1.SonosNamespace {
    constructor(api) {
        super(api, 'playbackMetadata', 'metadataStatus', 'groupId');
    }
    async getMetadataStatus(groupId) {
        return this.api.sendCommand(this.namespace, 'getMetadataStatus', undefined, { groupId });
    }
    async subscribe(groupId, callback) {
        return this.handleSubscribe(groupId, callback);
    }
}
exports.PlaybackMetadataNamespace = PlaybackMetadataNamespace;
