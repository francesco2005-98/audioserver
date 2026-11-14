"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioClipNamespace = void 0;
const namespace_1 = require("../namespace");
class AudioClipNamespace extends namespace_1.SonosNamespace {
    constructor(api) {
        super(api, 'audioClip', 'audioClip', 'playerId');
    }
    async loadAudioClip(playerId, options) {
        return this.api.sendCommand(this.namespace, 'loadAudioClip', {
            name: options.name,
            appId: options.appId,
            priority: options.priority,
            clipType: options.clipType,
            streamUrl: options.streamUrl,
            httpAuthorization: options.httpAuthorization,
            volume: options.volume,
            clipLEDBehavior: options.clipLEDBehavior,
        }, { playerId });
    }
    async subscribe(playerId, callback) {
        return this.handleSubscribe(playerId, callback);
    }
}
exports.AudioClipNamespace = AudioClipNamespace;
