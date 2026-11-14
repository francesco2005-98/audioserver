import type { IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import { ConnectionReason, GoodbyeReason, PlaybackStateType, ServerCommandPayload, SourceSignalType, SourceStateType, type RoleName } from '../types.js';
import { SendspinSession, type SendspinSessionHooks, type SendspinPcmFrame, type SendspinConnectionMeta, type SendspinServerInfo, type PlayerFormat } from './session.js';
import { Identity } from '../noise/keys.js';
import { type PskProvider } from '../noise/handshake.js';
export declare class SendspinCore {
    private readonly sessionsBySocket;
    private readonly hooksByClientId;
    private readonly leadStatsByClientId;
    private readonly aliveBySocket;
    private readonly recentGoodbyeByClientId;
    private readonly heartbeatTimer;
    private security;
    private serverInfo;
    /**
     * Name this server to its clients.
     *
     * Call this before accepting connections. `serverId` should be something stable
     * and unique to this machine — a MAC-derived id, not a constant — because a
     * client with more than one server on the network tells them apart by it.
     */
    configureServer(info: Partial<SendspinServerInfo>): void;
    /**
     * Turn on the encrypted path.
     *
     * `identity` must be persisted and reloaded: it is this server's `server_id`
     * under encryption, so a fresh one on every boot looks like a different server.
     * With no `pskProvider` every client is admitted with the published Sentinel
     * PSK — encrypted against a passive listener, authenticating nothing, which is
     * what unpaired playback means.
     */
    enableEncryption(identity: Identity, pskProvider?: PskProvider, options?: {
        isApprovedUnpaired?: (clientId: string) => boolean;
    }): void;
    /** Whether the encrypted path is available. */
    isEncryptionEnabled(): boolean;
    /** This server's `server_id`: its public key when encrypted, else the configured id. */
    getServerId(): string;
    constructor();
    /** Terminate sockets that didn't pong since the last sweep; ping the rest.
     *  `terminate()` fires `'close'`, which runs the normal session cleanup. */
    private sweepHeartbeats;
    handleConnection(ws: WebSocket, req?: IncomingMessage | null, connectionReason?: ConnectionReason): void;
    registerHooks(clientId: string, hooks: SendspinSessionHooks, context?: SendspinConnectionMeta): void;
    unregisterHooks(clientId: string): void;
    listClients(): Array<{
        clientId: string | null;
        name: string | null;
        roles: RoleName[];
        playbackState: PlaybackStateType;
        remote: string | null;
        sourceState: SourceStateType | null;
        sourceSignal: SourceSignalType | null;
    }>;
    listDescriptors(): Array<{
        clientId: string | null;
        roles: RoleName[];
        playbackState: 'playing' | 'paused' | 'stopped';
        remote: string | null;
    }>;
    getSessionBySocket(ws: WebSocket): SendspinSession | undefined;
    getSessions(): Iterable<SendspinSession>;
    /** Read and clear the goodbye reason a client reported as it last left.
     *  Returns null if it dropped without a goodbye (unclean disconnect) or the
     *  recorded reason is stale. Lets callers skip the reconnect grace for an
     *  intentional `user_request`/`shutdown` leave. */
    takeGoodbyeReason(clientId: string): GoodbyeReason | null;
    sendPcmFrameToClient(clientId: string, frame: SendspinPcmFrame): void;
    sendStreamStart(clientId: string, format?: Partial<PlayerFormat>): void;
    sendStreamClear(clientId: string, roles?: RoleName[]): void;
    sendStreamEnd(clientId: string, roles?: RoleName[]): void;
    /**
     * Why this client's encrypted session is held idle ("pairing required"), or null
     * when it may play or is not connected. See `SendspinSession.getPairingRequired`.
     */
    getPairingRequired(clientId: string): ReturnType<SendspinSession['getPairingRequired']>;
    /**
     * Declare or drop `'playback'` on this client's encrypted rc1 connection. Drop it
     * when its group stops so another server may take the client (spec #314); a later
     * stream start raises it again by itself.
     */
    setPlaybackActive(clientId: string, active: boolean): void;
    /** End only the player and visualizer streams, keeping the artwork up: a pause (spec #346). */
    endPlaybackStreams(clientId: string): void;
    sendGroupUpdate(clientId: string, playbackState: PlaybackStateType, groupId?: string, groupName?: string): void;
    sendMetadata(clientId: string, payload: Parameters<SendspinSession['sendMetadata']>[0]): void;
    setClientMetadata(clientId: string, payload: Parameters<SendspinSession['sendMetadata']>[0]): void;
    sendServerCommand(clientId: string, payload: Parameters<SendspinSession['sendServerCommand']>[0] | ServerCommandPayload): void;
    sendArtworkStreamStart(clientId: string, channels: Parameters<SendspinSession['sendArtworkStreamStart']>[0]): void;
    sendArtwork(clientId: string, channel: 0 | 1 | 2 | 3, imageData: Buffer | null): void;
    /**
     * Header bytes in front of each player audio chunk for this client (13 for an
     * rc1 peer, 9 for a legacy one), or null when it is not connected. A count of
     * bytes against the player's `buffer_capacity` must include them.
     */
    getAudioHeaderSize(clientId: string): number | null;
    /** Bytes this client's player holds against its `buffer_capacity` (rc1 accounting), or null. */
    getPlayerBufferedBytes(clientId: string): number | null;
    /** Microseconds until `bytes` more audio fit in this client's player buffer, or null. */
    timeUntilPlayerCapacityUs(clientId: string, bytes: number): number | null;
    sendVisualizerStreamStart(clientId: string, config?: Record<string, any>): void;
    sendVisualizerFrame(clientId: string, data: Buffer, timestampUs?: number): void;
    /** `device_info` this client reported in its hello, or null. */
    getDeviceInfo(clientId: string): ReturnType<SendspinSession['getDeviceInfo']> | null;
    getVisualizerSupport(clientId: string): ReturnType<SendspinSession['getVisualizerSupport']> | null;
    sendVisualizerStreamStartV1(clientId: string, config: Parameters<SendspinSession['sendVisualizerStreamStartV1']>[0]): void;
    sendVisualizerLoudness(clientId: string, loudness: number, timestampUs?: number): void;
    sendVisualizerSpectrum(clientId: string, bins: ArrayLike<number>, timestampUs?: number): void;
    sendVisualizerFpeak(clientId: string, freqHz: number, amplitude: number, timestampUs?: number): void;
    sendVisualizerPeak(clientId: string, strength: number, timestampUs?: number): void;
    sendVisualizerPitch(clientId: string, midiQ88: number, confidence: number, timestampUs?: number): void;
    sendVisualizerBeat(clientId: string, downbeat?: boolean, timestampUs?: number): void;
    sendControllerState(clientId: string, payload: Parameters<SendspinSession['sendControllerState']>[0]): void;
    sendColor(clientId: string, payload: Parameters<SendspinSession['sendColor']>[0]): void;
    setClientControllerState(clientId: string, payload: Parameters<SendspinSession['sendControllerState']>[0]): void;
    setClientPlaybackState(clientId: string, playbackState: PlaybackStateType, groupId?: string, groupName?: string): void;
    getSessionByClientId(clientId: string): SendspinSession | undefined;
    getStreamFormat(clientId: string): ReturnType<SendspinSession['getStreamFormat']> | null;
    getPlayerBufferCapacity(clientId: string): number | null;
    setLeadStats(clientId: string, stats: {
        leadUs: number;
        targetLeadUs: number;
        bufferedBytes?: number;
    }): void;
    clearLeadStats(clientId: string): void;
    getLeadStats(clientId: string): {
        leadUs: number;
        targetLeadUs: number;
        bufferedBytes?: number;
        updatedAt: number;
    } | null;
    getArtworkChannels(clientId: string): ReturnType<SendspinSession['getArtworkChannels']> | null;
    getBackpressureStats(clientId: string): ReturnType<SendspinSession['getBackpressureStats']> | null;
    private getSession;
    private extractConnectionMetadata;
}
//# sourceMappingURL=core.d.ts.map