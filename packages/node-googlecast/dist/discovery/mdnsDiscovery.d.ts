import { TypedEventEmitter } from '../utils/eventMap.js';
import type { DiscoveredDevice, DiscoveryEvents, MdnsDiscoveryOptions } from './types.js';
export declare class MdnsDiscovery extends TypedEventEmitter<DiscoveryEvents> {
    private readonly mdnsInstance;
    private readonly logger;
    private readonly queryIntervalMs;
    private readonly deviceTimeoutMs;
    private readonly records;
    private readonly devices;
    private queryTimer?;
    private cleanupTimer?;
    private started;
    constructor(options?: MdnsDiscoveryOptions);
    start(): void;
    stop(): Promise<void>;
    getDevices(): DiscoveredDevice[];
    private query;
    private handleResponse;
    private ensureRecord;
    private parseTxt;
    private toDevice;
    private cleanup;
}
