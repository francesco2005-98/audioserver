import { SonosWebSocketApi } from './api/websocket';
import { EventType } from './constants';
import { SonosGroup } from './group';
import { SonosPlayer } from './player';
import { DiscoveryOptions } from './utils';
import { SonosEvent } from './types';
type Subscriber = {
    cb: (event: SonosEvent) => void;
    eventFilter?: Set<EventType>;
    objectIdFilter?: Set<string>;
};
export interface SonosClientOptions extends DiscoveryOptions {
    logger?: Console;
    heartbeatIntervalMs?: number;
    retryDelayMs?: number;
    retryJitterMs?: number;
    maxReconnects?: number;
}
export declare class SonosClient {
    private playerIp;
    api: SonosWebSocketApi;
    playerId: string;
    householdId: string;
    player: SonosPlayer | null;
    private groupMap;
    private subscribers;
    private logger;
    private bootstrapPromise;
    private connectedPlayerIds;
    constructor(playerIp: string, options?: SonosClientOptions);
    get groups(): SonosGroup[];
    subscribe(cb: Subscriber['cb'], eventFilter?: EventType | EventType[] | null, objectIdFilter?: string | string[] | null): () => void;
    signalEvent(event: SonosEvent): void;
    connect(options?: SonosClientOptions): Promise<void>;
    disconnect(): Promise<void>;
    start(): Promise<void>;
    private bootstrap;
    createGroup(playerIds: string[], musicContextGroupId?: string): Promise<void>;
    private setupGroup;
    private handleGroupsEvent;
    private handleSocketConnected;
    private handleSocketDisconnected;
}
export {};
