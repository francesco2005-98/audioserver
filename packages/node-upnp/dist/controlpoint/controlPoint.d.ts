import type { UpnpLogger } from '../logger.js';
import { type DlnaEventHandlers } from '../gena/eventSubscriber.js';
/**
 * A UPnP control point (SOAP client) for driving an external AVTransport /
 * RenderingControl renderer — the "we push to an external renderer" side, the
 * inverse of a MediaRenderer server.
 *
 * The caller supplies the stream URI and a ready-made DIDL-Lite metadata string;
 * this class owns the protocol: endpoint discovery, the SOAP POST with its
 * device quirks (silent-timeout-as-accepted, 701 TRANSITIONING retry on Play),
 * strict command serialization so overlapping Stop/SetURI/Play can't interleave,
 * and optional GENA event subscription for device-side state.
 */
export interface DlnaControlPointOptions {
    /** Renderer IP or hostname. When set, control URLs are resolved via SSDP against this host. */
    host?: string;
    /** Manual AVTransport control URL. Skips discovery for playback. */
    controlUrl?: string;
    /** Manual RenderingControl control URL. Derived from controlUrl when omitted. */
    renderingControlUrl?: string;
    /** When no host is set, browse the network via SSDP and match a renderer. Defaults to true. */
    autoDiscover?: boolean;
    /** Match a discovered renderer by its friendly name. */
    deviceName?: string;
    /** Default per-command timeout. Defaults to 2500ms. */
    commandTimeoutMs?: number;
    /** Optional structured logger. When omitted, the control point is silent. */
    logger?: UpnpLogger;
}
export declare class DlnaControlPoint {
    private readonly log?;
    private readonly controllers;
    private readonly commandTimeoutMs;
    private host;
    private controlUrl?;
    private renderingControlUrl?;
    private connectionManagerUrl?;
    /** Cached answer to GetProtocolInfo; the sink list is a property of the device, not of a session. */
    private sinkContentTypes?;
    private discoveryPromise?;
    private readonly autoDiscover;
    private readonly deviceName;
    private commandChain;
    private eventSubscriber?;
    private eventHandlers?;
    private eventCallbackHost;
    private avTransportEventUrl?;
    private renderingControlEventUrl?;
    private eventDiscoveryStarted;
    constructor(opts?: DlnaControlPointOptions);
    /**
     * Resolve the control URLs. Returns true once an AVTransport control URL is
     * known (from manual config or SSDP discovery). Concurrent callers share one
     * in-flight discovery.
     */
    ensureEndpoints(): Promise<boolean>;
    /**
     * SetAVTransportURI: hand the renderer a stream URI plus a caller-supplied
     * DIDL-Lite metadata string, then Play. Sends the full Stop→SetURI→Play
     * sequence, serialized against any other in-flight command.
     */
    setUri(uri: string, didlMetadata: string): Promise<boolean>;
    /**
     * Re-send SetAVTransportURI ONLY (no Stop/Play) so the renderer adopts richer
     * metadata (e.g. title/duration arriving after the initial play) without
     * interrupting playback. Serialized against other commands.
     */
    updateMetadata(uri: string, didlMetadata: string): Promise<boolean>;
    play(): Promise<boolean>;
    pause(): Promise<boolean>;
    stop(): Promise<boolean>;
    /**
     * The MIME types this renderer says it can play, from ConnectionManager::GetProtocolInfo's `Sink`.
     *
     * A UPnP renderer publishes what it accepts as protocolInfo entries — `http-get:*:audio/flac:*` —
     * and asking is the only way to know whether a stream will play before sending it. A renderer that
     * cannot decode what it is given does not complain; it plays silence.
     *
     * Returns `null` when the device has no ConnectionManager, does not answer, or answers with
     * something unparseable — deliberately not an empty array, because "it told us nothing" and "it
     * accepts nothing" must not read the same to a caller deciding what to send. Cached after the first
     * answer.
     */
    getSinkContentTypes(): Promise<string[] | null>;
    setVolume(percent: number): Promise<boolean>;
    /**
     * Subscribe to GENA events (transport state, volume/mute) from the renderer.
     * Resolves the event endpoints (via discovery when only a control URL is
     * known) and starts a DlnaEventSubscriber. `localHost` is the LAN address the
     * renderer should call back to.
     */
    subscribeEvents(handlers: DlnaEventHandlers, localHost?: string): Promise<void>;
    dispose(): void;
    private resolveEndpoints;
    /**
     * Best-effort background fetch of the renderer's event (GENA) endpoints when only a control
     * URL was known. Does not affect playback; on success it starts the event subscription.
     */
    private resolveEventEndpoints;
    private autoResolveHost;
    private sendPlaybackWithSoap;
    /**
     * Run a task strictly after any previous one for this control point has settled, so
     * overlapping Stop/SetURI/Play sequences can never interleave on the renderer.
     */
    private enqueueResult;
    private invokeActionWithRetry;
    private invokeAction;
    private invokeRenderingAction;
    private invokeServiceAction;
    private buildSetUriBody;
    private buildPlayBody;
    private buildPauseBody;
    private buildStopBody;
    private buildSetVolumeBody;
    private deriveRenderingUrl;
    private applyDiscoveredEndpoints;
    /**
     * Start (or refresh) GENA event subscriptions so device-side actions (play/pause/stop on the
     * renderer, volume knob) flow back to the caller's handlers. Only runs when the caller asked
     * for events (subscribeEvents) and the renderer advertised event endpoints; manual
     * controlUrl-only configs won't have them.
     */
    private ensureEventSubscription;
}
/**
 * Pull the MIME types out of a GetProtocolInfo response's `Sink`.
 *
 * The list is comma-separated protocolInfo entries, each `protocol:network:mime:additional` — so the
 * third colon-separated field is the format. Entries a renderer publishes for other protocols
 * (rtsp-rtp-udp, internal) keep their own MIME field, which is why the whole field is taken rather
 * than a substring match on the raw string: `audio/flac` must not be found inside
 * `application/x-flac-container`.
 */
export declare function parseSinkContentTypes(soapResponse: string): string[] | null;
