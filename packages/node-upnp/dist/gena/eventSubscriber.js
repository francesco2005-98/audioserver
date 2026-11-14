"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DlnaEventSubscriber = void 0;
const node_http_1 = __importDefault(require("node:http"));
// Requested subscription lifetime. Renewed a little before expiry.
const SUBSCRIBE_TIMEOUT_SEC = 300;
const REQUEST_TIMEOUT_MS = 4000;
class DlnaEventSubscriber {
    zoneId;
    localHost;
    handlers;
    server;
    callbackBaseUrl;
    subscriptions = new Map();
    sidToKind = new Map();
    disposed = false;
    log;
    constructor(zoneId, localHost, handlers, options = {}) {
        this.zoneId = zoneId;
        this.localHost = localHost;
        this.handlers = handlers;
        this.log = options.logger;
    }
    /**
     * Start (or restart) subscriptions for the given service event URLs. Safe to call again with
     * updated URLs after a re-discovery; it renews what's unchanged and (re)subscribes the rest.
     */
    async start(urls) {
        if (this.disposed) {
            return;
        }
        await this.ensureServer();
        if (!this.callbackBaseUrl) {
            return;
        }
        const targets = [
            { kind: 'avtransport', url: urls.avTransportEventUrl },
            { kind: 'renderingcontrol', url: urls.renderingControlEventUrl },
            ...(urls.extraServices ?? []).map((s) => ({ kind: s.kind, url: s.eventUrl })),
        ];
        for (const { kind, url } of targets) {
            if (!url) {
                continue;
            }
            const existing = this.subscriptions.get(kind);
            // A subscription for this exact service already exists — leave it alone. It's either
            // active or mid-retry with its own timer; recreating it here would orphan that timer and
            // spawn a parallel subscribe loop (compounding failures). Only replace when the URL changed.
            if (existing && existing.eventUrl === url) {
                continue;
            }
            if (existing?.renewTimer) {
                clearTimeout(existing.renewTimer);
            }
            const sub = {
                kind,
                eventUrl: url,
                timeoutSec: SUBSCRIBE_TIMEOUT_SEC,
                active: false,
                failures: 0,
            };
            this.subscriptions.set(kind, sub);
            await this.subscribe(sub);
        }
    }
    dispose() {
        this.disposed = true;
        for (const sub of this.subscriptions.values()) {
            if (sub.renewTimer) {
                clearTimeout(sub.renewTimer);
            }
            void this.unsubscribe(sub);
        }
        this.subscriptions.clear();
        this.sidToKind.clear();
        if (this.server) {
            this.server.close();
            this.server = undefined;
        }
    }
    async ensureServer() {
        if (this.server) {
            return;
        }
        const server = node_http_1.default.createServer((req, res) => this.handleNotify(req, res));
        server.on('error', (err) => {
            this.log?.warn?.('DLNA event callback server error', {
                zoneId: this.zoneId,
                message: err instanceof Error ? err.message : String(err),
            });
        });
        await new Promise((resolve) => {
            // Bind to all interfaces on an ephemeral port; advertise the LAN host so the renderer
            // can reach us. Port 0 lets the OS pick a free port.
            server.listen(0, '0.0.0.0', () => resolve());
        });
        const address = server.address();
        if (!address || typeof address.port !== 'number') {
            server.close();
            this.log?.warn?.('DLNA event callback server failed to bind', { zoneId: this.zoneId });
            return;
        }
        this.server = server;
        this.callbackBaseUrl = `http://${this.localHost}:${address.port}`;
        this.log?.debug?.('DLNA event callback server listening', {
            zoneId: this.zoneId,
            callback: this.callbackBaseUrl,
        });
    }
    handleNotify(req, res) {
        if ((req.method ?? '').toUpperCase() !== 'NOTIFY') {
            res.writeHead(405);
            res.end();
            return;
        }
        const sid = req.headers.sid?.trim();
        const chunks = [];
        req.on('data', (c) => {
            // Guard against a runaway body.
            if (chunks.reduce((n, b) => n + b.length, 0) < 256 * 1024) {
                chunks.push(c);
            }
        });
        req.on('end', () => {
            // GENA requires a 200 with no body; ack promptly regardless of parse outcome.
            res.writeHead(200);
            res.end();
            const body = Buffer.concat(chunks).toString('utf8');
            const kind = sid ? this.sidToKind.get(sid) : undefined;
            this.log?.debug?.('DLNA NOTIFY received', {
                zoneId: this.zoneId,
                sid,
                kind: kind ?? '(unmapped)',
                bytes: body.length,
            });
            try {
                this.dispatchNotify(kind, body);
            }
            catch (err) {
                this.log?.debug?.('DLNA NOTIFY parse failed', {
                    zoneId: this.zoneId,
                    message: err instanceof Error ? err.message : String(err),
                });
            }
        });
        req.on('error', () => {
            if (!res.writableEnded) {
                res.writeHead(200);
                res.end();
            }
        });
    }
    dispatchNotify(kind, body) {
        const lastChange = extractLastChange(body) ?? undefined;
        // Infer the service from the payload when the SID couldn't be mapped (e.g. after a
        // renew). Only ever guesses between the two typed services — a caller's own service
        // is identified by its SID or not at all.
        const resolvedKind = kind ??
            (lastChange
                ? /TransportState|CurrentTrackURI/i.test(lastChange)
                    ? 'avtransport'
                    : 'renderingcontrol'
                : undefined);
        // Raw first, and unconditionally: some services (ZoneGroupTopology) put their state
        // straight in the property set rather than in a LastChange document.
        this.handlers.onRaw?.({ kind: resolvedKind, body, lastChange });
        if (!lastChange) {
            return;
        }
        if (resolvedKind === 'avtransport') {
            const event = parseTransportLastChange(lastChange);
            if (event && (event.transportState || event.currentTrackUri || event.durationSeconds != null)) {
                this.handlers.onTransport?.(event);
            }
        }
        else if (resolvedKind === 'renderingcontrol') {
            const event = parseRenderingLastChange(lastChange);
            if (event && (event.volume != null || event.muted != null)) {
                this.handlers.onRendering?.(event);
            }
        }
    }
    async subscribe(sub) {
        if (this.disposed || !this.callbackBaseUrl) {
            return;
        }
        try {
            const { sid, timeoutSec } = await this.sendSubscribe(sub.eventUrl, sub.sid);
            if (sub.sid && sub.sid !== sid) {
                this.sidToKind.delete(sub.sid);
            }
            sub.sid = sid;
            sub.timeoutSec = timeoutSec;
            sub.active = true;
            sub.failures = 0;
            if (sid) {
                this.sidToKind.set(sid, sub.kind);
            }
            this.scheduleRenew(sub);
            this.log?.debug?.('DLNA subscribed', { zoneId: this.zoneId, kind: sub.kind, sid, timeoutSec });
        }
        catch (err) {
            sub.active = false;
            sub.failures += 1;
            // A failed renew (esp. 412 Precondition Failed) means the renderer no longer knows our
            // SID. Drop it so the retry is a FRESH subscribe (CALLBACK, no SID) — otherwise we keep
            // re-sending the stale SID and get 412 forever.
            if (sub.sid) {
                this.sidToKind.delete(sub.sid);
                sub.sid = undefined;
            }
            const backoffMs = Math.min(30_000, 2000 * sub.failures);
            this.log?.debug?.('DLNA subscribe failed; will retry', {
                zoneId: this.zoneId,
                kind: sub.kind,
                failures: sub.failures,
                backoffMs,
                message: err instanceof Error ? err.message : String(err),
            });
            if (sub.renewTimer) {
                clearTimeout(sub.renewTimer);
            }
            sub.renewTimer = setTimeout(() => {
                void this.subscribe(sub);
            }, backoffMs);
            sub.renewTimer.unref?.();
        }
    }
    scheduleRenew(sub) {
        if (sub.renewTimer) {
            clearTimeout(sub.renewTimer);
        }
        // Renew at ~half the granted lifetime (min 30s) so we never lapse.
        const renewMs = Math.max(30_000, (sub.timeoutSec * 1000) / 2);
        sub.renewTimer = setTimeout(() => {
            // Some renderers (B&O) reject SID-based renews with 412. Renewing as a fresh subscribe
            // (drop the SID → send CALLBACK again) is universally accepted; UNSUBSCRIBE the old SID
            // first so we don't leak subscriptions on the device.
            const staleSid = sub.sid;
            if (staleSid) {
                this.sidToKind.delete(staleSid);
                sub.sid = undefined;
                void this.sendGenaRequest('UNSUBSCRIBE', sub.eventUrl, { SID: staleSid }).catch(() => { });
            }
            void this.subscribe(sub);
        }, renewMs);
        sub.renewTimer.unref?.();
    }
    sendSubscribe(eventUrl, existingSid) {
        const callback = `<${this.callbackBaseUrl}/notify>`;
        const headers = existingSid
            ? { SID: existingSid, TIMEOUT: `Second-${SUBSCRIBE_TIMEOUT_SEC}` }
            : { CALLBACK: callback, NT: 'upnp:event', TIMEOUT: `Second-${SUBSCRIBE_TIMEOUT_SEC}` };
        return this.sendGenaRequest('SUBSCRIBE', eventUrl, headers).then((res) => {
            const sid = res.headers['sid']?.trim() || existingSid;
            const timeoutSec = parseTimeoutHeader(res.headers['timeout']);
            return { sid, timeoutSec };
        });
    }
    async unsubscribe(sub) {
        if (!sub.sid) {
            return;
        }
        try {
            await this.sendGenaRequest('UNSUBSCRIBE', sub.eventUrl, { SID: sub.sid });
        }
        catch {
            /* best-effort */
        }
    }
    sendGenaRequest(method, eventUrl, headers) {
        return new Promise((resolve, reject) => {
            let url;
            try {
                url = new URL(eventUrl);
            }
            catch {
                reject(new Error('invalid event url'));
                return;
            }
            const req = node_http_1.default.request({
                method,
                hostname: url.hostname,
                port: url.port || 80,
                path: `${url.pathname}${url.search}`,
                headers,
                timeout: REQUEST_TIMEOUT_MS,
            }, (res) => {
                res.resume(); // drain
                if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300) {
                    resolve({ statusCode: res.statusCode ?? 200, headers: res.headers });
                }
                else {
                    reject(new Error(`GENA ${method} HTTP ${res.statusCode}`));
                }
            });
            req.on('timeout', () => req.destroy(new Error('GENA request timeout')));
            req.on('error', reject);
            req.end();
        });
    }
}
exports.DlnaEventSubscriber = DlnaEventSubscriber;
function parseTimeoutHeader(value) {
    if (!value) {
        return SUBSCRIBE_TIMEOUT_SEC;
    }
    const match = /Second-(\d+)/i.exec(value);
    if (match?.[1]) {
        const n = Number(match[1]);
        if (Number.isFinite(n) && n > 0) {
            return n;
        }
    }
    return SUBSCRIBE_TIMEOUT_SEC;
}
/**
 * GENA property-set bodies wrap the meaningful state in a `LastChange` property whose value is
 * an XML-escaped document. Pull that inner document out (unescaped).
 */
