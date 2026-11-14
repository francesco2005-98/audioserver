import type { IncomingMessage, ServerResponse } from 'node:http';
import type { UpnpLogger } from '../logger.js';
import { type ParsedDidlObject } from '../didl/didl.js';
import { type DeviceIdentity } from '../description/deviceDescription.js';
export type TransportState = 'STOPPED' | 'PLAYING' | 'PAUSED_PLAYBACK' | 'TRANSITIONING' | 'NO_MEDIA_PRESENT';
/**
 * The host's playback backend. A control point casting to this renderer calls
 * SOAP actions; the renderer translates them into these callbacks. The host
 * plays `uri` however it likes (its own engine/output) — the module never
 * decodes audio.
 */
export interface RendererHandler {
    /** A new URI was set (SetAVTransportURI). `metadata` is the parsed DIDL item. */
    onSetUri?(uri: string, metadata: ParsedDidlObject | null): void;
    /** Begin playing the current URI. `startAtSec` set when resuming from a Seek. */
    onPlay(uri: string, startAtSec?: number): void;
    onPause?(): void;
    onResume?(): void;
    onStop?(): void;
    onSeek?(seconds: number): void;
    onVolume?(percent: number): void;
    onMute?(muted: boolean): void;
    /**
     * Current playback position/duration for GetPositionInfo, if the host tracks
     * it. When omitted, the renderer estimates from wall-clock since play started.
     */
    getPosition?(): {
        elapsed: number;
        duration: number;
    } | null;
}
export interface UpnpMediaRendererOptions {
    /** Stable per-renderer UDN (uuid:...). */
    udn: string;
    /** Friendly name shown to control points (resolved per call so it can change). */
    friendlyName: () => string;
    /** Absolute base URL for this renderer, e.g. http://ip:7090/dlna-renderer/1 */
    baseUrl: () => string;
    /** Playback backend. */
    handler: RendererHandler;
    identity?: Partial<DeviceIdentity>;
    logger?: UpnpLogger;
}
/** Sub-paths under the renderer base URL. */
export declare const RENDERER_PATHS: {
    readonly device: "device.xml";
    readonly avtScpd: "avt/scpd.xml";
    readonly rcScpd: "rc/scpd.xml";
    readonly cmScpd: "cm/scpd.xml";
    readonly avtControl: "avt/control";
    readonly rcControl: "rc/control";
    readonly cmControl: "cm/control";
    readonly avtEvent: "avt/event";
    readonly rcEvent: "rc/event";
};
/**
 * A UPnP MediaRenderer: it accepts SetAVTransportURI + Play from any DLNA control
 * point and drives the host's playback via a small `RendererHandler`. Reports
 * transport state, duration and position via GetTransportInfo/GetPositionInfo and
 * GENA LastChange events, so controlling apps reflect play/pause and a timeline.
 *
 * The host serves device.xml + SCPD + SOAP control by routing HTTP requests under
 * the renderer's base path to `handle(req, res, sub)`; it advertises the device
 * on an SsdpAdvertiser (see deviceTypeAndServices()).
 */
export declare class UpnpMediaRenderer {
    private readonly opts;
    private transportState;
    private currentUri;
    private currentUriMetaData;
    private nextUri;
    private nextUriMetaData;
    private durationSec;
    private volume;
    private muted;
    private startedAtMs;
    private pausedElapsedSec;
    private readonly subscriptions;
    private renewTimer?;
    private readonly log?;
    constructor(opts: UpnpMediaRendererOptions);
    get udn(): string;
    /** The device type + service types for SSDP advertising. */
    deviceTypeAndServices(): {
        deviceType: string;
        serviceTypes: string[];
    };
    dispose(): void;
    /** Reflect a volume change that happened outside UPnP (host → renderer). */
    reflectVolume(percent: number): void;
    /** Reflect a transport-state change that happened outside UPnP. */
    reflectTransportState(state: TransportState): void;
    /** `sub` is the path AFTER the renderer base, e.g. 'avt/control'. */
    handle(req: IncomingMessage, res: ServerResponse, sub: string): Promise<void>;
    private deviceXml;
    private handleAvtControl;
    private actSetUri;
    private actSetNextUri;
    private actPlay;
    private actPause;
    private actStop;
    private actSeek;
    private actGetTransportInfo;
    private actGetPositionInfo;
    private actGetMediaInfo;
    private handleRcControl;
    private handleCmControl;
    private handleGena;
    private setState;
    private buildAvtLastChange;
    private buildRcLastChange;
    private notifySubscriber;
    private pruneSubscriptions;
    private elapsedSec;
    private sendXml;
    private sendSoap;
    private sendFault;
    private notFound;
}
