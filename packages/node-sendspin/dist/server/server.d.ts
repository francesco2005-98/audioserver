import EventEmitter from 'node:events';
import { type RoleName } from '../types.js';
import { ServerClient } from './server-client.js';
export interface SendspinServerOptions {
    path?: string;
    defaultRoles?: RoleName[];
    serverVersion?: number;
}
export interface StartOptions extends SendspinServerOptions {
    port?: number;
    host?: string;
}
export declare class SendspinServer extends EventEmitter {
    private readonly serverId;
    private readonly serverName;
    private readonly opts;
    private wss?;
    private clients;
    constructor(serverId: string, serverName: string, opts?: SendspinServerOptions);
    get connectedClients(): ReadonlySet<ServerClient>;
    start(options?: StartOptions): Promise<void>;
    stop(): Promise<void>;
    connectToClient(url: string): void;
    private registerClient;
    private emitEvent;
}
//# sourceMappingURL=server.d.ts.map