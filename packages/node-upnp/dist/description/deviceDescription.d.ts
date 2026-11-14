/**
 * UPnP device-description (device.xml) builders, parameterized so a host app sets
 * its own manufacturer/model/friendly name. One builder per device type we
 * support: MediaServer and MediaRenderer. Service SCPD documents live in
 * ./scpd.ts.
 */
export interface DeviceIdentity {
    udn: string;
    friendlyName: string;
    manufacturer?: string;
    manufacturerUrl?: string;
    modelName?: string;
    modelNumber?: string;
    modelDescription?: string;
}
export interface ServiceRef {
    serviceType: string;
    serviceId: string;
    scpdUrl: string;
    controlUrl: string;
    eventSubUrl: string;
}
/** Build a root device description for a given device type + services + DLNA doc. */
export declare function buildDeviceDescription(params: {
    deviceType: string;
    identity: DeviceIdentity;
    services: ServiceRef[];
    /** Optional URLBase; when set, SCPD/control/event URLs may be relative to it. */
    urlBase?: string;
    /** Optional dlna:X_DLNADOC value, e.g. 'DMS-1.50' or 'DMR-1.50'. */
    dlnaDoc?: string;
}): string;
export declare const SERVICE_TYPES: {
    readonly contentDirectory: "urn:schemas-upnp-org:service:ContentDirectory:1";
    readonly connectionManager: "urn:schemas-upnp-org:service:ConnectionManager:1";
    readonly avTransport: "urn:schemas-upnp-org:service:AVTransport:1";
    readonly renderingControl: "urn:schemas-upnp-org:service:RenderingControl:1";
};
export declare const DEVICE_TYPES: {
    readonly mediaServer: "urn:schemas-upnp-org:device:MediaServer:1";
    readonly mediaRenderer: "urn:schemas-upnp-org:device:MediaRenderer:1";
};
