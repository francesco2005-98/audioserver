export class CastStatusModel {
    isActiveInput;
    isStandBy;
    volumeLevel;
    volumeMuted;
    appId;
    displayName;
    namespaces;
    sessionId;
    transportId;
    statusText;
    iconUrl;
    volumeControlType;
    constructor(isActiveInput, isStandBy, volumeLevel, volumeMuted, appId, displayName, namespaces, sessionId, transportId, statusText, iconUrl, volumeControlType) {
        this.isActiveInput = isActiveInput;
        this.isStandBy = isStandBy;
        this.volumeLevel = volumeLevel;
        this.volumeMuted = volumeMuted;
        this.appId = appId;
        this.displayName = displayName;
        this.namespaces = namespaces;
        this.sessionId = sessionId;
        this.transportId = transportId;
        this.statusText = statusText;
        this.iconUrl = iconUrl;
        this.volumeControlType = volumeControlType;
    }
    static fromReceiverStatus(message) {
        const statusData = message.status ?? {};
        const volume = statusData.volume ?? {};
        const app = statusData.applications?.[0];
        const namespaces = app?.namespaces?.map((item) => item.name) ?? [];
        return new CastStatusModel(statusData.isActiveInput ?? null, statusData.isStandBy ?? null, volume.level ?? 1.0, volume.muted ?? false, app?.appId ?? null, app?.displayName ?? null, namespaces, app?.sessionId ?? null, app?.transportId ?? null, app?.statusText ?? '', app?.iconUrl ?? null, volume.controlType ?? 'attenuation');
    }
}
export const MediaCommandFlags = {
    SUPPORT_PAUSE: 1,
    SUPPORT_SEEK: 2,
    SUPPORT_STREAM_VOLUME: 4,
    SUPPORT_STREAM_MUTE: 8,
    SUPPORT_SKIP_FORWARD: 16,
    SUPPORT_SKIP_BACKWARD: 32,
    SUPPORT_QUEUE_NEXT: 64,
    SUPPORT_QUEUE_PREV: 128,
    SUPPORT_QUEUE_SHUFFLE: 256,
    SUPPORT_SKIP_AD: 512,
    SUPPORT_QUEUE_REPEAT_ALL: 1024,
    SUPPORT_QUEUE_REPEAT_ONE: 2048,
    SUPPORT_QUEUE_REPEAT: 3072,
    SUPPORT_EDIT_TRACKS: 4096,
    SUPPORT_PLAYBACK_RATE: 8192,
    SUPPORT_LIKE: 16384,
    SUPPORT_DISLIKE: 32768,
    SUPPORT_FOLLOW: 65536,
    SUPPORT_UNFOLLOW: 131072,
    SUPPORT_STREAM_TRANSFER: 262144,
};
export class MediaStatusModel {
    currentTime = 0;
    contentId = null;
    contentType = null;
    duration = null;
    streamType = 'UNKNOWN';
    idleReason = null;
    mediaSessionId = null;
    playbackRate = 1;
    playerState = 'UNKNOWN';
    supportedMediaCommands = 0;
    volumeLevel = 1;
    volumeMuted = false;
    mediaCustomData = {};
    mediaMetadata = {};
    subtitleTracks = [];
    currentSubtitleTracks = [];
    lastUpdated = null;
    static fromMessage(message) {
        const model = new MediaStatusModel();
        model.update(message);
        return model;
    }
    update(message) {
        const statusData = message.status?.[0];
        if (!statusData) {
            return;
        }
        const mediaData = (statusData.media ?? {});
        const volume = statusData.volume ?? {};
        if (statusData.currentTime !== undefined) {
            this.currentTime = statusData.currentTime;
        }
        if (mediaData.contentId !== undefined) {
            this.contentId = mediaData.contentId;
        }
        if (mediaData.contentType !== undefined) {
            this.contentType = mediaData.contentType;
        }
        if (mediaData.duration !== undefined) {
            this.duration = mediaData.duration;
        }
        if (mediaData.streamType !== undefined) {
            this.streamType = mediaData.streamType;
        }
        if (statusData.idleReason !== undefined) {
            this.idleReason = statusData.idleReason ?? null;
        }
        if (statusData.mediaSessionId !== undefined) {
            this.mediaSessionId = statusData.mediaSessionId;
        }
        if (statusData.playbackRate !== undefined) {
            this.playbackRate = statusData.playbackRate;
        }
        if (statusData.playerState !== undefined) {
            this.playerState = statusData.playerState;
        }
        if (statusData.supportedMediaCommands !== undefined) {
            this.supportedMediaCommands = statusData.supportedMediaCommands;
        }
        if (volume.level !== undefined) {
            this.volumeLevel = volume.level;
        }
        if (volume.muted !== undefined) {
            this.volumeMuted = volume.muted;
        }
        if (mediaData.customData !== undefined) {
            this.mediaCustomData = mediaData.customData ?? {};
        }
        if (mediaData.metadata !== undefined) {
            this.mediaMetadata = mediaData.metadata ?? {};
        }
        if (mediaData.tracks !== undefined) {
            this.subtitleTracks = mediaData.tracks ?? [];
        }
        if (statusData.activeTrackIds !== undefined) {
            this.currentSubtitleTracks = statusData.activeTrackIds ?? [];
        }
        this.lastUpdated = new Date();
    }
    get adjustedCurrentTime() {
        if (this.currentTime !== null &&
            this.lastUpdated &&
            (this.playerState === 'PLAYING' || this.playerState === 'BUFFERING')) {
            const deltaSeconds = (Date.now() - this.lastUpdated.getTime()) / 1000;
            return this.currentTime + this.playbackRate * deltaSeconds;
        }
        return this.currentTime;
    }
    get metadataType() {
        return this.mediaMetadata['metadataType'];
    }
    get playerIsPlaying() {
        return this.playerState === 'PLAYING' || this.playerState === 'BUFFERING';
    }
    get playerIsPaused() {
        return this.playerState === 'PAUSED';
    }
    get playerIsIdle() {
        return this.playerState === 'IDLE';
    }
    get streamTypeIsBuffered() {
        return this.streamType === 'BUFFERED';
    }
    get streamTypeIsLive() {
        return this.streamType === 'LIVE';
    }
    get title() {
        return this.mediaMetadata['title'];
    }
    get seriesTitle() {
        return this.mediaMetadata['seriesTitle'];
    }
    get season() {
        return this.mediaMetadata['season'];
    }
    get episode() {
        return this.mediaMetadata['episode'];
    }
    get artist() {
        return this.mediaMetadata['artist'];
    }
    get albumName() {
        return this.mediaMetadata['albumName'];
    }
    get albumArtist() {
        return this.mediaMetadata['albumArtist'];
    }
    get track() {
        return this.mediaMetadata['track'];
    }
    get images() {
        const images = this.mediaMetadata['images'] ?? [];
        return images.map((item) => ({
            url: item['url'] ?? null,
            height: item['height'] ?? null,
            width: item['width'] ?? null,
        }));
    }
    get supportsPause() {
        return this.supportedMediaCommandsHas(MediaCommandFlags.SUPPORT_PAUSE);
    }
    get supportsSeek() {
        return this.supportedMediaCommandsHas(MediaCommandFlags.SUPPORT_SEEK);
    }
    get supportsStreamVolume() {
        return this.supportedMediaCommandsHas(MediaCommandFlags.SUPPORT_STREAM_VOLUME);
    }
    get supportsStreamMute() {
        return this.supportedMediaCommandsHas(MediaCommandFlags.SUPPORT_STREAM_MUTE);
    }
    get supportsSkipForward() {
        return this.supportedMediaCommandsHas(MediaCommandFlags.SUPPORT_SKIP_FORWARD);
    }
    get supportsSkipBackward() {
        return this.supportedMediaCommandsHas(MediaCommandFlags.SUPPORT_SKIP_BACKWARD);
    }
    get supportsQueueNext() {
        return this.supportedMediaCommandsHas(MediaCommandFlags.SUPPORT_QUEUE_NEXT);
    }
    get supportsQueuePrev() {
        return this.supportedMediaCommandsHas(MediaCommandFlags.SUPPORT_QUEUE_PREV);
    }
    supportedMediaCommandsHas(flag) {
        return (this.supportedMediaCommands & flag) !== 0;
    }
}
