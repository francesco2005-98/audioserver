"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.escapeXml = void 0;
exports.buildContainerElement = buildContainerElement;
exports.buildItemElement = buildItemElement;
exports.wrapDidl = wrapDidl;
exports.buildDidl = buildDidl;
exports.readDidlField = readDidlField;
exports.readDidlDuration = readDidlDuration;
exports.parseDidlObject = parseDidlObject;
const soap_js_1 = require("../soap/soap.js");
Object.defineProperty(exports, "escapeXml", { enumerable: true, get: function () { return soap_js_1.escapeXml; } });
/**
 * DIDL-Lite serialisation, decoupled from any host content model.
 *
 * A UPnP ContentDirectory Browse returns a `Result` string containing an escaped
 * `<DIDL-Lite>` document of `<container>` (browsable folders) and `<item>`
 * (playable tracks) elements. A control point playing a track also passes an
 * item's DIDL to a renderer via SetAVTransportURI. This module builds and parses
 * those documents from neutral shapes — the host app maps its own content onto
 * `DidlItem` / `DidlContainer`, so the module never depends on the app's types.
 */
const DIDL_OPEN = '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">';
const DIDL_CLOSE = '</DIDL-Lite>';
function buildContainerElement(container) {
    const childCountAttr = typeof container.childCount === 'number' ? ` childCount="${container.childCount}"` : '';
    const parts = [
        `<container id="${(0, soap_js_1.escapeXml)(container.id)}" parentID="${(0, soap_js_1.escapeXml)(container.parentId)}" ` +
            `restricted="1"${childCountAttr}>`,
        `<dc:title>${(0, soap_js_1.escapeXml)(container.title)}</dc:title>`,
    ];
    const creator = container.creator ?? container.artist;
    if (creator) {
        parts.push(`<dc:creator>${(0, soap_js_1.escapeXml)(creator)}</dc:creator>`);
    }
    if (container.artist) {
        parts.push(`<upnp:artist>${(0, soap_js_1.escapeXml)(container.artist)}</upnp:artist>`);
    }
    if (container.genre) {
        parts.push(`<upnp:genre>${(0, soap_js_1.escapeXml)(container.genre)}</upnp:genre>`);
    }
    if (container.albumArtUri) {
        parts.push(`<upnp:albumArtURI>${(0, soap_js_1.escapeXml)(container.albumArtUri)}</upnp:albumArtURI>`);
    }
    parts.push(`<upnp:class>${(0, soap_js_1.escapeXml)(container.upnpClass ?? 'object.container.storageFolder')}</upnp:class>`, '</container>');
    return parts.join('');
}
function buildItemElement(item) {
    const parts = [
        `<item id="${(0, soap_js_1.escapeXml)(item.id)}" parentID="${(0, soap_js_1.escapeXml)(item.parentId)}" restricted="1">`,
        `<dc:title>${(0, soap_js_1.escapeXml)(item.title)}</dc:title>`,
    ];
    const creator = item.creator ?? item.artist;
    if (creator) {
        parts.push(`<dc:creator>${(0, soap_js_1.escapeXml)(creator)}</dc:creator>`);
    }
    if (item.artist) {
        parts.push(`<upnp:artist>${(0, soap_js_1.escapeXml)(item.artist)}</upnp:artist>`);
    }
    if (item.album) {
        parts.push(`<upnp:album>${(0, soap_js_1.escapeXml)(item.album)}</upnp:album>`);
    }
    if (item.albumArtUri) {
        parts.push(`<upnp:albumArtURI>${(0, soap_js_1.escapeXml)(item.albumArtUri)}</upnp:albumArtURI>`);
    }
    parts.push(`<upnp:class>${(0, soap_js_1.escapeXml)(item.upnpClass ?? 'object.item.audioItem.musicTrack')}</upnp:class>`);
    for (const res of item.resources ?? []) {
        parts.push(buildResElement(res));
    }
    parts.push('</item>');
    return parts.join('');
}
function buildResElement(res) {
    const attrs = [];
    if (res.duration)
        attrs.push(`duration="${(0, soap_js_1.escapeXml)(res.duration)}"`);
    if (res.size)
        attrs.push(`size="${res.size}"`);
    if (res.bitrate)
        attrs.push(`bitrate="${res.bitrate}"`);
    if (res.sampleFrequency)
        attrs.push(`sampleFrequency="${res.sampleFrequency}"`);
    if (res.nrAudioChannels)
        attrs.push(`nrAudioChannels="${res.nrAudioChannels}"`);
    const attrStr = attrs.length ? ` ${attrs.join(' ')}` : '';
    return `<res${attrStr} protocolInfo="${(0, soap_js_1.escapeXml)(res.protocolInfo)}">${(0, soap_js_1.escapeXml)(res.url)}</res>`;
}
/** Wrap pre-built container/item element strings in a DIDL-Lite document. */
function wrapDidl(elements) {
    return `${DIDL_OPEN}${elements.join('')}${DIDL_CLOSE}`;
}
/** Convenience: build a full DIDL document from container/item shapes. */
function buildDidl(objects) {
    const els = objects.map((o) => 'resources' in o || isItemShape(o) ? buildItemElement(o) : buildContainerElement(o));
    return wrapDidl(els);
}
function isItemShape(o) {
    return o.resources !== undefined || o.artist !== undefined;
}
// ── Parsing (for renderer now-playing / control-point) ────────────────────────
function unescape(value) {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
        .replace(/&amp;/g, '&');
}
/** Read a single DIDL text field from a (possibly SOAP-escaped) metadata blob. */
function readDidlField(metadata, tag) {
    const didl = unescape(metadata);
    const m = fieldRegex(tag).exec(didl);
    return m ? unescape(m[1] ?? '').trim() : '';
}
/**
 * Match `<tag>` or `<tag attr="…">`, but never a longer tag that merely starts with
 * the same letters — `upnp:album` must not match `<upnp:albumArtURI>`, which is the
 * element Sonos happens to emit first.
 */
