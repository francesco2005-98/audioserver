"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpnpMediaServer = exports.MEDIA_SERVER_PATHS = exports.ROOT_OBJECT_ID = void 0;
exports.parseSearchCriteria = parseSearchCriteria;
const soap_js_1 = require("../soap/soap.js");
const didl_js_1 = require("../didl/didl.js");
const deviceDescription_js_1 = require("../description/deviceDescription.js");
const scpd_js_1 = require("../description/scpd.js");
/** The root container object id per the UPnP ContentDirectory spec. */
exports.ROOT_OBJECT_ID = '0';
const CDS_NS = deviceDescription_js_1.SERVICE_TYPES.contentDirectory;
const CMS_NS = deviceDescription_js_1.SERVICE_TYPES.connectionManager;
/** Sub-paths under the media-server base URL. */
exports.MEDIA_SERVER_PATHS = {
    device: 'device.xml',
    cdsScpd: 'cds/scpd.xml',
    cmsScpd: 'cms/scpd.xml',
    cdsControl: 'cds/control',
    cmsControl: 'cms/control',
    cdsEvent: 'cds/event',
    cmsEvent: 'cms/event',
};
/**
 * A UPnP MediaServer: advertises a ContentDirectory + ConnectionManager and
 * answers Browse over a host-supplied `ContentProvider`. Serves device.xml, SCPD
 * and SOAP control under a base path via `handle(req, res, sub)`. Advertise the
 * device on an SsdpAdvertiser using `deviceTypeAndServices()`.
 */
