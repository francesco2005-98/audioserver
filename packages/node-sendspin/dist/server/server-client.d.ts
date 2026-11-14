import EventEmitter from 'node:events';
import WebSocket from 'ws';
import { ClientCommandPayload, ClientHelloPayload, ClientStatePayload, GroupUpdateServerPayload, RoleName, ServerCommandPayload, ServerStatePayload, StreamClearPayload, StreamEndPayload, StreamStartPayload, StreamStartPlayer, ConnectionReason } from '../types.js';
export type ClientConnectionSide = 'incoming' | 'outgoing';
export interface ServerClientOptions {
    connectionSide: ClientConnectionSide;
    defaultRoles?: RoleName[];
    serverId: string;
    serverName: string;
    serverVersion?: number;
    connectionReason?: ConnectionReason;
}
export interface ClientEventMap {
    hello: (payload: ClientHelloPayload) => void;
    state: (payload: ClientStatePayload) => void;
    command: (payload: ClientCommandPayload) => void;
    disconnect: () => void;
}
export declare class ServerClient extends EventEmitter {
    private helloPayload?;
    private readonly ws;
    private readonly opts;
    private readonly defaultRoles;
    private activeRoles;
    private ready;
    private initialStateRequired;
    private initialStateReceived;
    private initialStateTimer;
    private identified;
    private readonly maxBufferedSend;
    constructor(ws: WebSocket, opts: ServerClientOptions);
    get clientId(): string | undefined;
    get name(): string | undefined;
    get roles(): RoleName[];
    close(): void;
    sendHello(): Promise<void>;
    sendGroupUpdate(payload: GroupUpdateServerPayload): void;
    sendServerState(payload: ServerStatePayload): void;
    sendServerCommand(payload: ServerCommandPayload): void;
    sendStreamStart(payload: StreamStartPayload): void;
    sendStreamClear(payload: StreamClearPayload): void;
    sendStreamEnd(payload: StreamEndPayload): void;
    sendAudioChunk(timestampUs: number, pcmData: Buffer, player?: StreamStartPlayer): void;
    private setup;
    private handleMessage;
    private handleJson;
    private respondTime;
    private sendJson;
    private nowUs;
    private handleClientHello;
    private maybeEmitHello;
    private closeWithReason;
    private resolveActiveRoles;
}
//# sourceMappingURL=server-client.d.ts.map