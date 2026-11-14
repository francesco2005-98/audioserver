export declare const SONOS_UPNP_PORT = 1400;
export interface SonosServiceDef {
    type: string;
    controlPath: string;
    eventPath: string;
    /** null for services that take no InstanceID argument at all. */
    instanceId: number | null;
}
export declare const SONOS_SERVICES: {
    AVTransport: {
        type: string;
        controlPath: string;
        eventPath: string;
        instanceId: number;
    };
    RenderingControl: {
        type: string;
        controlPath: string;
        eventPath: string;
        instanceId: number;
    };
    GroupRenderingControl: {
        type: string;
        controlPath: string;
        eventPath: string;
        instanceId: number;
    };
    ZoneGroupTopology: {
        type: string;
        controlPath: string;
        eventPath: string;
        instanceId: null;
    };
};
export type SonosServiceName = keyof typeof SONOS_SERVICES;
export declare function serviceEventUrl(host: string, service: SonosServiceName, port?: number): string;
export interface CallActionOptions {
    port?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
}
/**
 * Invoke a SOAP action and return the raw response body.
 *
 * Argument values are inserted verbatim, matching node-upnp's builder — a caller
 * passing DIDL metadata must escape it first.
 */
export declare function callAction(host: string, service: SonosServiceName, action: string, args?: Record<string, string>, options?: CallActionOptions): Promise<string>;
