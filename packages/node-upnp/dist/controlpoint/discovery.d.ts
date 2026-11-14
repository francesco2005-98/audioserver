import type { UpnpLogger } from '../logger.js';
export interface DlnaEndpointInfo {
    controlUrl?: string;
    renderingControlUrl?: string;
    /** GENA event subscription endpoint for AVTransport (transport state / track changes). */
    avTransportEventUrl?: string;
    /** GENA event subscription endpoint for RenderingControl (volume / mute). */
    renderingControlEventUrl?: string;
    /**
     * ConnectionManager control endpoint. This is where a renderer publishes the formats it accepts
     * (`GetProtocolInfo` → `Sink`), which is the only way to know whether a stream will play before
     * sending it.
     */
    connectionManagerUrl?: string;
    friendlyName?: string;
    descriptionUrl?: string;
}
export interface DlnaDiscoveredDevice {
    id: string;
    name?: string;
    host: string;
    address?: string;
    location: string;
    controlUrl?: string;
    renderingControlUrl?: string;
}
interface DiscoveryOptions {
    host?: string;
    timeoutMs?: number;
    mx?: number;
    /** Optional structured logger; when omitted, discovery runs silently. */
    logger?: UpnpLogger;
}
export declare function resolveDlnaEndpoints(options?: DiscoveryOptions): Promise<DlnaEndpointInfo | null>;
export declare function discoverDlnaDevices(options?: DiscoveryOptions): Promise<DlnaDiscoveredDevice[]>;
export {};