class UpnpMediaServer {
    opts;
    log;
    constructor(opts) {
        this.opts = opts;
        this.log = opts.logger;
    }
    get udn() {
        return this.opts.udn;
    }
    deviceTypeAndServices() {
        return { deviceType: deviceDescription_js_1.DEVICE_TYPES.mediaServer, serviceTypes: [CDS_NS, CMS_NS] };
    }
    /** `sub` is the path AFTER the media-server base, e.g. 'cds/control'. */
    async handle(req, res, sub) {
        const method = (req.method ?? 'GET').toUpperCase();
        if (method === 'GET' || method === 'HEAD') {
            if (sub === exports.MEDIA_SERVER_PATHS.device)
                return this.sendXml(res, this.deviceXml());
            if (sub === exports.MEDIA_SERVER_PATHS.cdsScpd)
                return this.sendXml(res, scpd_js_1.CONTENT_DIRECTORY_SCPD);
            if (sub === exports.MEDIA_SERVER_PATHS.cmsScpd)
                return this.sendXml(res, scpd_js_1.CONNECTION_MANAGER_SCPD);
            return this.notFound(res);
        }
        if (method === 'SUBSCRIBE' || method === 'UNSUBSCRIBE') {
            // Content tree is effectively static per session; accept a silent subscription.
            res.writeHead(200, {
                SID: `uuid:${this.opts.udn.slice(5)}-cds`,
                TIMEOUT: 'Second-1800',
            });
            res.end();
            return;
        }
        if (method === 'POST') {
            if (sub === exports.MEDIA_SERVER_PATHS.cdsControl)
                return this.handleCdsControl(req, res);
            if (sub === exports.MEDIA_SERVER_PATHS.cmsControl)
                return this.handleCmsControl(req, res);
            return this.notFound(res);
        }
        return this.notFound(res);
    }
    deviceXml() {
        const base = this.opts.baseUrl();
        const p = (name) => `${base}/${exports.MEDIA_SERVER_PATHS[name]}`;
        return (0, deviceDescription_js_1.buildDeviceDescription)({
            deviceType: deviceDescription_js_1.DEVICE_TYPES.mediaServer,
            dlnaDoc: 'DMS-1.50',
            identity: {
                udn: this.opts.udn,
                friendlyName: this.opts.friendlyName(),
                ...this.opts.identity,
            },
            services: [
                {
                    serviceType: CDS_NS,
                    serviceId: 'urn:upnp-org:serviceId:ContentDirectory',
                    scpdUrl: p('cdsScpd'),
                    controlUrl: p('cdsControl'),
                    eventSubUrl: p('cdsEvent'),
                },
                {
                    serviceType: CMS_NS,
                    serviceId: 'urn:upnp-org:serviceId:ConnectionManager',
                    scpdUrl: p('cmsScpd'),
                    controlUrl: p('cmsControl'),
                    eventSubUrl: p('cmsEvent'),
                },
            ],
        });
    }
    // ── ContentDirectory SOAP ─────────────────────────────────────────────────
    async handleCdsControl(req, res) {
        if (req.method !== 'POST') {
            return this.methodNotAllowed(res);
        }
        const action = (0, soap_js_1.parseSoapAction)(req.headers['soapaction']);
        const body = await readBody(req);
        if (action === 'Browse' || /<[\w:]*Browse[\s>]/.test(body)) {
            const parsed = this.parseBrowse(body);
            if (!parsed) {
                return this.sendSoapRaw(res, (0, soap_js_1.buildSoapFault)('Invalid Browse request'), 500);
            }
            try {
                const result = await this.browse(parsed);
                return this.sendSoapRaw(res, this.buildDirectoryResponse('Browse', result));
            }
            catch (error) {
                this.log?.warn?.('browse failed', {
                    message: error instanceof Error ? error.message : String(error),
                });
                return this.sendSoapRaw(res, (0, soap_js_1.buildSoapFault)('Browse failed'), 500);
            }
        }
        if (action === 'Search' || /<[\w:]*Search[\s>]/.test(body)) {
            if (!this.opts.provider.search) {
                return this.sendSoapRaw(res, (0, soap_js_1.buildSoapFault)('Search not supported'), 500);
            }
            const parsed = this.parseSearch(body);
            if (!parsed) {
                return this.sendSoapRaw(res, (0, soap_js_1.buildSoapFault)('Invalid Search request'), 500);
            }
            try {
                const result = await this.search(parsed);
                return this.sendSoapRaw(res, this.buildDirectoryResponse('Search', result));
            }
            catch (error) {
                this.log?.warn?.('search failed', {
                    message: error instanceof Error ? error.message : String(error),
                });
                return this.sendSoapRaw(res, (0, soap_js_1.buildSoapFault)('Search failed'), 500);
            }
        }
        if (/GetSystemUpdateID/.test(action) || /GetSystemUpdateID/.test(body)) {
            return this.sendSoap(res, CDS_NS, 'GetSystemUpdateID', { Id: '1' });
        }
        if (/GetSearchCapabilities/.test(action) || /GetSearchCapabilities/.test(body)) {
            // Only advertise capabilities when the provider can actually search; empty
            // is the spec signal that tells control points not to issue Search.
            const caps = this.opts.provider.search ? this.opts.searchCapabilities ?? '' : '';
            return this.sendSoap(res, CDS_NS, 'GetSearchCapabilities', { SearchCaps: caps });
        }
        if (/GetSortCapabilities/.test(action) || /GetSortCapabilities/.test(body)) {
            return this.sendSoap(res, CDS_NS, 'GetSortCapabilities', { SortCaps: '' });
        }
        return this.sendSoapRaw(res, (0, soap_js_1.buildSoapFault)('Unsupported action'), 500);
    }
    parseBrowse(body) {
        if (!/<[\w:]*Browse[\s>]/.test(body)) {
            return null;
        }
        const objectId = (0, soap_js_1.extractTag)(body, 'ObjectID') ?? exports.ROOT_OBJECT_ID;
        const flagRaw = (0, soap_js_1.extractTag)(body, 'BrowseFlag') ?? 'BrowseDirectChildren';
        const browseFlag = flagRaw === 'BrowseMetadata' ? 'BrowseMetadata' : 'BrowseDirectChildren';
        const startingIndex = toInt((0, soap_js_1.extractTag)(body, 'StartingIndex'), 0);
        const requestedCount = toInt((0, soap_js_1.extractTag)(body, 'RequestedCount'), 0);
        return { objectId, browseFlag, startingIndex, requestedCount };
    }
    parseSearch(body) {
        if (!/<[\w:]*Search[\s>]/.test(body)) {
            return null;
        }
        const containerId = (0, soap_js_1.extractTag)(body, 'ContainerID') ?? exports.ROOT_OBJECT_ID;
        const searchCriteria = (0, soap_js_1.extractTag)(body, 'SearchCriteria') ?? '';
        const startingIndex = toInt((0, soap_js_1.extractTag)(body, 'StartingIndex'), 0);
        const requestedCount = toInt((0, soap_js_1.extractTag)(body, 'RequestedCount'), 0);
        return { containerId, searchCriteria, startingIndex, requestedCount };
    }
    async search(req) {
        // RequestedCount 0 means "all" in UPnP; cap to a sane page.
        const limit = req.requestedCount > 0 ? req.requestedCount : 200;
        const offset = req.startingIndex > 0 ? req.startingIndex : 0;
        const result = await this.opts.provider.search(req.containerId, req.searchCriteria, offset, limit);
        const elements = result.objects.map((o) => isItem(o) ? (0, didl_js_1.buildItemElement)(o) : (0, didl_js_1.buildContainerElement)(o));
        const total = typeof result.total === 'number' && result.total > 0
            ? result.total
            : offset + elements.length;
        return { didl: (0, didl_js_1.wrapDidl)(elements), numberReturned: elements.length, totalMatches: total };
    }
    async browse(req) {
        if (req.browseFlag === 'BrowseMetadata') {
            const obj = this.opts.provider.browseMetadata
                ? await this.opts.provider.browseMetadata(req.objectId)
                : null;
            if (!obj) {
                return { didl: (0, didl_js_1.wrapDidl)([]), numberReturned: 0, totalMatches: 0 };
            }
            const el = isItem(obj) ? (0, didl_js_1.buildItemElement)(obj) : (0, didl_js_1.buildContainerElement)(obj);
            return { didl: (0, didl_js_1.wrapDidl)([el]), numberReturned: 1, totalMatches: 1 };
        }
        // RequestedCount 0 means "all" in UPnP; cap to a sane page.
        const limit = req.requestedCount > 0 ? req.requestedCount : 200;
        const offset = req.startingIndex > 0 ? req.startingIndex : 0;
        const result = await this.opts.provider.browse(req.objectId, offset, limit);
        const elements = result.objects.map((o) => isItem(o) ? (0, didl_js_1.buildItemElement)(o) : (0, didl_js_1.buildContainerElement)(o));
        const total = typeof result.total === 'number' && result.total > 0
            ? result.total
            : offset + elements.length;
        return { didl: (0, didl_js_1.wrapDidl)(elements), numberReturned: elements.length, totalMatches: total };
    }
    /** Build a Browse/Search SOAP response (identical shape, different action name). */
    buildDirectoryResponse(action, result, updateId = 0) {
        const escapedDidl = (0, soap_js_1.escapeXml)(result.didl);
        return ('<?xml version="1.0" encoding="utf-8"?>' +
            '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
            's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
            '<s:Body>' +
            `<u:${action}Response xmlns:u="${CDS_NS}">` +
            `<Result>${escapedDidl}</Result>` +
            `<NumberReturned>${result.numberReturned}</NumberReturned>` +
            `<TotalMatches>${result.totalMatches}</TotalMatches>` +
            `<UpdateID>${updateId}</UpdateID>` +
            `</u:${action}Response>` +
            '</s:Body></s:Envelope>');
    }
    async handleCmsControl(req, res) {
        const action = (0, soap_js_1.parseSoapAction)(req.headers['soapaction']);
        await readBody(req);
        if (action === 'GetProtocolInfo') {
            return this.sendSoap(res, CMS_NS, 'GetProtocolInfo', {
                Source: this.opts.sourceProtocolInfo ?? 'http-get:*:audio/mpeg:*',
                Sink: '',
            });
        }
        return this.sendSoapRaw(res, (0, soap_js_1.buildSoapFault)('Unsupported action'), 500);
    }
    sendXml(res, xml) {
        res.writeHead(200, { 'Content-Type': 'text/xml; charset="utf-8"', 'Cache-Control': 'no-cache' });
        res.end(xml);
    }
    sendSoap(res, ns, action, args) {
        this.sendSoapRaw(res, (0, soap_js_1.buildSoapResponse)(ns, action, args));
    }
    sendSoapRaw(res, xml, status = 200) {
        res.writeHead(status, { 'Content-Type': 'text/xml; charset="utf-8"', EXT: '' });
        res.end(xml);
    }
    notFound(res) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not-found');
    }
    methodNotAllowed(res) {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('method-not-allowed');
    }
}
exports.UpnpMediaServer = UpnpMediaServer;
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
function parseSearchCriteria(criteria) {
    const raw = (criteria ?? '').trim();
    if (raw === '' || raw === '*') {
        return { terms: [], classFilter: null, matchAll: raw === '*' };
    }
    // Coarse class restriction from upnp:class derivedfrom / = "object.item…|object.container…".
    const classes = [...raw.matchAll(/upnp:class\s+(?:derivedfrom|=)\s+"([^"]+)"/gi)].map((m) => (m[1] ?? '').toLowerCase());
    const wantsItem = classes.some((c) => c.startsWith('object.item'));
    const wantsContainer = classes.some((c) => c.startsWith('object.container'));
    let classFilter = null;
    if (wantsItem && !wantsContainer) {
        classFilter = 'item';
    }
    else if (wantsContainer && !wantsItem) {
        classFilter = 'container';
    }
    // Free-text terms from contains/= on the common text properties.
    const terms = [];
    const add = (term) => {
        const t = term.trim();
        if (t && !terms.some((x) => x.toLowerCase() === t.toLowerCase())) {
            terms.push(t);
        }
    };
    const re = /(?:dc:title|upnp:artist|upnp:album|dc:creator|upnp:genre)\s+(?:contains|=)\s+"([^"]*)"/gi;
    for (const m of raw.matchAll(re)) {
        add(m[1] ?? '');
    }
    // Fallback: first quoted value that isn't a upnp:class token.
    if (terms.length === 0) {
        for (const m of raw.matchAll(/"([^"]+)"/g)) {
            const v = (m[1] ?? '').trim();
            if (v && !v.toLowerCase().startsWith('object.')) {
                add(v);
                break;
            }
        }
    }
    return { terms, classFilter, matchAll: false };
}
function isItem(o) {
    const cls = (o.upnpClass ?? '').toLowerCase();
    if (cls.startsWith('object.container')) {
        return false;
    }
    if (cls.startsWith('object.item')) {
        return true;
    }
    if (o.childCount !== undefined) {
        return false;
    }
    // No class hint and no childCount: treat as an item only if it carries item-only
    // fields (resources/artist/album); otherwise assume a bare container.
    const item = o;
    return item.resources !== undefined || item.artist !== undefined || item.album !== undefined;
}
function toInt(value, fallback) {
    const n = Number((value ?? '').trim());
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
async function readBody(req) {
    const MAX = 256 * 1024;
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