function fieldRegex(tag) {
    return new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
}
/** Read the res@duration attribute from a DIDL metadata blob. */
function readDidlDuration(metadata) {
    const didl = unescape(metadata);
    const m = /duration="([^"]+)"/i.exec(didl);
    return m?.[1] ?? null;
}
/**
 * Parse the first item/container from a DIDL metadata blob into a neutral object.
 * Handles doubly-escaped SOAP payloads (unescaped once here).
 */
function parseDidlObject(metadata) {
    const didl = unescape(metadata);
    const isItem = /<item[\s>]/i.test(didl);
    const isContainer = /<container[\s>]/i.test(didl);
    if (!isItem && !isContainer) {
        return null;
    }
    const field = (tag) => {
        const m = fieldRegex(tag).exec(didl);
        return m ? unescape(m[1] ?? '').trim() : undefined;
    };
    const idMatch = /<(?:item|container)[^>]*\bid="([^"]*)"/i.exec(didl);
    const parentMatch = /<(?:item|container)[^>]*\bparentID="([^"]*)"/i.exec(didl);
    const resMatch = /<res[^>]*>([\s\S]*?)<\/res>/i.exec(didl);
    return {
        kind: isItem ? 'item' : 'container',
        id: idMatch?.[1] ?? '',
        parentId: parentMatch?.[1] ?? '',
        title: field('dc:title') ?? '',
        artist: field('upnp:artist') ?? field('dc:creator'),
        album: field('upnp:album'),
        albumArtUri: field('upnp:albumArtURI'),
        upnpClass: field('upnp:class'),
        duration: readDidlDuration(metadata) ?? undefined,
        res: resMatch ? unescape(resMatch[1] ?? '').trim() : undefined,
    };
}
