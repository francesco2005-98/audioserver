import type { ZoneGroup } from './models';
export interface S1TransportEvent {
    transportState?: string;
    currentTrackUri?: string;
    /** Raw DIDL-Lite; parse with parseTrackMetadata. */
    currentTrackMetadata?: string;
    enqueuedTransportUri?: string;
    enqueuedTransportMetadata?: string;
}
export interface S1RenderingEvent {
    volume?: number;
    muted?: boolean;
}
export interface S1EventHandlers {
    onTransport?: (event: S1TransportEvent) => void;
    onRendering?: (event: S1RenderingEvent) => void;
    onTopology?: (groups: ZoneGroup[]) => void;
}
export interface S1EventBridgeOptions {
    port?: number;
    logger?: Console;
}
export declare class S1EventBridge {
    private readonly host;
    private readonly handlers;
    private readonly options;
    private subscriber;
    private disposed;
    constructor(host: string, handlers: S1EventHandlers, options?: S1EventBridgeOptions);
    start(): Promise<void>;
    dispose(): void;
    private handleRaw;
}
/** Which of our addresses can this speaker reach us on? Ask the routing table. */
export declare function resolveLocalAddress(host: string, port: number): Promise<string | null>;
