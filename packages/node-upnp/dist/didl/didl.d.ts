import { escapeXml } from '../soap/soap.js';
export { escapeXml };
/** A browsable folder in a DIDL result. */
export interface DidlContainer {
    id: string;
    parentId: string;
    title: string;
    /** upnp:class; defaults to a storage folder. */
    upnpClass?: string;
    /** Optional child count some controllers display. */
    childCount?: number;
    /** Optional absolute icon/art URL shown as the folder tile. */
    albumArtUri?: string;
    /**
     * Performer, for containers that have one — an album or artist container. Emitted
     * as `upnp:artist`, and as `dc:creator` unless {@link creator} overrides it.
     * Controllers use it to label and group album tiles.
     */
    artist?: string;
    /** `dc:creator`; falls back to {@link artist} when omitted. */
    creator?: string;
    /** Emitted as `upnp:genre` when present. */
    genre?: string;
}
/** A `<res>` resource on a playable item. */
export interface DidlResource {
    /** The playable URL a renderer will GET. */
    url: string;
    /** Full DLNA protocolInfo, e.g. `http-get:*:audio/mpeg:DLNA.ORG_PN=MP3;...`. */
    protocolInfo: string;
    /** Optional duration H:MM:SS[.mmm]. */
    duration?: string;
    /** Optional byte size. */
    size?: number;
    /** Optional audio descriptors. */
    bitrate?: number;
    sampleFrequency?: number;
    nrAudioChannels?: number;
}
/** A playable track in a DIDL result. */
export interface DidlItem {
    id: string;
    parentId: string;
    title: string;
    artist?: string;
    album?: string;
    creator?: string;
    albumArtUri?: string;
    /** upnp:class; defaults to a music track. */
    upnpClass?: string;
    /** Zero or more playable resources. */
    resources?: DidlResource[];
}
/** A parsed DIDL object (either kind), from parseDidl. */
export interface ParsedDidlObject {
    kind: 'item' | 'container';
    id: string;
    parentId: string;
    title: string;
    artist?: string;
    album?: string;
    albumArtUri?: string;
    upnpClass?: string;
    duration?: string;
    res?: string;
}
export declare function buildContainerElement(container: DidlContainer): string;
export declare function buildItemElement(item: DidlItem): string;
/** Wrap pre-built container/item element strings in a DIDL-Lite document. */
export declare function wrapDidl(elements: string[]): string;
/** Convenience: build a full DIDL document from container/item shapes. */
export declare function buildDidl(objects: Array<DidlContainer | DidlItem>): string;
/** Read a single DIDL text field from a (possibly SOAP-escaped) metadata blob. */
export declare function readDidlField(metadata: string, tag: string): string;
/** Read the res@duration attribute from a DIDL metadata blob. */
export declare function readDidlDuration(metadata: string): string | null;
/**
 * Parse the first item/container from a DIDL metadata blob into a neutral object.
 * Handles doubly-escaped SOAP payloads (unescaped once here).
 */
export declare function parseDidlObject(metadata: string): ParsedDidlObject | null;
