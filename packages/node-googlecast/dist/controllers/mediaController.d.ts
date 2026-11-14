import type { MediaInformation, MediaQueueItem, MediaStatus, TextTrackStyle } from '../protocol/messages.js';
import { BaseController } from './baseController.js';
import { MediaStatusModel } from '../core/models.js';
export interface MediaControllerEvents {
    status: (status: MediaStatus) => void;
    statusModel: (status: MediaStatusModel) => void;
}
type LoadOptions = {
    metadata?: Record<string, unknown>;
    autoplay?: boolean;
    startTime?: number;
    timeoutMs?: number;
    streamType?: 'BUFFERED' | 'LIVE';
    tracks?: MediaInformation['tracks'];
    textTrackStyle?: TextTrackStyle;
    activeTrackIds?: number[];
    customData?: Record<string, unknown>;
    repeatMode?: 'REPEAT_OFF' | 'REPEAT_ALL' | 'REPEAT_SINGLE' | 'REPEAT_ALL_AND_SHUFFLE';
};
export declare class MediaController extends BaseController<MediaControllerEvents> {
    private status?;
    private statusModel?;
    constructor(channel: BaseController<MediaControllerEvents>['channel'], destinationId?: string);
    handleMessage(message: unknown): void;
    getStatus(timeoutMs?: number): Promise<MediaStatus>;
    getStatusModel(timeoutMs?: number): Promise<MediaStatusModel>;
    load(contentId: string, contentType: string, metadata?: Record<string, unknown>, autoplay?: boolean, startTime?: number, timeoutMs?: number): Promise<MediaStatus>;
    load(contentId: string, contentType: string, options?: LoadOptions): Promise<MediaStatus>;
    play(mediaSessionId: number, timeoutMs?: number): Promise<MediaStatus>;
    pause(mediaSessionId: number, timeoutMs?: number): Promise<MediaStatus>;
    stop(mediaSessionId: number, timeoutMs?: number): Promise<MediaStatus>;
    seek(mediaSessionId: number, currentTime: number, timeoutMs?: number): Promise<MediaStatus>;
    playMedia(url: string, contentType: string, options?: {
        title?: string;
        thumb?: string;
        currentTime?: number;
        autoplay?: boolean;
        streamType?: 'BUFFERED' | 'LIVE' | 'NONE' | 'UNKNOWN';
        metadata?: Record<string, unknown>;
        subtitlesUrl?: string;
        subtitlesLang?: string;
        subtitlesMime?: string;
        subtitleId?: number;
        enqueue?: boolean;
        mediaInfo?: Record<string, unknown>;
        timeoutMs?: number;
    }): Promise<MediaStatus>;
    setPlaybackRate(mediaSessionId: number, playbackRate: number, timeoutMs?: number): Promise<MediaStatus>;
    queueLoad(items: MediaQueueItem[], options?: {
        startIndex?: number;
        repeatMode?: 'REPEAT_OFF' | 'REPEAT_ALL' | 'REPEAT_SINGLE' | 'REPEAT_ALL_AND_SHUFFLE';
        currentTime?: number;
        timeoutMs?: number;
    }): Promise<MediaStatus>;
    queueInsert(items: MediaQueueItem[], options?: {
        insertBefore?: number;
        currentItemId?: number;
        currentItemIndex?: number;
        currentTime?: number;
        timeoutMs?: number;
    }): Promise<MediaStatus>;
    queueRemove(itemIds: number[], options?: {
        currentItemId?: number;
        currentTime?: number;
        timeoutMs?: number;
    }): Promise<MediaStatus>;
    queueReorder(itemIds: number[], options?: {
        insertBefore?: number;
        currentItemId?: number;
        currentTime?: number;
        timeoutMs?: number;
    }): Promise<MediaStatus>;
    queueUpdate(items: MediaQueueItem[], options?: {
        repeatMode?: 'REPEAT_OFF' | 'REPEAT_ALL' | 'REPEAT_SINGLE' | 'REPEAT_ALL_AND_SHUFFLE';
        currentItemId?: number;
        currentTime?: number;
        jump?: number;
        timeoutMs?: number;
    }): Promise<MediaStatus>;
    queueNext(mediaSessionId: number, timeoutMs?: number): Promise<MediaStatus>;
    queuePrev(mediaSessionId: number, timeoutMs?: number): Promise<MediaStatus>;
    getCachedStatus(): MediaStatus | undefined;
    getCachedStatusModel(): MediaStatusModel | undefined;
    playCurrent(timeoutMs?: number): Promise<MediaStatus>;
    pauseCurrent(timeoutMs?: number): Promise<MediaStatus>;
    stopCurrent(timeoutMs?: number): Promise<MediaStatus>;
    seekCurrent(currentTime: number, timeoutMs?: number): Promise<MediaStatus>;
    private resolveMediaSessionId;
}
export {};
