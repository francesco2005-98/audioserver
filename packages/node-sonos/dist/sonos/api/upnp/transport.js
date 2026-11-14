"use strict";
// AVTransport / RenderingControl actions on an S1 speaker.
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTransportCommand = sendTransportCommand;
exports.getPositionInfo = getPositionInfo;
exports.getMediaInfo = getMediaInfo;
exports.getTransportState = getTransportState;
exports.getVolume = getVolume;
exports.getMute = getMute;
const node_upnp_1 = require("@audioserver/node-upnp");
const soap_1 = require("./soap");
/**
 * Transport commands only take effect on a group's coordinator, so callers are
 * expected to have resolved that host first.
 */
async function sendTransportCommand(host, command, options = {}) {
    // Play is the only one of these that takes an argument.
    const args = command === 'Play' ? { Speed: '1' } : {};
    await (0, soap_1.callAction)(host, 'AVTransport', command, args, options);
}
async function getPositionInfo(host, options = {}) {
    const xml = await (0, soap_1.callAction)(host, 'AVTransport', 'GetPositionInfo', {}, options);
    return {
        trackUri: (0, node_upnp_1.extractTag)(xml, 'TrackURI') || undefined,
        trackMetadata: (0, node_upnp_1.extractTag)(xml, 'TrackMetaData') || undefined,
        relTime: (0, node_upnp_1.extractTag)(xml, 'RelTime') || undefined,
        duration: (0, node_upnp_1.extractTag)(xml, 'TrackDuration') || undefined,
    };
}
async function getMediaInfo(host, options = {}) {
    const xml = await (0, soap_1.callAction)(host, 'AVTransport', 'GetMediaInfo', {}, options);
    return {
        currentUri: (0, node_upnp_1.extractTag)(xml, 'CurrentURI') || undefined,
        currentUriMetadata: (0, node_upnp_1.extractTag)(xml, 'CurrentURIMetaData') || undefined,
    };
}
async function getTransportState(host, options = {}) {
    const xml = await (0, soap_1.callAction)(host, 'AVTransport', 'GetTransportInfo', {}, options);
    return (0, node_upnp_1.extractTag)(xml, 'CurrentTransportState') || undefined;
}
async function getVolume(host, options = {}) {
    const xml = await (0, soap_1.callAction)(host, 'RenderingControl', 'GetVolume', { Channel: 'Master' }, options);
    const value = Number((0, node_upnp_1.extractTag)(xml, 'CurrentVolume'));
    return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : undefined;
}
async function getMute(host, options = {}) {
    const xml = await (0, soap_1.callAction)(host, 'RenderingControl', 'GetMute', { Channel: 'Master' }, options);
    const value = (0, node_upnp_1.extractTag)(xml, 'CurrentMute');
    if (value === null) {
        return undefined;
    }
    return value === '1' || value.toLowerCase() === 'true';
}
