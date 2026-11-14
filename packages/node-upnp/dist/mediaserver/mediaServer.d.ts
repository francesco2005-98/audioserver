import type { IncomingMessage, ServerResponse } from 'node:http';
import type { UpnpLogger } from '../logger.js';
import { type DidlContainer, type DidlItem } from '../didl/didl.js';
import { type DeviceIdentity } from '../description/deviceDescription.js';
/** The root container object id per the UPnP ContentDirectory spec. */
export declare const ROOT_OBJECT_ID = "0";
export type BrowseFlag = 'BrowseMetadata' | 'BrowseDirectChildren';
export interface BrowseRequest {
    objectId: string;
    browseFlag: BrowseFlag;
    startingIndex: number;
    requestedCount: number;
    filter?: string;
    sortCriteria?: string;
}
export interface BrowseResult {
    /** Container/item shapes to serialise (module builds the DIDL). */
    objects: Array<DidlContainer | DidlItem>;
    /** Total matches (for paging); defaults to objects.length. */
    total?: number;
}
export interface SearchRequest {
    /** Container to search within; ROOT_OBJECT_ID means "the whole server". */
    containerId: string;
    /** The raw UPnP SearchCriteria expression (parse with {@link parseSearchCriteria}). */
    searchCriteria: string;
    startingIndex: number;
    requestedCount: number;
    filter?: string;
    sortCriteria?: string;
}
/**
 * The host's content backend. The MediaServer answers UPnP Browse (and, when
 * implemented, Search) by delegating to this — the host maps its own catalogue
 * onto neutral DIDL shapes, so the module never depends on the app's content
 * model.
 */
export interface ContentProvider {
    /** BrowseDirectChildren of a container (ROOT_OBJECT_ID for the top level). */
    browse(objectId: string, startingIndex: number, requestedCount: number): Promise<BrowseResult>;
    /** BrowseMetadata of a single object (optional; return null if unsupported). */
    browseMetadata?(objectId: string): Promise<DidlContainer | DidlItem | null>;
    /**
     * Search within a container. Optional: when omitted the server advertises empty
     * SearchCapabilities (the spec signal that tells control points not to search).
     * The host parses `searchCriteria` (see {@link parseSearchCriteria}) and returns
     * matching objects as neutral DIDL shapes.
     */
    search?(containerId: string, searchCriteria: string, startingIndex: number, requestedCount: number): Promise<BrowseResult>;
}
export interface UpnpMediaServerOptions {
    udn: string;
    friendlyName: () => string;
    baseUrl: () => string;
    provider: ContentProvider;
    /** ConnectionManager source protocolInfo (what this server serves). */
    sourceProtocolInfo?: string;
    /**
     * The searchable properties advertised in GetSearchCapabilities, e.g.
     * `'dc:title,upnp:artist,upnp:album'` or `'*'`. Only advertised when the
     * provider implements `search()`; omit for no search.
     */
    searchCapabilities?: string;
    identity?: Partial<DeviceIdentity>;
    logger?: UpnpLogger;
}
/** Sub-paths under the media-server base URL. */
export declare const MEDIA_SERVER_PATHS: {
    readonly device: "device.xml";
    readonly cdsScpd: "cds/scpd.xml";
    readonly cmsScpd: "cms/scpd.xml";
    readonly cdsControl: "cds/control";
    readonly cmsControl: "cms/control";
    readonly cdsEvent: "cds/event";
    readonly cmsEvent: "cms/event";
};
/**
 * A UPnP MediaServer: advertises a ContentDirectory + ConnectionManager and
 * answers Browse over a host-supplied `ContentProvider`. Serves device.xml, SCPD
 * and SOAP control under a base path via `handle(req, res, sub)`. Advertise the
 * device on an SsdpAdvertiser using `deviceTypeAndServices()`.
 */
export declare class UpnpMediaServer {
    private readonly opts;
    private readonly log?;
    constructor(opts: UpnpMediaServerOptions);
    get udn(): string;
    deviceTypeAndServices(): {
        deviceType: string;
        serviceTypes: string[];
    };
    /** `sub` is the path AFTER the media-server base, e.g. 'cds/control'. */
    handle(req: IncomingMessage, res: ServerResponse, sub: string): Promise<void>;
    private deviceXml;
    private handleCdsControl;
    private parseBrowse;
    private parseSearch;
    private search;
    private browse;
    /** Build a Browse/Search SOAP response (identical shape, different action name). */
    private buildDirectoryResponse;
    private handleCmsControl;
    private sendXml;
    private sendSoap;
    private sendSoapRaw;
    private notFound;
    private methodNotAllowed;
}
/**
 * Decide whether a provider-supplied object is a playable item or a browsable
 * container. A container is identified by its `upnp:class` (object.container.*)
 * or a `childCount`; everything else serialises as an item. Providers that build
 * containers should set `upnpClass` to a `object.container.*` value (the default
 * in {@link buildContainerElement}) so this stays unambiguous.
 */
/** A parsed UPnP SearchCriteria expression, in the shape a provider needs. */
export interface ParsedSearchCriteria {
    /** Free-text search terms extracted from the criteria (deduped). */
    terms: string[];
    /** Restrict to only playable items or only browsable containers, if the criteria says so. */
    classFilter: 'item' | 'container' | null;
    /** True when the criteria is the wildcard `*` (match everything). */
    matchAll: boolean;
}
/**
 * Parse a UPnP `SearchCriteria` expression into a host-friendly shape. The full
 * grammar is a boolean expression over properties; in practice control points send
 * a small set of shapes, so this extracts what a content backend actually needs:
 * the free-text term(s) from `contains`/`=` clauses on text properties, and a
 * coarse item-vs-container class restriction from `upnp:class derivedfrom "…"`.
 *
 * Examples it handles:
 *   `dc:title contains "beatles"`
 *   `(upnp:class derivedfrom "object.item.audioItem") and (dc:title contains "x")`
 *   `upnp:artist contains "foo" or dc:title contains "foo"`
 *   `*`  → matchAll
 */
export declare function parseSearchCriteria(criteria: string): ParsedSearchCriteria;
