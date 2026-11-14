import { UpnpLogger } from '../logger.js';
/**
 * DLNA/UPnP GENA event subscriber.
 *
 * UPnP renderers report their own state (transport play/pause/stop, current track, volume,
 * mute) by way of GENA eventing: we send a SUBSCRIBE to the service's eventSubURL with a
 * CALLBACK pointing at a small HTTP server we host, and the renderer then pushes NOTIFY
 * requests whenever state changes. This is how device-side actions (someone pressing pause on
 * the speaker, turning the volume knob) flow back into our zone state.
 *
 * One subscriber instance manages the callback HTTP server plus one subscription per service
 * (AVTransport + RenderingControl). Subscriptions are auto-renewed before they expire and
 * re-established on failure.
 */
/**
 * Which service a NOTIFY came from. The two AV services are parsed into typed
 * events; any other service name a caller subscribes to (Sonos's
 * ZoneGroupTopology, say) is passed through untyped to {@link DlnaEventHandlers.onRaw}.
 */
export type DlnaEventKind = 'avtransport' | 'renderingcontrol' | (string & {});
export interface DlnaTransportEvent {
    /** Raw UPnP TransportState, e.g. PLAYING / PAUSED_PLAYBACK / STOPPED / TRANSITIONING. */
    transportState?: string;
    currentTrackUri?: string;
    /** Track duration in seconds, parsed from CurrentTrackDuration (HH:MM:SS). */
    durationSeconds?: number;
}
export interface DlnaRenderingEvent {
    /** Master volume 0..100 if present. */
    volume?: number;
    muted?: boolean;
}
/** Every NOTIFY, before (and regardless of) typed parsing. */
export interface DlnaRawEvent {
    /** Service the NOTIFY belongs to; undefined when the SID couldn't be mapped. */
    kind?: DlnaEventKind;
    /** The complete GENA property-set body. */
    body: string;
    /** The unescaped inner `LastChange` document, when the property set carries one. */
    lastChange?: string;
}
export interface DlnaEventHandlers {
    onTransport?: (event: DlnaTransportEvent) => void;
    onRendering?: (event: DlnaRenderingEvent) => void;
    /**
     * Raw access to every NOTIFY. Fires for services with no typed parser at all,
     * and lets a caller read state variables the typed events don't carry (Sonos
     * keeps its track metadata in vendor-namespaced LastChange vars).
     */
    onRaw?: (event: DlnaRawEvent) => void;
}
export interface DlnaEventSubscriberOptions {
    /** Optional structured logger. When omitted, the subscriber is silent. */
    logger?: UpnpLogger;
}
export declare class DlnaEventSubscriber {
    private readonly zoneId;
    private readonly localHost;
    private readonly handlers;
    private server?;
    private callbackBaseUrl?;
    private readonly subscriptions;
    private readonly sidToKind;
    private disposed;
    private readonly log?;
    constructor(zoneId: number | string, localHost: string, handlers: DlnaEventHandlers, options?: DlnaEventSubscriberOptions);
    /**
     * Start (or restart) subscriptions for the given service event URLs. Safe to call again with
     * updated URLs after a re-discovery; it renews what's unchanged and (re)subscribes the rest.
     */
    start(urls: {
        avTransportEventUrl?: string;
        renderingControlEventUrl?: string;
        /**
         * Further services to subscribe to, keyed by a caller-chosen kind. These get
         * no typed parsing — they surface through {@link DlnaEventHandlers.onRaw}.
         */
        extraServices?: Array<{
            kind: DlnaEventKind;
            eventUrl: string;
        }>;
    }): Promise<void>;
    dispose(): void;
    private ensureServer;
    private handleNotify;
    private dispatchNotify;
    private subscribe;
    private scheduleRenew;
    private sendSubscribe;
    private unsubscribe;
    private sendGenaRequest;
}
