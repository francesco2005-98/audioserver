export interface CastChannelOptions {
    host: string;
    port?: number;
    reconnect?: boolean;
    reconnectAttempts?: number;
    reconnectBackoffMs?: number;
    reconnectMaxBackoffMs?: number;
    reconnectBackoffFactor?: number;
    reconnectJitter?: number;
    pingIntervalMs?: number;
    pongTimeoutMs?: number;
    requestTimeoutMs?: number;
    connectTimeoutMs?: number;
}
export interface CastMessagePayload {
    namespace: string;
    sourceId: string;
    destinationId: string;
    payloadType: 'STRING' | 'BINARY';
    payloadUtf8?: string;
    payloadBinary?: Uint8Array;
}
export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export interface CastChannelEvents {
    connected: () => void;
    disconnected: (reason?: Error) => void;
    stateChanged: (state: ConnectionState) => void;
    message: (payload: CastMessagePayload, parsed?: unknown) => void;
    error: (error: Error) => void;
}
