"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaybackSessionNamespace = void 0;
const namespace_1 = require("../namespace");
class PlaybackSessionNamespace extends namespace_1.SonosNamespace {
    constructor(api) {
        super(api, 'playbackSession', 'playbackSession', 'sessionId');
    }
    async createSession(groupId, appId, appContext, accountId, customData) {
        const options = { appId, appContext };
        if (accountId)
            options.accountId = accountId;
        if (customData)
            options.customData = customData;
        return this.api.sendCommand(this.namespace, 'createSession', options, { groupId });
    }
    async loadCloudQueue(sessionId, queueBaseUrl, options) {
        await this.api.sendCommand(this.namespace, 'loadCloudQueue', {
            queueBaseUrl,
            httpAuthorization: options.httpAuthorization,
            useHttpAuthorizationForMedia: options.useHttpAuthorizationForMedia,
            itemId: options.itemId,
            queueVersion: options.queueVersion,
            positionMillis: options.positionMillis,
            playOnCompletion: options.playOnCompletion,
            trackMetadata: options.trackMetadata,
        }, { sessionId });
    }
    async loadStreamUrl(sessionId, streamUrl, options = {}) {
        await this.api.sendCommand(this.namespace, 'loadStreamUrl', {
            streamUrl,
            playOnCompletion: options.playOnCompletion,
            stationMetadata: options.stationMetadata,
            itemId: options.itemId,
        }, { sessionId });
    }
    async refreshCloudQueue(sessionId) {
        await this.api.sendCommand(this.namespace, 'refreshCloudQueue', undefined, { sessionId });
    }
    async seek(sessionId, positionMillis, itemId) {
        const options = { positionMillis };
        if (itemId)
            options.itemId = itemId;
        await this.api.sendCommand(this.namespace, 'seek', options, { sessionId });
    }
    async seekRelative(sessionId, deltaMillis, itemId) {
        const options = { deltaMillis };
        if (itemId)
            options.itemId = itemId;
        await this.api.sendCommand(this.namespace, 'seekRelative', options, { sessionId });
    }
    async skipToItem(sessionId, itemId, options = {}) {
        await this.api.sendCommand(this.namespace, 'skipToItem', {
            itemId,
            queueVersion: options.queueVersion,
            positionMillis: options.positionMillis,
            playOnCompletion: options.playOnCompletion,
        }, { sessionId });
    }
    async suspend(sessionId, queueVersion) {
        await this.api.sendCommand(this.namespace, 'suspend', queueVersion ? { queueVersion } : undefined, { sessionId });
    }
    async subscribe(sessionId, callback) {
        return this.handleSubscribe(sessionId, callback);
    }
}
exports.PlaybackSessionNamespace = PlaybackSessionNamespace;