function extractLastChange(body) {
    const match = /<LastChange>([\s\S]*?)<\/LastChange>/i.exec(body);
    if (!match?.[1]) {
        return null;
    }
    return unescapeXml(match[1].trim());
}
function parseTransportLastChange(xml) {
    const transportState = attrVal(xml, 'TransportState');
    const currentTrackUri = attrVal(xml, 'CurrentTrackURI');
    const durationStr = attrVal(xml, 'CurrentTrackDuration');
    const durationSeconds = durationStr ? parseUpnpDuration(durationStr) : undefined;
    return {
        transportState: transportState || undefined,
        currentTrackUri: currentTrackUri || undefined,
        durationSeconds: durationSeconds != null && durationSeconds > 0 ? durationSeconds : undefined,
    };
}
function parseRenderingLastChange(xml) {
    // Prefer the Master channel; fall back to any channel present.
    const volume = channelAttrVal(xml, 'Volume');
    const mute = channelAttrVal(xml, 'Mute');
    const event = {};
    if (volume != null) {
        const n = Number(volume);
        if (Number.isFinite(n)) {
            event.volume = Math.min(100, Math.max(0, Math.round(n)));
        }
    }
    if (mute != null) {
        event.muted = mute === '1' || mute.toLowerCase() === 'true';
    }
    return event;
}
/** Read `<Tag val="X"/>` (the AVTransport LastChange event style). */
function attrVal(xml, tag) {
    const re = new RegExp(`<${tag}\\b[^>]*\\bval="([^"]*)"`, 'i');
    return re.exec(xml)?.[1];
}
/**
 * RenderingControl events carry per-channel entries like `<Volume channel="Master" val="35"/>`.
 * Prefer Master; otherwise take the first match.
 */
function channelAttrVal(xml, tag) {
    const master = new RegExp(`<${tag}\\b[^>]*channel="Master"[^>]*\\bval="([^"]*)"|<${tag}\\b[^>]*\\bval="([^"]*)"[^>]*channel="Master"`, 'i').exec(xml);
    if (master) {
        return master[1] ?? master[2];
    }
    const any = new RegExp(`<${tag}\\b[^>]*\\bval="([^"]*)"`, 'i').exec(xml);
    return any?.[1];
}
/** UPnP durations are H+:MM:SS[.fraction]. Returns whole seconds. */
function parseUpnpDuration(value) {
    const m = /(\d+):(\d{1,2}):(\d{1,2})/.exec(value.trim());
    if (!m) {
        return undefined;
    }
    const h = Number(m[1]);
    const min = Number(m[2]);
    const sec = Number(m[3]);
    if (![h, min, sec].every(Number.isFinite)) {
        return undefined;
    }
    return h * 3600 + min * 60 + sec;
}
function unescapeXml(value) {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}
