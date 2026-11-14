import { AudioClipNamespace } from './namespaces/audioClip';
import { GroupsNamespace } from './namespaces/groups';
import { GroupVolumeNamespace } from './namespaces/groupVolume';
import { PlaybackNamespace } from './namespaces/playback';
import { PlaybackMetadataNamespace } from './namespaces/playbackMetadata';
import { PlaybackSessionNamespace } from './namespaces/playbackSession';
import { PlayerVolumeNamespace } from './namespaces/playerVolume';
import { HomeTheaterNamespace } from './namespaces/homeTheater';
export interface WebSocketReliabilityOptions {
    heartbeatIntervalMs?: number;
    retryDelayMs?: number;
    retryJitterMs?: number;
    maxReconnects?: number;
}
export declare class SonosWebSocketApi {
    private websocketUrl;
    private ws?;
    private resultFutures;
    private stopCalled;
    private heartbeatTimer?;
    private heartbeatIntervalMs;
    private retryDelayMs;
    private retryJitterMs;
    private maxReconnects?;
    readonly audioClip: AudioClipNamespace;
    readonly groups: GroupsNamespace;
    readonly groupVolume: GroupVolumeNamespace;
    readonly playback: PlaybackNamespace;
    readonly playbackMetadata: PlaybackMetadataNamespace;
    readonly playbackSession: PlaybackSessionNamespace;
    readonly playerVolume: PlayerVolumeNamespace;
    readonly homeTheater: HomeTheaterNamespace;
    logger: Console;
    onConnect?: () => void | Promise<void>;
    onDisconnect?: (reason?: string) => void | Promise<void>;
    constructor(websocketUrl: string, opts?: WebSocketReliabilityOptions);
    get connected(): boolean;
    connect(): Promise<void>;
    startListening(): Promise<void>;
    disconnect(): Promise<void>;
    /**
     * Forgets the current socket and fails every command still waiting on it. Without this a
     * command issued while the socket dies would hang forever (no result frame is ever coming),
     * and the stale socket would block the next connect().
     */
    private discardSocket;
    sendCommand(namespace: string, command: string, options?: Record<string, unknown>, pathParams?: Record<string, unknown>): Promise<any>;
    sendCommandNoWait(namespace: string, command: string, options?: Record<string, unknown>, pathParams?: Record<string, unknown>): void;
    private send;
    private handleRawMessage;
    private handleIncoming;
    private waitForClose;
    private startHeartbeat;
    private clearHeartbeat;
    private delay;
    private computeRetryDelay;
}
