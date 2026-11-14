import { EventEmitter } from 'events';
import { EventType, SlimEvent } from './models.js';
import { SlimClient } from './client.js';
export interface SlimServerOptions {
    cliPort?: number | null;
    cliPortJson?: number | null;
    ipAddress?: string | null;
    name?: string | null;
    controlPort?: number;
}
export declare class SlimServer extends EventEmitter {
    readonly options: SlimServerOptions;
    private server?;
    private discovery?;
    private playersMap;
    private subscriptions;
    constructor(options?: SlimServerOptions);
    get players(): SlimClient[];
    getPlayer(playerId: string): SlimClient | undefined;
    start(): Promise<void>;
    stop(): Promise<void>;
    subscribe(cb: (event: SlimEvent) => void | Promise<void>, eventFilter?: EventType | EventType[] | null, playerFilter?: string | string[] | null): () => void;
    private registerPlayer;
    private handleDisconnect;
    private handleClientEvent;
    private forwardEvent;
}
