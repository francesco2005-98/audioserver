import { SessionStatus, Track } from '../../types';
import { SonosNamespace, SubscribeCallback, UnsubscribeCallback } from '../namespace';
export declare class PlaybackSessionNamespace extends SonosNamespace<SessionStatus> {
    constructor(api: any);
    createSession(groupId: string, appId: string, appContext: string, accountId?: string, customData?: Record<string, unknown>): Promise<SessionStatus>;
    loadCloudQueue(sessionId: string, queueBaseUrl: string, options: {
        httpAuthorization?: string;
        useHttpAuthorizationForMedia?: boolean;
        itemId?: string;
        queueVersion?: string;
        positionMillis?: number;
        playOnCompletion?: boolean;
        trackMetadata?: Track;
    }): Promise<void>;
    loadStreamUrl(sessionId: string, streamUrl: string, options?: {
        playOnCompletion?: boolean;
        stationMetadata?: Record<string, unknown>;
        itemId?: string;
    }): Promise<void>;
    refreshCloudQueue(sessionId: string): Promise<void>;
    seek(sessionId: string, positionMillis: number, itemId?: string): Promise<void>;
    seekRelative(sessionId: string, deltaMillis: number, itemId?: string): Promise<void>;
    skipToItem(sessionId: string, itemId: string, options?: {
        queueVersion?: string;
        positionMillis?: number;
        playOnCompletion?: boolean;
    }): Promise<void>;
    suspend(sessionId: string, queueVersion?: string): Promise<void>;
    subscribe(sessionId: string, callback: SubscribeCallback<SessionStatus>): Promise<UnsubscribeCallback>;
}
