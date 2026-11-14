import type { UpnpLogger } from '../logger.js';
/**
 * One SSDP device this advertiser announces: a UDN, a device type, its service
 * types, and the absolute URL of its device description. A single UDP socket on
 * :1900 can only be bound once, so ALL of an app's UPnP devices (e.g. a
 * MediaServer plus one MediaRenderer per zone) share one advertiser and register
 * themselves as devices here.
 */
export interface SsdpDevice {
    /** Stable id, e.g. `uuid:xxxxxxxx-...`. */
    udn: string;
    /** e.g. `urn:schemas-upnp-org:device:MediaRenderer:1`. */
    deviceType: string;
    /** Full service type URNs, e.g. `urn:schemas-upnp-org:service:AVTransport:1`. */
    serviceTypes: string[];
    /** Returns the absolute LOCATION of this device's description (per-call so IP can change). */
    location: () => string;
}
export interface SsdpAdvertiserOptions {
    /** SERVER header value advertised in NOTIFY / M-SEARCH replies. */
    serverHeader?: string;
    logger?: UpnpLogger;
}
/**
 * SSDP presence responder — announces registered UPnP devices and answers
 * M-SEARCH so control points (BubbleUPnP, Samsung, VLC, B&O, …) discover them
 * without a manual poll. USNs follow the standard triple per device: root
 * device, device type, and each service type, all under that device's UDN.
 */
export declare class SsdpAdvertiser {
    private socket?;
    private timer?;
    private running;
    private readonly devices;
    private readonly serverHeaderValue;
    private readonly log?;
    constructor(options?: SsdpAdvertiserOptions);
    /** Register (or replace) a device and announce it immediately if running. */
    addDevice(device: SsdpDevice): void;
    /** Remove a device and send byebye for it. */
    removeDevice(udn: string): void;
    hasDevices(): boolean;
    start(): Promise<void>;
    stop(): Promise<void>;
    private notificationTypes;
    private sendAlive;
    private sendAliveFor;
    private sendByebye;
    private sendByebyeFor;
    private handleMessage;
    private matchingTargets;
    private sendSearchResponse;
}
