"use strict";
// SOAP control for Sonos S1 speakers.
//
// S1 firmware speaks plain UPnP on port 1400: a POST of a SOAP envelope to a
// service's control URL. The envelope building and fault reading come from
// @audioserver/node-upnp — this module only adds the Sonos service table and the
// HTTP round trip, since node-upnp's own control point discards response bodies
// and we need to read out-arguments (GetPositionInfo, GetZoneGroupState).
Object.defineProperty(exports, "__esModule", { value: true });
exports.SONOS_SERVICES = exports.SONOS_UPNP_PORT = void 0;
exports.serviceEventUrl = serviceEventUrl;
exports.callAction = callAction;
const undici_1 = require("undici");
const node_upnp_1 = require("@audioserver/node-upnp");
const errors_1 = require("../../errors");
const abort_1 = require("./abort");
exports.SONOS_UPNP_PORT = 1400;
exports.SONOS_SERVICES = {
    AVTransport: {
        type: 'urn:schemas-upnp-org:service:AVTransport:1',
        controlPath: '/MediaRenderer/AVTransport/Control',
        eventPath: '/MediaRenderer/AVTransport/Event',
        instanceId: 0,
    },
    RenderingControl: {
        type: 'urn:schemas-upnp-org:service:RenderingControl:1',
        controlPath: '/MediaRenderer/RenderingControl/Control',
        eventPath: '/MediaRenderer/RenderingControl/Event',
        instanceId: 0,
    },
    GroupRenderingControl: {
        type: 'urn:schemas-upnp-org:service:GroupRenderingControl:1',
        controlPath: '/MediaRenderer/GroupRenderingControl/Control',
        eventPath: '/MediaRenderer/GroupRenderingControl/Event',
        instanceId: 0,
    },
    ZoneGroupTopology: {
        type: 'urn:schemas-upnp-org:service:ZoneGroupTopology:1',
        controlPath: '/ZoneGroupTopology/Control',
        eventPath: '/ZoneGroupTopology/Event',
        instanceId: null,
    },
};
function serviceEventUrl(host, service, port = exports.SONOS_UPNP_PORT) {
    return `http://${host}:${port}${exports.SONOS_SERVICES[service].eventPath}`;
}
/**
 * Invoke a SOAP action and return the raw response body.
 *
 * Argument values are inserted verbatim, matching node-upnp's builder — a caller
 * passing DIDL metadata must escape it first.
 */
async function callAction(host, service, action, args = {}, options = {}) {
    const def = exports.SONOS_SERVICES[service];
    const port = options.port ?? exports.SONOS_UPNP_PORT;
    const url = `http://${host}:${port}${def.controlPath}`;
    const body = (0, node_upnp_1.buildSoapRequest)(def.type, action, args, { instanceId: def.instanceId });
    const signal = (0, abort_1.combineSignals)(options.signal, AbortSignal.timeout(options.timeoutMs ?? 5_000));
    let response;
    try {
        response = await (0, undici_1.fetch)(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset="utf-8"',
                SOAPAction: `"${def.type}#${action}"`,
            },
            body,
            signal,
        });
    }
    catch (err) {
        throw new errors_1.TransportError(`${service}.${action} to ${host} failed: ${err.message}`, err instanceof Error ? err : undefined);
    }
    const text = await response.text().catch(() => '');
    if (response.ok) {
        return text;
    }
    // UPnP reports action errors as HTTP 500 with a UPnPError detail; anything else
    // is a transport-level problem.
    const upnpError = (0, node_upnp_1.extractFaultCode)(text);
    if (upnpError) {
        throw new errors_1.FailedCommand(upnpError, `${service}.${action} on ${host}`);
    }
    throw new errors_1.TransportError(`${service}.${action} to ${host} returned HTTP ${response.status}`);
}
