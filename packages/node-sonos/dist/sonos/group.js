"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SonosGroup = void 0;
const constants_1 = require("./constants");
const errors_1 = require("./errors");
const types_1 = require("./types");
const models_1 = require("./models");
class SonosGroup {
    client;
    data;
    activeSessionId = null;
    playbackStatus = null;
    playbackMetadata = null;
    playbackStatusUpdatedAt = 0;
    volumeData = null;
    playModes = new models_1.PlayModesWrapper({});
    playbackActions = new models_1.PlaybackActionsWrapper({});
    unsubscribeCallbacks = [];
    constructor(client, data) {
        this.client = client;
        this.data = data;
    }
    async init() {
        try {
            this.volumeData = await this.client.api.groupVolume.getVolume(this.id);
            this.playbackStatus = await this.client.api.playback.getPlaybackStatus(this.id);
            this.playbackStatusUpdatedAt = Date.now();
            this.playbackActions = new models_1.PlaybackActionsWrapper(this.playbackStatus.availablePlaybackActions ?? {});
            this.playModes = new models_1.PlayModesWrapper(this.playbackStatus.playModes ?? {});
            this.playbackMetadata = await this.client.api.playbackMetadata.getMetadataStatus(this.id);
            this.unsubscribeCallbacks = [
                await this.client.api.playback.subscribe(this.id, (data) => this.handlePlaybackStatusUpdate(data)),
                await this.client.api.groupVolume.subscribe(this.id, (data) => this.handleVolumeUpdate(data)),
                await this.client.api.playbackMetadata.subscribe(this.id, (data) => this.handleMetadataUpdate(data)),
            ];
        }
        catch (err) {
            if (err instanceof errors_1.FailedCommand && err.errorCode === 'groupCoordinatorChanged') {
                this.volumeData = null;
                this.playbackStatus = null;
                this.playbackActions = new models_1.PlaybackActionsWrapper({});
                this.playModes = new models_1.PlayModesWrapper({});
                this.playbackMetadata = null;
                return;
            }
            throw err;
        }
        this.client.signalEvent({
            eventType: constants_1.EventType.GROUP_ADDED,
            objectId: this.id,
            data: this,
        });
    }
    cleanup() {
        for (const cb of this.unsubscribeCallbacks)
            cb();
        this.unsubscribeCallbacks = [];
    }
    get id() {
        return this.data.id;
    }
    get name() {
        return this.data.name;
    }
    get coordinatorId() {
        return this.data.coordinatorId;
    }
    get playerIds() {
        return this.data.playerIds;
    }
    get areaIds() {
        return this.data.areaIds ?? [];
    }
    get playbackState() {
        return (this.playbackStatus?.playbackState ??
            this.data.playbackState ??
            types_1.PlayBackState.IDLE);
    }
    get playbackMetadataStatus() {
        return this.playbackMetadata;
    }
    get playbackActionsWrapper() {
        return this.playbackActions;
    }
    get playModesWrapper() {
        return this.playModes;
    }
    get positionSeconds() {
        if (!this.playbackStatus)
            return 0;
        if (this.playbackState === types_1.PlayBackState.PLAYING) {
            const elapsed = (Date.now() - this.playbackStatusUpdatedAt) / 1000;
            return (this.playbackStatus.positionMillis ?? 0) / 1000 + elapsed;
        }
        return (this.playbackStatus.positionMillis ?? 0) / 1000;
    }
    get isDucking() {
        return this.playbackStatus?.isDucking ?? false;
    }
    get activeService() {
        return (0, models_1.normalizeMusicService)(this.playbackMetadata?.container?.id?.serviceId);
    }
    get containerType() {
        return (0, models_1.normalizeContainerType)(this.playbackMetadata?.container?.type);
    }
    async play() {
        await this.client.api.playback.play(this.id);
    }
    async pause() {
        await this.client.api.playback.pause(this.id);
    }
    async stop() {
        try {
            if (this.activeSessionId) {
                await this.client.api.playbackSession.suspend(this.activeSessionId);
            }
        }
        catch (err) {
            if (!(err instanceof errors_1.FailedCommand))
                throw err;
            try {
                await this.playStreamUrl('clear');
            }
            catch {
                // ignore
            }
        }
        finally {
            this.activeSessionId = null;
        }
    }
    async togglePlayPause() {
        await this.client.api.playback.togglePlayPause(this.id);
    }
    async skipToNextTrack() {
        await this.client.api.playback.skipToNextTrack(this.id);
    }
    async skipToPreviousTrack() {
        await this.client.api.playback.skipToPreviousTrack(this.id);
    }
    async setPlayModes(options) {
        await this.client.api.playback.setPlayModes(this.id, options);
    }
    async seek(positionMillis) {
        await this.client.api.playback.seek(this.id, positionMillis);
    }
    async seekRelative(deltaMillis) {
        await this.client.api.playback.seekRelative(this.id, deltaMillis);
    }
    async loadLineIn(deviceId, playOnCompletion = false) {
        await this.client.api.playback.loadLineIn(this.id, deviceId, playOnCompletion);
    }
    async modifyGroupMembers(playerIdsToAdd, playerIdsToRemove) {
        await this.client.api.groups.modifyGroupMembers(this.id, playerIdsToAdd, playerIdsToRemove);
    }
    async setGroupMembers(playerIds, areaIds) {
        await this.client.api.groups.setGroupMembers(this.id, playerIds, areaIds);
    }
    async createPlaybackSession(appId = 'com.lox.sonos.playback', appContext = '1', accountId, customData) {
        const session = await this.client.api.playbackSession.createSession(this.id, appId, appContext, accountId, customData);
        this.activeSessionId = session.sessionId;
        return session;
    }
    async playStreamUrl(url, metadata) {
        await this.ensureSession();
        if (!this.activeSessionId)
            throw new Error('No active session');
        await this.client.api.playbackSession.loadStreamUrl(this.activeSessionId, url, {
            playOnCompletion: true,
            stationMetadata: metadata,
        });
    }
    async playCloudQueue(queueBaseUrl, options) {
        await this.ensureSession();
        if (!this.activeSessionId)
            throw new Error('No active session');
        await this.client.api.playbackSession.loadCloudQueue(this.activeSessionId, queueBaseUrl, {
            ...options,
            playOnCompletion: true,
        });
    }
    updateData(newData) {
        let changed = false;
        for (const [key, value] of Object.entries(newData)) {
            if (this.data[key] !== value) {
                this.data[key] = value;
                changed = true;
            }
        }
        if (changed) {
            this.client.signalEvent({
                eventType: constants_1.EventType.GROUP_UPDATED,
                objectId: this.id,
                data: this,
            });
        }
    }
    async ensureSession() {
        if (!this.activeSessionId) {
            await this.createPlaybackSession();
        }
    }
    handlePlaybackStatusUpdate(data) {
        this.playbackStatus = data;
        this.playbackStatusUpdatedAt = Date.now();
        this.playbackActions = new models_1.PlaybackActionsWrapper(data.availablePlaybackActions ?? {});
        this.playModes = new models_1.PlayModesWrapper(data.playModes ?? {});
        this.client.signalEvent({
            eventType: constants_1.EventType.GROUP_UPDATED,
            objectId: this.id,
            data: this,
        });
    }
    handleMetadataUpdate(data) {
        this.playbackMetadata = data;
        this.client.signalEvent({
            eventType: constants_1.EventType.GROUP_UPDATED,
            objectId: this.id,
            data: this,
        });
    }
    handleVolumeUpdate(data) {
        this.volumeData = data;
        this.client.signalEvent({
            eventType: constants_1.EventType.GROUP_UPDATED,
            objectId: this.id,
            data: this,
        });
    }
}
exports.SonosGroup = SonosGroup;
