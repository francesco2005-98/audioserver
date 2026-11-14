export interface DiscoveredDevice {
    id: string;
    name: string;
    host: string;
    port: number;
    model?: string;
    capabilities?: string[];
    txt?: Record<string, string>;
    lastSeen: number;
}
export interface DiscoveryEvents {
    deviceUp: (device: DiscoveredDevice) => void;
    deviceDown: (device: DiscoveredDevice) => void;
    deviceUpdated: (device: DiscoveredDevice) => void;
    error: (error: Error) => void;
}
export interface MdnsDiscoveryOptions {
    queryIntervalMs?: number;
    deviceTimeoutMs?: number;
    logger?: {
        debug(message: string, meta?: Record<string, unknown>): void;
        info(message: string, meta?: Record<string, unknown>): void;
        warn(message: string, meta?: Record<string, unknown>): void;
        error(message: string, meta?: Record<string, unknown>): void;
    };
}
