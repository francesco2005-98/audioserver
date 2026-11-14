export type RequestId = number;
export interface HeartbeatPing {
    type: 'PING';
}
export interface HeartbeatPong {
    type: 'PONG';
}
export type HeartbeatMessage = HeartbeatPing | HeartbeatPong;
export interface ConnectionConnect {
    type: 'CONNECT';
}
export interface ConnectionClose {
    type: 'CLOSE';
}
export type ConnectionMessage = ConnectionConnect | ConnectionClose;
export interface ReceiverGetStatus {
    type: 'GET_STATUS';
    requestId: RequestId;
}
export interface ReceiverLaunch {
    type: 'LAUNCH';
    appId: string;
    requestId: RequestId;
}
export interface ReceiverStop {
    type: 'STOP';
    sessionId: string;
    requestId: RequestId;
}
export interface ReceiverGetAppAvailability {
    type: 'GET_APP_AVAILABILITY';
    requestId: RequestId;
    appId: string[] | string;
}
export interface ReceiverAppAvailability {
    type: 'APP_AVAILABILITY';
    availability: Record<string, 'APP_AVAILABLE' | 'APP_UNAVAILABLE'>;
    requestId?: RequestId;
}
export interface ReceiverStatus {
    type: 'RECEIVER_STATUS';
    status: {
        applications?: Array<{
            appId: string;
            displayName?: string;
            sessionId: string;
            transportId: string;
            statusText?: string;
            namespaces?: Array<{
                name: string;
            }>;
            iconUrl?: string;
        }>;
        volume?: {
            level?: number;
            muted?: boolean;
            controlType?: 'attenuation' | 'fixed' | 'master';
        };
        isActiveInput?: boolean;
        isStandBy?: boolean;
    };
    requestId?: RequestId;
}
export type ReceiverMessage = ReceiverGetStatus | ReceiverLaunch | ReceiverStop | ReceiverGetAppAvailability | ReceiverAppAvailability | ReceiverStatus;
export interface MediaGetStatus {
    type: 'GET_STATUS';
    requestId: RequestId;
}
export interface MediaLoad {
    type: 'LOAD';
    requestId: RequestId;
    media: MediaInformation;
    autoplay?: boolean;
    currentTime?: number;
    activeTrackIds?: number[];
    textTrackStyle?: TextTrackStyle;
    repeatMode?: 'REPEAT_OFF' | 'REPEAT_ALL' | 'REPEAT_SINGLE' | 'REPEAT_ALL_AND_SHUFFLE';
}
export interface MediaCommand {
    type: 'PLAY' | 'PAUSE' | 'STOP';
    requestId: RequestId;
    mediaSessionId: number;
}
export interface MediaSeek {
    type: 'SEEK';
    requestId: RequestId;
    mediaSessionId: number;
    currentTime: number;
}
export interface MediaSetPlaybackRate {
    type: 'SET_PLAYBACK_RATE';
    requestId: RequestId;
    mediaSessionId: number;
    playbackRate: number;
}
export interface MediaLoadFailed {
    type: 'LOAD_FAILED';
    requestId?: RequestId;
}
export interface MediaLoadCancelled {
    type: 'LOAD_CANCELLED';
    requestId?: RequestId;
}
export interface MediaQueueLoad {
    type: 'QUEUE_LOAD';
    requestId: RequestId;
    items: MediaQueueItem[];
    startIndex?: number;
    currentTime?: number;
    repeatMode?: 'REPEAT_OFF' | 'REPEAT_ALL' | 'REPEAT_SINGLE' | 'REPEAT_ALL_AND_SHUFFLE';
}
export interface MediaQueueInsert {
    type: 'QUEUE_INSERT';
    requestId: RequestId;
    items: MediaQueueItem[];
    insertBefore?: number;
    currentItemId?: number;
    currentItemIndex?: number;
    currentTime?: number;
}
export interface MediaQueueRemove {
    type: 'QUEUE_REMOVE';
    requestId: RequestId;
    itemIds: number[];
    currentItemId?: number;
    currentTime?: number;
}
export interface MediaQueueReorder {
    type: 'QUEUE_REORDER';
    requestId: RequestId;
    itemIds: number[];
    insertBefore?: number;
    currentItemId?: number;
    currentTime?: number;
}
export interface MediaQueueUpdate {
    type: 'QUEUE_UPDATE';
    requestId: RequestId;
    items: MediaQueueItem[];
    repeatMode?: 'REPEAT_OFF' | 'REPEAT_ALL' | 'REPEAT_SINGLE' | 'REPEAT_ALL_AND_SHUFFLE';
    currentItemId?: number;
    currentTime?: number;
    jump?: number;
}
export interface MediaQueueNext {
    type: 'QUEUE_NEXT';
    requestId: RequestId;
    mediaSessionId: number;
}
export interface MediaQueuePrev {
    type: 'QUEUE_PREV';
    requestId: RequestId;
    mediaSessionId: number;
}
export interface MediaStatus {
    type: 'MEDIA_STATUS';
    status: Array<{
        mediaSessionId: number;
        playerState?: 'IDLE' | 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'UNKNOWN';
        currentTime?: number;
        playbackRate?: number;
        idleReason?: 'CANCELLED' | 'INTERRUPTED' | 'FINISHED' | 'ERROR';
        supportedMediaCommands?: number;
        volume?: {
            level?: number;
            muted?: boolean;
        };
        activeTrackIds?: number[];
        currentItemId?: number;
        repeatMode?: 'REPEAT_OFF' | 'REPEAT_ALL' | 'REPEAT_SINGLE' | 'REPEAT_ALL_AND_SHUFFLE';
        items?: MediaQueueItem[];
        media?: MediaInformation;
    }>;
    requestId?: RequestId;
}
export type MediaMessage = MediaGetStatus | MediaLoad | MediaCommand | MediaSeek | MediaSetPlaybackRate | MediaLoadFailed | MediaLoadCancelled | MediaQueueLoad | MediaQueueInsert | MediaQueueRemove | MediaQueueReorder | MediaQueueUpdate | MediaQueueNext | MediaQueuePrev | MediaStatus;
export interface MediaInformation {
    contentId: string;
    contentType: string;
    metadata?: Record<string, unknown>;
    streamType?: 'BUFFERED' | 'LIVE' | 'UNKNOWN' | 'NONE';
    duration?: number;
    tracks?: MediaTrack[];
    customData?: Record<string, unknown>;
}
export interface MediaTrack {
    trackId: number;
    type: 'AUDIO' | 'VIDEO' | 'TEXT';
    trackContentId?: string;
    trackContentType?: string;
    language?: string;
    name?: string;
    subtype?: 'SUBTITLES' | 'CAPTIONS';
}
export interface TextTrackStyle {
    backgroundColor?: string;
    edgeColor?: string;
    edgeType?: 'NONE' | 'OUTLINE' | 'DROP_SHADOW' | 'RAISED' | 'DEPRESSED';
    fontFamily?: string;
    fontGenericFamily?: 'SANS_SERIF' | 'MONOSPACE_SANS_SERIF' | 'SERIF' | 'MONOSPACE_SERIF' | 'CASUAL' | 'CURSIVE' | 'SMALL_CAPITALS';
    fontScale?: number;
    fontStyle?: 'NORMAL' | 'BOLD' | 'BOLD_ITALIC' | 'ITALIC';
    foregroundColor?: string;
    windowColor?: string;
    windowRoundedCornerRadius?: number;
    windowType?: 'NONE' | 'NORMAL' | 'ROUNDED_CORNERS';
}
export interface MediaQueueItem {
    itemId?: number;
    media: MediaInformation;
    autoplay?: boolean;
    startTime?: number;
    playbackDuration?: number;
    preloadTime?: number;
    activeTrackIds?: number[];
    customData?: Record<string, unknown>;
}
export interface VolumeSet {
    type: 'SET_VOLUME';
    requestId: RequestId;
    volume: {
        level?: number;
        muted?: boolean;
    };
}
export type VolumeMessage = VolumeSet;
