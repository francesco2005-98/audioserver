import type { IncomingMessage } from 'node:http';
import type net from 'node:net';
import type { AudioOutputSettings, SnapcastCoreOptions, SnapcastHooks } from './types.js';
/**
 * Central Snapcast-compatible server (WebSocket + TCP).
 * Exposes upgrade handling for a shared HTTP server (path is decided by the caller).
 */
export declare class SnapcastCore {
    private readonly log;
    private readonly wsServer;
    private readonly rpcServer;
    private readonly rpcClients;
    private readonly clients;
    private nextMessageId;
    private streams;
    private clientToStream;
    private rpcInterval;
    private readonly streamSignatures;
    private readonly clientConfigs;
    private readonly groupConfigs;
    private readonly clientToGroup;
    private readonly rpcStreams;
    private hooks;
    private readonly defaultOutput;
    private readonly serverName;
    private readonly serverVersion;
    private readonly protocolVersion;
    private readonly controlProtocolVersion;
    private readonly streamUri;
    /** Create a Snapcast core instance with optional hooks and defaults. */
    constructor(options?: SnapcastCoreOptions);
    /** Handle HTTP upgrade requests for Snapcast stream + JSON-RPC endpoints. */
    handleUpgrade(request: IncomingMessage, socket: any, head: Buffer): boolean;
    /** Close all sockets and clear registered streams. */
    close(): void;
    /** Replace hook handlers (useful for hot reloads). */
    setHooks(hooks: SnapcastHooks): void;
    /** List connected clients and their active mapping. */
    listClients(): Array<{
        clientId: string;
        streamId: string;
        connected: boolean;
        connectedAt: number;
        lastHelloId: number | null;
        latency: number;
    }>;
    /** Update a client latency setting (milliseconds). */
    setClientLatency(clientId: string, latency: number): {
        updated: boolean;
        connected: boolean;
        latency: number;
    };
    /** Force-map a client ID to a stream ID. */
    setClientStream(clientId: string, streamId: string): {
        updated: boolean;
        connected: boolean;
    };
    /** Register or update a PCM stream and client mappings. */
    setStream(streamId: string, zoneId: number, output: AudioOutputSettings, stream: NodeJS.ReadableStream, clientIds?: string[]): void;
    /** Update volume (and optional mute) for one or more clients. */
    setClientVolumes(clientIds: string[], volume: number, muted?: boolean): void;
    /** Clear a stream by ID/zone or clear all streams when omitted. */
    clearStream(zoneId?: number | string): void;
    private handleConnection;
    /** Accept a new TCP Snapclient connection. */
    handleTcpConnection(socket: net.Socket): void;
    private consumeData;
    private parseHeader;
    private terminateClient;
    private isClientOpen;
    private sendToClient;
    private closeClientSocket;
    private getClientRemoteIp;
    private handleMessage;
    private handleHello;
    private handleClientInfo;
    private applyClientVolume;
    private applyStreamVolumeToClient;
    private handleStreamAdd;
    private parseStreamUri;
    private handleTime;
    private broadcastWireChunk;
    private encodeJsonMessage;
    private buildPcmCodecHeader;
    private encodeWavHeader;
    private encodeMessage;
    private nextId;
    private nowTv;
    private nowUs;
    private extractStreamId;
    private normalizeBasePath;
    private resolveStreamId;
    private pushSettingsToClients;
    private sendSettings;
    private updateFlowControl;
    private hasActiveClient;
    private computeBufferMs;
    private handleRpcMessage;
    private handleRpcRequest;
    private runStreamControl;
    private runStreamProperty;
    private normalizeHookResult;
    private startRpcUpdates;
    private stopRpcUpdatesIfIdle;
    private broadcastUpdates;
    private buildStatus;
    private buildServerMeta;
    private getStreamContext;
    private getStreamProperties;
    private buildStreamUri;
    private buildStreamStatus;
    private buildStreamStatusList;
    private buildRpcStreamStatus;
    private buildGroupStatus;
    private buildGroupStatusList;
    private buildGroupStatusFromGroup;
    private buildClientStatus;
    private buildClientStatusFromConfig;
    private pickLocalAddress;
    private ensureClientConfig;
    private getClientConfig;
    private getClientVolume;
    private setClientVolume;
    private parseInstance;
    private findClientById;
    private updateClientStream;
    private ensureGroupForClient;
    private removeClientFromGroup;
    private findGroupByStreamId;
    private findGroupByClientId;
    private getOrCreateGroup;
    private sendClientNotification;
    private sendServerUpdate;
}
//# sourceMappingURL=core.d.ts.map