import { Namespaces } from '../protocol/namespaces.js';
import { BaseController } from './baseController.js';
import { MediaStatusModel } from '../core/models.js';
import { ProtocolError } from '../utils/errors.js';
export class MediaController extends BaseController {
    status;
    statusModel;
    constructor(channel, destinationId = 'receiver-0') {
        super(channel, Namespaces.MEDIA, 'sender-0', destinationId);
    }
    handleMessage(message) {
        const payload = message;
        if (payload.type === 'MEDIA_STATUS') {
            this.status = payload;
            if (!this.statusModel) {
                this.statusModel = MediaStatusModel.fromMessage(payload);
            }
            else {
                this.statusModel.update(payload);
            }
            this.emit('status', payload);
            this.emit('statusModel', this.statusModel);
        }
    }
    async getStatus(timeoutMs = 5000) {
        const response = await this.request({ type: 'GET_STATUS' }, timeoutMs, (payload) => {
            return payload.type === 'MEDIA_STATUS';
        });
        this.status = response;
        if (!this.statusModel) {
            this.statusModel = MediaStatusModel.fromMessage(response);
        }
        else {
            this.statusModel.update(response);
        }
        return response;
    }
    async getStatusModel(timeoutMs = 5000) {
        if (this.statusModel) {
            return this.statusModel;
        }
        const status = await this.getStatus(timeoutMs);
        this.statusModel = MediaStatusModel.fromMessage(status);
        return this.statusModel;
    }
    async load(contentId, contentType, metadataOrOptions, autoplay = true, startTime = 0, timeoutMs = 15000) {
        const options = normalizeLoadOptions(metadataOrOptions, autoplay, startTime, timeoutMs);
        const response = await this.request({
            type: 'LOAD',
            media: {
                contentId,
                contentType,
                metadata: options.metadata,
                streamType: options.streamType,
                tracks: options.tracks,
                customData: options.customData,
            },
            autoplay: options.autoplay,
            currentTime: options.startTime,
            textTrackStyle: options.textTrackStyle,
            activeTrackIds: options.activeTrackIds,
            repeatMode: options.repeatMode,
        }, options.timeoutMs, (payload) => {
            const type = payload.type;
            return type === 'MEDIA_STATUS' || type === 'LOAD_FAILED' || type === 'LOAD_CANCELLED';
        });
        if (response.type === 'LOAD_FAILED') {
            throw new ProtocolError('Load failed');
        }
        if (response.type === 'LOAD_CANCELLED') {
            throw new ProtocolError('Load cancelled');
        }
        this.status = response;
        if (!this.statusModel) {
            this.statusModel = MediaStatusModel.fromMessage(response);
        }
        else {
            this.statusModel.update(response);
        }
        return response;
    }
    async play(mediaSessionId, timeoutMs = 5000) {
        return this.request({ type: 'PLAY', mediaSessionId }, timeoutMs, (payload) => payload.type === 'MEDIA_STATUS');
    }
    async pause(mediaSessionId, timeoutMs = 5000) {
        return this.request({ type: 'PAUSE', mediaSessionId }, timeoutMs, (payload) => payload.type === 'MEDIA_STATUS');
    }
    async stop(mediaSessionId, timeoutMs = 5000) {
        return this.request({ type: 'STOP', mediaSessionId }, timeoutMs, (payload) => payload.type === 'MEDIA_STATUS');
    }
    async seek(mediaSessionId, currentTime, timeoutMs = 5000) {
        return this.request({ type: 'SEEK', mediaSessionId, currentTime }, timeoutMs, (payload) => payload.type === 'MEDIA_STATUS');
    }
    async playMedia(url, contentType, options = {}) {
        const metadata = { ...(options.metadata ?? {}) };
        if (options.title) {
            metadata['title'] = options.title;
        }
        if (options.thumb) {
            metadata['thumb'] = options.thumb;
            const images = Array.isArray(metadata['images']) ? metadata['images'] : [];
            metadata['images'] = images;
            metadata['images'].push({ url: options.thumb });
        }
        const media = {
            contentId: url,
            contentType,
            streamType: options.streamType ?? 'LIVE',
            metadata,
            ...options.mediaInfo,
        };
        if (options.subtitlesUrl) {
            const trackId = options.subtitleId ?? 1;
            media.tracks = [
                {
                    trackId,
                    trackContentId: options.subtitlesUrl,
                    language: options.subtitlesLang ?? 'en-US',
                    subtype: 'SUBTITLES',
                    type: 'TEXT',
                    trackContentType: options.subtitlesMime ?? 'text/vtt',
                    name: `${options.subtitlesLang ?? 'en-US'} - ${trackId} Subtitle`,
                },
            ];
        }
        if (options.enqueue) {
            const item = { media };
            if (options.currentTime !== undefined) {
                item.startTime = options.currentTime;
            }
            return this.queueInsert([item], { timeoutMs: options.timeoutMs ?? 15000 });
        }
        return this.load(url, contentType, {
            metadata,
            autoplay: options.autoplay ?? true,
            startTime: options.currentTime ?? 0,
            timeoutMs: options.timeoutMs,
            streamType: options.streamType,
            tracks: media.tracks,
        });
    }
    async setPlaybackRate(mediaSessionId, playbackRate, timeoutMs = 5000) {
        return this.request({ type: 'SET_PLAYBACK_RATE', mediaSessionId, playbackRate }, timeoutMs, (payload) => payload.type === 'MEDIA_STATUS');
    }
    async queueLoad(items, options = {}) {
        const response = await this.request({
            type: 'QUEUE_LOAD',
            items,
            startIndex: options.startIndex,
            repeatMode: options.repeatMode,
            currentTime: options.currentTime,
        }, options.timeoutMs ?? 15000, (payload) => {
            const type = payload.type;
            return type === 'MEDIA_STATUS' || type === 'LOAD_FAILED' || type === 'LOAD_CANCELLED';
        });
        if (response.type === 'LOAD_FAILED') {
            throw new ProtocolError('Queue load failed');
        }
        if (response.type === 'LOAD_CANCELLED') {
            throw new ProtocolError('Queue load cancelled');
        }
        return response;
    }
    async queueInsert(items, options = {}) {
        return this.request({
            type: 'QUEUE_INSERT',
            items,
            insertBefore: options.insertBefore,
            currentItemId: options.currentItemId,
            currentItemIndex: options.currentItemIndex,
            currentTime: options.currentTime,
        }, options.timeoutMs ?? 5000, (payload) => payload.type === 'MEDIA_STATUS');
    }
    async queueRemove(itemIds, options = {}) {
        return this.request({
            type: 'QUEUE_REMOVE',
            itemIds,
            currentItemId: options.currentItemId,
            currentTime: options.currentTime,
        }, options.timeoutMs ?? 5000, (payload) => payload.type === 'MEDIA_STATUS');
    }
    async queueReorder(itemIds, options = {}) {
        return this.request({
            type: 'QUEUE_REORDER',
            itemIds,
            insertBefore: options.insertBefore,
            currentItemId: options.currentItemId,
            currentTime: options.currentTime,
        }, options.timeoutMs ?? 5000, (payload) => payload.type === 'MEDIA_STATUS');
    }
    async queueUpdate(items, options = {}) {
        return this.request({
            type: 'QUEUE_UPDATE',
            items,
            repeatMode: options.repeatMode,
            currentItemId: options.currentItemId,
            currentTime: options.currentTime,
            jump: options.jump,
        }, options.timeoutMs ?? 5000, (payload) => payload.type === 'MEDIA_STATUS');
    }
    async queueNext(mediaSessionId, timeoutMs = 5000) {
        return this.request({ type: 'QUEUE_NEXT', mediaSessionId }, timeoutMs, (payload) => payload.type === 'MEDIA_STATUS');
    }
    async queuePrev(mediaSessionId, timeoutMs = 5000) {
        return this.request({ type: 'QUEUE_PREV', mediaSessionId }, timeoutMs, (payload) => payload.type === 'MEDIA_STATUS');
    }
    getCachedStatus() {
        return this.status;
    }
    getCachedStatusModel() {
        return this.statusModel;
    }
    async playCurrent(timeoutMs = 5000) {
        return this.play(this.resolveMediaSessionId(), timeoutMs);
    }
    async pauseCurrent(timeoutMs = 5000) {
        return this.pause(this.resolveMediaSessionId(), timeoutMs);
    }
    async stopCurrent(timeoutMs = 5000) {
        return this.stop(this.resolveMediaSessionId(), timeoutMs);
    }
    async seekCurrent(currentTime, timeoutMs = 5000) {
        return this.seek(this.resolveMediaSessionId(), currentTime, timeoutMs);
    }
    resolveMediaSessionId() {
        const sessionId = this.status?.status?.[0]?.mediaSessionId ?? null;
        if (sessionId === null) {
            throw new ProtocolError('No active media session');
        }
        return sessionId;
    }
}
const isLoadOptions = (value) => {
    if (!value) {
        return false;
    }
    const optionKeys = [
        'autoplay',
        'startTime',
        'timeoutMs',
        'streamType',
        'tracks',
        'textTrackStyle',
        'activeTrackIds',
        'customData',
        'repeatMode',
    ];
    return optionKeys.some((key) => key in value);
};
const normalizeLoadOptions = (value, autoplay, startTime, timeoutMs) => {
    const options = isLoadOptions(value) ? value : {};
    const metadata = isLoadOptions(value) ? value.metadata : value;
    const normalized = {
        autoplay: options.autoplay ?? autoplay,
        startTime: options.startTime ?? startTime,
        timeoutMs: options.timeoutMs ?? timeoutMs,
    };
    if (metadata) {
        normalized.metadata = metadata;
    }
    if (options.streamType !== undefined) {
        normalized.streamType = options.streamType;
    }
    if (options.tracks !== undefined) {
        normalized.tracks = options.tracks;
    }
    if (options.textTrackStyle !== undefined) {
        normalized.textTrackStyle = options.textTrackStyle;
    }
    if (options.activeTrackIds !== undefined) {
        normalized.activeTrackIds = options.activeTrackIds;
    }
    if (options.customData !== undefined) {
        normalized.customData = options.customData;
    }
    if (options.repeatMode !== undefined) {
        normalized.repeatMode = options.repeatMode;
    }
    return normalized;
};
