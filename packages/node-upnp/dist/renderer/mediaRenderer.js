"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpnpMediaRenderer = exports.RENDERER_PATHS = void 0;
const node_http_1 = __importDefault(require("node:http"));
const soap_js_1 = require("../soap/soap.js");
const didl_js_1 = require("../didl/didl.js");
const deviceDescription_js_1 = require("../description/deviceDescription.js");
const scpd_js_1 = require("../description/scpd.js");
/** Sub-paths under the renderer base URL. */
exports.RENDERER_PATHS = {
    device: 'device.xml',
    avtScpd: 'avt/scpd.xml',
    rcScpd: 'rc/scpd.xml',
    cmScpd: 'cm/scpd.xml',
    avtControl: 'avt/control',
    rcControl: 'rc/control',
    cmControl: 'cm/control',
    avtEvent: 'avt/event',
    rcEvent: 'rc/event',
};
const AVT_NS = deviceDescription_js_1.SERVICE_TYPES.avTransport;
const RC_NS = deviceDescription_js_1.SERVICE_TYPES.renderingControl;
const CM_NS = deviceDescription_js_1.SERVICE_TYPES.connectionManager;
const SINK_PROTOCOL_INFO = [
    'audio/mpeg', 'audio/x-mpeg', 'audio/mp4', 'audio/aac', 'audio/flac',
    'audio/x-flac', 'audio/wav', 'audio/L16', 'application/ogg',
].map((mime) => `http-get:*:${mime}:*`).join(',');
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
class UpnpMediaRenderer {
    opts;
    transportState = 'NO_MEDIA_PRESENT';
    currentUri = '';
    currentUriMetaData = '';
    nextUri = '';
    nextUriMetaData = '';
    durationSec = 0;
    volume = 100;
    muted = false;
    startedAtMs = 0;
    pausedElapsedSec = 0;
    subscriptions = new Map();
    renewTimer;
    log;
    constructor(opts) {
        this.opts = opts;
        this.log = opts.logger;
        this.renewTimer = setInterval(() => this.pruneSubscriptions(), 30_000);
        this.renewTimer.unref?.();
    }
    get udn() {
        return this.opts.udn;
    }
    /** The device type + service types for SSDP advertising. */
    deviceTypeAndServices() {
        return {
            deviceType: deviceDescription_js_1.DEVICE_TYPES.mediaRenderer,
            serviceTypes: [AVT_NS, RC_NS, CM_NS],
        };
    }
    dispose() {
        if (this.renewTimer) {
            clearInterval(this.renewTimer);
            this.renewTimer = undefined;
        }
        this.subscriptions.clear();
    }
    /** Reflect a volume change that happened outside UPnP (host → renderer). */
    reflectVolume(percent) {
        this.volume = clampVolume(percent);
    }
    /** Reflect a transport-state change that happened outside UPnP. */
    reflectTransportState(state) {
        this.setState(state);
    }
    // ── HTTP handling ───────────────────────────────────────────────────────────
    /** `sub` is the path AFTER the renderer base, e.g. 'avt/control'. */
    async handle(req, res, sub) {
        const method = (req.method ?? 'GET').toUpperCase();
        if (method === 'GET' || method === 'HEAD') {
            if (sub === exports.RENDERER_PATHS.device) {
                return this.sendXml(res, this.deviceXml());
            }
            if (sub === exports.RENDERER_PATHS.avtScpd) {
                return this.sendXml(res, scpd_js_1.AV_TRANSPORT_SCPD);
            }
            if (sub === exports.RENDERER_PATHS.rcScpd) {
                return this.sendXml(res, scpd_js_1.RENDERING_CONTROL_SCPD);
            }
            if (sub === exports.RENDERER_PATHS.cmScpd) {
                return this.sendXml(res, scpd_js_1.CONNECTION_MANAGER_SINK_SCPD);
            }
            return this.notFound(res);
        }
        if (method === 'SUBSCRIBE' || method === 'UNSUBSCRIBE') {
            return this.handleGena(req, res, sub, method);
        }
        if (method === 'POST') {
            if (sub === exports.RENDERER_PATHS.avtControl)
                return this.handleAvtControl(req, res);
            if (sub === exports.RENDERER_PATHS.rcControl)
                return this.handleRcControl(req, res);
            if (sub === exports.RENDERER_PATHS.cmControl)
                return this.handleCmControl(req, res);
            return this.notFound(res);
        }
        return this.notFound(res);
    }
    deviceXml() {
        const base = this.opts.baseUrl();
        const svc = (name) => `${base}/${exports.RENDERER_PATHS[name]}`;
        return (0, deviceDescription_js_1.buildDeviceDescription)({
            deviceType: deviceDescription_js_1.DEVICE_TYPES.mediaRenderer,
            dlnaDoc: 'DMR-1.50',
            identity: {
                udn: this.opts.udn,
                friendlyName: this.opts.friendlyName(),
                ...this.opts.identity,
            },
            services: [
                {
                    serviceType: AVT_NS,
                    serviceId: 'urn:upnp-org:serviceId:AVTransport',
                    scpdUrl: svc('avtScpd'),
                    controlUrl: svc('avtControl'),
                    eventSubUrl: svc('avtEvent'),
                },
                {
                    serviceType: RC_NS,
                    serviceId: 'urn:upnp-org:serviceId:RenderingControl',
                    scpdUrl: svc('rcScpd'),
                    controlUrl: svc('rcControl'),
                    eventSubUrl: svc('rcEvent'),
                },
                {
                    serviceType: CM_NS,
                    serviceId: 'urn:upnp-org:serviceId:ConnectionManager',
                    scpdUrl: svc('cmScpd'),
                    controlUrl: svc('cmControl'),
                    eventSubUrl: `${base}/cm/event`,
                },
            ],
        });
    }
    // ── AVTransport SOAP ────────────────────────────────────────────────────────
    async handleAvtControl(req, res) {
        const action = (0, soap_js_1.parseSoapAction)(req.headers['soapaction']);
        const body = await readBody(req);
        try {
            switch (action) {
                case 'SetAVTransportURI':
                    return this.actSetUri(res, body);
                case 'SetNextAVTransportURI':
                    return this.actSetNextUri(res, body);
                case 'Play':
                    return this.actPlay(res);
                case 'Pause':
                    return this.actPause(res);
                case 'Stop':
                    return this.actStop(res);
                case 'Seek':
                    return this.actSeek(res, body);
                case 'GetTransportInfo':
                    return this.actGetTransportInfo(res);
                case 'GetPositionInfo':
                    return this.actGetPositionInfo(res);
                case 'GetMediaInfo':
                    return this.actGetMediaInfo(res);
                case 'GetTransportSettings':
                    return this.sendSoap(res, AVT_NS, 'GetTransportSettings', {
                        PlayMode: 'NORMAL',
                        RecQualityMode: 'NOT_IMPLEMENTED',
                    });
                case 'GetDeviceCapabilities':
                    return this.sendSoap(res, AVT_NS, 'GetDeviceCapabilities', {
                        PlayMedia: 'NETWORK,HDD',
                        RecMedia: 'NOT_IMPLEMENTED',
                        RecQualityModes: 'NOT_IMPLEMENTED',
                    });
                default:
                    return this.sendFault(res, 'Unsupported action');
            }
        }
        catch (error) {
            this.log?.warn?.('avt control failed', {
                action,
                message: error instanceof Error ? error.message : String(error),
            });
            return this.sendFault(res, 'Action failed');
        }
    }
    actSetUri(res, body) {
        const uri = (0, soap_js_1.extractTag)(body, 'CurrentURI') ?? '';
        const meta = (0, soap_js_1.extractTag)(body, 'CurrentURIMetaData') ?? '';
        this.currentUri = uri;
        this.currentUriMetaData = meta;
        this.durationSec = parseClock((0, didl_js_1.readDidlDuration)(meta) ?? '') ?? 0;
        this.pausedElapsedSec = 0;
        this.setState(uri ? 'STOPPED' : 'NO_MEDIA_PRESENT');
        this.opts.handler.onSetUri?.(uri, meta ? (0, didl_js_1.parseDidlObject)(meta) : null);
        this.sendSoap(res, AVT_NS, 'SetAVTransportURI', {});
    }
    actSetNextUri(res, body) {
        this.nextUri = (0, soap_js_1.extractTag)(body, 'NextURI') ?? '';
        this.nextUriMetaData = (0, soap_js_1.extractTag)(body, 'NextURIMetaData') ?? '';
        this.sendSoap(res, AVT_NS, 'SetNextAVTransportURI', {});
    }
    actPlay(res) {
        if (!this.currentUri) {
            return this.sendFault(res, 'No media', 701);
        }
        if (this.transportState === 'PAUSED_PLAYBACK') {
            this.opts.handler.onResume?.();
            this.startedAtMs = Date.now() - this.pausedElapsedSec * 1000;
            this.setState('PLAYING');
            return this.sendSoap(res, AVT_NS, 'Play', {});
        }
        this.startedAtMs = Date.now();
        this.pausedElapsedSec = 0;
        this.opts.handler.onPlay(this.currentUri);
        this.setState('PLAYING');
        this.sendSoap(res, AVT_NS, 'Play', {});
    }
    actPause(res) {
        this.opts.handler.onPause?.();
        this.pausedElapsedSec = this.elapsedSec();
        this.setState('PAUSED_PLAYBACK');
        this.sendSoap(res, AVT_NS, 'Pause', {});
    }
    actStop(res) {
        this.opts.handler.onStop?.();
        this.pausedElapsedSec = 0;
        this.setState('STOPPED');
        this.sendSoap(res, AVT_NS, 'Stop', {});
    }
    actSeek(res, body) {
        const unit = (0, soap_js_1.extractTag)(body, 'Unit') ?? '';
        const target = (0, soap_js_1.extractTag)(body, 'Target') ?? '';
        // Both units are an H:MM:SS clock, and this renderer plays one track at a time — so the
        // position relative to the track and the position on the media are the same number, which is
        // also what GetPositionInfo reports for both. A control point that asks in ABS_TIME (some do)
        // used to get an OK and no seek.
        if (unit === 'REL_TIME' || unit === 'ABS_TIME') {
            const seconds = parseClock(target);
            if (seconds !== null && this.currentUri) {
                this.opts.handler.onSeek?.(seconds);
                this.opts.handler.onPlay(this.currentUri, seconds);
                this.startedAtMs = Date.now() - seconds * 1000;
                this.pausedElapsedSec = 0;
                this.setState('PLAYING');
            }
        }
        this.sendSoap(res, AVT_NS, 'Seek', {});
    }
    actGetTransportInfo(res) {
        this.sendSoap(res, AVT_NS, 'GetTransportInfo', {
            CurrentTransportState: this.transportState,
            CurrentTransportStatus: 'OK',
            CurrentSpeed: '1',
        });
    }
    actGetPositionInfo(res) {
        const pos = this.opts.handler.getPosition?.();
        const elapsed = pos ? pos.elapsed : this.elapsedSec();
        const duration = pos ? pos.duration : this.durationSec;
        const rel = formatClock(elapsed);
        this.sendSoap(res, AVT_NS, 'GetPositionInfo', {
            Track: '1',
            TrackDuration: formatClock(duration),
            TrackMetaData: this.currentUriMetaData,
            TrackURI: this.currentUri,
            RelTime: rel,
            AbsTime: rel,
            RelCount: '2147483647',
            AbsCount: '2147483647',
        });
    }
    actGetMediaInfo(res) {
        this.sendSoap(res, AVT_NS, 'GetMediaInfo', {
            NrTracks: this.currentUri ? '1' : '0',
            MediaDuration: formatClock(this.durationSec),
            CurrentURI: this.currentUri,
            CurrentURIMetaData: this.currentUriMetaData,
            NextURI: this.nextUri,
            NextURIMetaData: this.nextUriMetaData,
            PlayMedium: this.currentUri ? 'NETWORK' : 'NONE',
            RecordMedium: 'NOT_IMPLEMENTED',
            WriteStatus: 'NOT_IMPLEMENTED',
        });
    }
    // ── RenderingControl SOAP ───────────────────────────────────────────────────
    async handleRcControl(req, res) {
        const action = (0, soap_js_1.parseSoapAction)(req.headers['soapaction']);
        const body = await readBody(req);
        switch (action) {
            case 'GetVolume':
                return this.sendSoap(res, RC_NS, 'GetVolume', { CurrentVolume: String(this.volume) });
            case 'SetVolume': {
                const desired = Number((0, soap_js_1.extractTag)(body, 'DesiredVolume') ?? '');
                if (Number.isFinite(desired)) {
                    this.volume = clampVolume(desired);
                    this.opts.handler.onVolume?.(this.volume);
                }
                return this.sendSoap(res, RC_NS, 'SetVolume', {});
            }
            case 'GetMute':
                return this.sendSoap(res, RC_NS, 'GetMute', { CurrentMute: this.muted ? '1' : '0' });
            case 'SetMute': {
                const desired = ((0, soap_js_1.extractTag)(body, 'DesiredMute') ?? '').trim();
                this.muted = desired === '1' || desired.toLowerCase() === 'true';
                this.opts.handler.onMute?.(this.muted);
                return this.sendSoap(res, RC_NS, 'SetMute', {});
            }
            default:
                return this.sendFault(res, 'Unsupported action');
        }
    }
    async handleCmControl(req, res) {
        const action = (0, soap_js_1.parseSoapAction)(req.headers['soapaction']);
        await readBody(req);
        if (action === 'GetProtocolInfo') {
            return this.sendSoap(res, CM_NS, 'GetProtocolInfo', {
                Source: '',
                Sink: SINK_PROTOCOL_INFO,
            });
        }
        return this.sendFault(res, 'Unsupported action');
    }
    // ── GENA eventing ───────────────────────────────────────────────────────────
    async handleGena(req, res, sub, method) {
        const service = sub === exports.RENDERER_PATHS.avtEvent
            ? 'AVTransport'
            : sub === exports.RENDERER_PATHS.rcEvent
                ? 'RenderingControl'
                : null;
        if (!service) {
            return this.notFound(res);
        }
        if (method === 'UNSUBSCRIBE') {
            const sid = String(req.headers['sid'] ?? '');
            this.subscriptions.delete(sid);
            res.writeHead(200);
            res.end();
            return;
        }
        const existingSid = String(req.headers['sid'] ?? '');
        const timeout = 1800;
        if (existingSid && this.subscriptions.has(existingSid)) {
            const s = this.subscriptions.get(existingSid);
            s.expiresAt = Date.now() + timeout * 1000;
            res.writeHead(200, { SID: existingSid, TIMEOUT: `Second-${timeout}` });
            res.end();
            return;
        }
        const callbackUrl = firstCallback(String(req.headers['callback'] ?? ''));
        const sid = `uuid:${this.opts.udn.slice(5)}-${service}-${this.subscriptions.size + 1}`;
        if (callbackUrl) {
            this.subscriptions.set(sid, {
                sid,
                callbackUrl,
                expiresAt: Date.now() + timeout * 1000,
                seq: 0,
                service,
            });
        }
        res.writeHead(200, { SID: sid, TIMEOUT: `Second-${timeout}` });
        res.end();
        if (callbackUrl) {
            this.notifySubscriber(this.subscriptions.get(sid));
        }
    }
    setState(state) {
        if (this.transportState === state) {
            return;
        }
        this.transportState = state;
        for (const s of this.subscriptions.values()) {
            if (s.service === 'AVTransport') {
                this.notifySubscriber(s);
            }
        }
    }
    buildAvtLastChange() {
        const inner = `<TransportState val="${(0, soap_js_1.escapeXml)(this.transportState)}"/>` +
            `<CurrentTrackURI val="${(0, soap_js_1.escapeXml)(this.currentUri)}"/>` +
            `<CurrentTrackDuration val="${(0, soap_js_1.escapeXml)(formatClock(this.durationSec))}"/>` +
            `<CurrentTrackMetaData val="${(0, soap_js_1.escapeXml)(this.currentUriMetaData)}"/>` +
            `<AVTransportURI val="${(0, soap_js_1.escapeXml)(this.currentUri)}"/>`;
        return `<Event xmlns="urn:schemas-upnp-org:metadata-1-0/AVT/"><InstanceID val="0">${inner}</InstanceID></Event>`;
    }
    buildRcLastChange() {
        const inner = `<Volume channel="Master" val="${this.volume}"/>` +
            `<Mute channel="Master" val="${this.muted ? 1 : 0}"/>`;
        return `<Event xmlns="urn:schemas-upnp-org:metadata-1-0/RCS/"><InstanceID val="0">${inner}</InstanceID></Event>`;
    }
    notifySubscriber(sub) {
        const lastChange = sub.service === 'AVTransport'
            ? this.buildAvtLastChange()
            : this.buildRcLastChange();
        const propertyset = '<?xml version="1.0" encoding="utf-8"?>' +
            '<e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0">' +
            `<e:property><LastChange>${(0, soap_js_1.escapeXml)(lastChange)}</LastChange></e:property>` +
            '</e:propertyset>';
        let url;
        try {
            url = new URL(sub.callbackUrl);
        }
        catch {
            return;
        }
        const seq = sub.seq;
        sub.seq += 1;
        const reqOptions = {
            method: 'NOTIFY',
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname + url.search,
            headers: {
                'Content-Type': 'text/xml; charset="utf-8"',
                NT: 'upnp:event',
                NTS: 'upnp:propchange',
                SID: sub.sid,
                SEQ: String(seq),
                'Content-Length': Buffer.byteLength(propertyset),
            },
        };
        const clientReq = node_http_1.default.request(reqOptions, (r) => r.resume());
        clientReq.on('error', () => { });
        clientReq.end(propertyset);
    }
    pruneSubscriptions() {
        const now = Date.now();
        for (const [sid, s] of this.subscriptions) {
            if (s.expiresAt <= now) {
                this.subscriptions.delete(sid);
            }
        }
    }
    // ── Helpers ─────────────────────────────────────────────────────────────────
    elapsedSec() {
        if (this.transportState === 'PAUSED_PLAYBACK') {
            return this.pausedElapsedSec;
        }
        if (this.transportState !== 'PLAYING' || !this.startedAtMs) {
            return 0;
        }
        const e = Math.floor((Date.now() - this.startedAtMs) / 1000);
        return this.durationSec > 0 ? Math.min(e, this.durationSec) : e;
    }
    sendXml(res, xml) {
        res.writeHead(200, { 'Content-Type': 'text/xml; charset="utf-8"', 'Cache-Control': 'no-cache' });
        res.end(xml);
    }
    sendSoap(res, ns, action, args) {
        res.writeHead(200, { 'Content-Type': 'text/xml; charset="utf-8"', EXT: '' });
        res.end((0, soap_js_1.buildSoapResponse)(ns, action, args));
    }
    sendFault(res, message, code = 401) {
        res.writeHead(500, { 'Content-Type': 'text/xml; charset="utf-8"' });
        res.end((0, soap_js_1.buildSoapFault)(message, code));
    }
    notFound(res) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not-found');
    }
}
exports.UpnpMediaRenderer = UpnpMediaRenderer;
function clampVolume(v) {
    return Math.max(0, Math.min(100, Math.round(v)));
}
function firstCallback(header) {
    const m = /<([^>]+)>/.exec(header);
    return m?.[1] ?? header.trim();
}
async function readBody(req) {
    const MAX = 512 * 1024;
    const chunks = [];
    let total = 0;
    return new Promise((resolve) => {
        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > MAX)
                return;
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}
function parseClock(value) {
    const t = value.trim();
    if (!t)
        return null;
    const parts = t.split(':').map((p) => parseFloat(p));
    if (parts.some((n) => !Number.isFinite(n)))
        return null;
    let sec = 0;
    for (const p of parts)
        sec = sec * 60 + p;
    return Math.round(sec);
}
function formatClock(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${h}:${pad(m)}:${pad(sec)}`;
}
