/**
 * Minimal SOAP helpers for UPnP control (AVTransport / RenderingControl /
 * ContentDirectory / ConnectionManager). UPnP uses a tiny, regular subset of
 * SOAP, so we parse and build it with string/regex operations rather than a full
 * XML stack — matching how real devices are lenient about namespaces.
 */
export declare function escapeXml(value: string): string;
export declare function unescapeXml(value: string): string;
/** Extract the bare action name from a SOAPACTION header value. */
export declare function parseSoapAction(header: string | string[] | undefined): string;
/**
 * Extract a (possibly namespaced) tag's inner text and SOAP-unescape it.
 * Matches `<Tag>…</Tag>` or `<u:Tag …>…</u:Tag>` — namespace-tolerant.
 */
export declare function extractTag(xml: string, tag: string): string | null;
/** Build a SOAP action-response envelope with the given out-arguments. */
export declare function buildSoapResponse(serviceType: string, action: string, args?: Record<string, string>): string;
export interface BuildSoapRequestOptions {
    /**
     * InstanceID to send as the first argument. AVTransport and RenderingControl
     * actions all take one and it is virtually always 0, which is the default.
     * Pass `null` for services that take no InstanceID at all — ZoneGroupTopology,
     * DeviceProperties, ContentDirectory — since those reject the extra argument.
     */
    instanceId?: number | null;
}
/**
 * Build a SOAP action-request envelope. `args` values are inserted as-is, so a
 * caller passing DIDL metadata must pass it already XML-escaped (matching how
 * SetAVTransportURI carries an escaped DIDL string in CurrentURIMetaData).
 */
export declare function buildSoapRequest(serviceType: string, action: string, args?: Record<string, string>, options?: BuildSoapRequestOptions): string;
/** UPnP-style SOAP fault envelope with a UPnPError detail. */
export declare function buildSoapFault(message: string, errorCode?: number): string;
/** Extract the SOAP fault errorCode from a device response, if present. */
export declare function extractFaultCode(xml: string): string | null;
