"use strict";
// GENA eventing for S1 speakers.
//
// A Sonos speaker pushes its state to whoever subscribes: transport and track
// metadata on AVTransport, volume/mute on RenderingControl, and group reshuffles
// on ZoneGroupTopology. The subscription machinery — callback server, renewals,
// re-subscribe on failure — comes from @audioserver/node-upnp; this module adds the
// Sonos payload reading, which needs more state variables than node-upnp's typed
// DLNA events carry (notably the vendor-namespaced `r:EnqueuedTransportURI*`).
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.S1EventBridge = void 0;
exports.resolveLocalAddress = resolveLocalAddress;
const node_net_1 = __importDefault(require("node:net"));
const node_upnp_1 = require("@audioserver/node-upnp");
const soap_1 = require("./soap");
const topology_1 = require("./topology");
const TOPOLOGY_KIND = 'zonegrouptopology';
class S1EventBridge {
    host;
    handlers;
    options;
    subscriber = null;
    disposed = false;
    constructor(host, handlers, options = {}) {
        this.host = host;
        this.handlers = handlers;
        this.options = options;
    }
    async start() {
        if (this.disposed || this.subscriber) {
            return;
        }
        const port = this.options.port ?? soap_1.SONOS_UPNP_PORT;
        // The speaker POSTs its NOTIFYs back to us, so it needs an address of ours that
        // it can actually reach. Asking the routing table which local address a socket to
        // *this speaker* uses beats guessing at an interface.
        const localHost = await resolveLocalAddress(this.host, port);
        if (!localHost) {
            throw new Error(`could not determine a local address reachable from ${this.host}`);
        }
        if (this.disposed) {
            return;
        }
        const subscriber = new node_upnp_1.DlnaEventSubscriber(`sonos-s1:${this.host}`, localHost, {
            onRaw: (event) => this.handleRaw(event.kind, event.body, event.lastChange),
        });
        this.subscriber = subscriber;
        await subscriber.start({
            avTransportEventUrl: (0, soap_1.serviceEventUrl)(this.host, 'AVTransport', port),
            renderingControlEventUrl: (0, soap_1.serviceEventUrl)(this.host, 'RenderingControl', port),
            extraServices: [
                { kind: TOPOLOGY_KIND, eventUrl: (0, soap_1.serviceEventUrl)(this.host, 'ZoneGroupTopology', port) },
            ],
        });
    }
    dispose() {
        this.disposed = true;
        this.subscriber?.dispose();
        this.subscriber = null;
    }
    handleRaw(kind, body, lastChange) {
        // ZoneGroupTopology puts its state straight in the property set, with no
        // LastChange document at all.
        if (kind === TOPOLOGY_KIND || (!lastChange && /ZoneGroupState/i.test(body))) {
            const state = (0, node_upnp_1.extractTag)(body, 'ZoneGroupState');
            if (state) {
                const groups = (0, topology_1.parseZoneGroups)(state);
                if (groups.length > 0) {
                    this.handlers.onTopology?.(groups);
                }
            }
            return;
        }
        if (!lastChange) {
            return;
        }
        if (kind === 'renderingcontrol') {
            const event = parseRendering(lastChange);
            if (event) {
                this.handlers.onRendering?.(event);
            }
            return;
        }
        const event = parseTransport(lastChange);
        if (event) {
            this.handlers.onTransport?.(event);
        }
    }
}
exports.S1EventBridge = S1EventBridge;
function parseTransport(lastChange) {
    const event = {
        transportState: attrVal(lastChange, 'TransportState'),
        currentTrackUri: attrVal(lastChange, 'CurrentTrackURI'),
        currentTrackMetadata: attrVal(lastChange, 'CurrentTrackMetaData'),
        // Sonos reports what was *put on* the transport (the station, the playlist) in
        // its own namespace, distinct from the track currently playing out of it.
        enqueuedTransportUri: attrVal(lastChange, 'r:EnqueuedTransportURI') ?? attrVal(lastChange, 'AVTransportURI'),
        enqueuedTransportMetadata: attrVal(lastChange, 'r:EnqueuedTransportURIMetaData') ??
            attrVal(lastChange, 'AVTransportURIMetaData'),
    };
    return Object.values(event).some((v) => v !== undefined) ? event : null;
}
function parseRendering(lastChange) {
    const event = {};
    const volume = channelAttrVal(lastChange, 'Volume');
    if (volume !== undefined) {
        const n = Number(volume);
        if (Number.isFinite(n)) {
            event.volume = Math.min(100, Math.max(0, Math.round(n)));
        }
    }
    const mute = channelAttrVal(lastChange, 'Mute');
    if (mute !== undefined) {
        event.muted = mute === '1' || mute.toLowerCase() === 'true';
    }
    return event.volume !== undefined || event.muted !== undefined ? event : null;
}
/**
 * LastChange entries are `<Tag val="…"/>`. The value is XML-escaped, which is how a
 * whole DIDL document fits inside an attribute.
 */
function attrVal(xml, tag) {
    const re = new RegExp(`<${escapeTag(tag)}\\b[^>]*\\bval="([^"]*)"`, 'i');
    const raw = re.exec(xml)?.[1];
    if (raw === undefined) {
        return undefined;
    }
    const value = (0, node_upnp_1.unescapeXml)(raw);
    return value === '' ? undefined : value;
}
/** RenderingControl reports per channel; the Master channel is the one that matters. */
function channelAttrVal(xml, tag) {
    const master = new RegExp(`<${tag}\\b[^>]*channel="Master"[^>]*\\bval="([^"]*)"|<${tag}\\b[^>]*\\bval="([^"]*)"[^>]*channel="Master"`, 'i').exec(xml);
    if (master) {
        return master[1] ?? master[2];
    }
    return new RegExp(`<${tag}\\b[^>]*\\bval="([^"]*)"`, 'i').exec(xml)?.[1];
}
function escapeTag(tag) {
    return tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** Which of our addresses can this speaker reach us on? Ask the routing table. */
function resolveLocalAddress(host, port) {
    return new Promise((resolve) => {
        const socket = node_net_1.default.connect({ host, port });
        const done = (value) => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(value);
        };
        socket.setTimeout(3_000);
        socket.once('connect', () => done(socket.localAddress ?? null));
        socket.once('timeout', () => done(null));
        socket.once('error', () => done(null));
    });
}
