"use strict";
// The speaker's own identity, from its UPnP device description.
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDeviceDescription = loadDeviceDescription;
const undici_1 = require("undici");
const node_upnp_1 = require("@audioserver/node-upnp");
const errors_1 = require("../../errors");
const abort_1 = require("./abort");
const soap_1 = require("./soap");
async function loadDeviceDescription(host, options = {}) {
    const port = options.port ?? soap_1.SONOS_UPNP_PORT;
    const url = `http://${host}:${port}/xml/device_description.xml`;
    const signal = (0, abort_1.combineSignals)(options.signal, AbortSignal.timeout(options.timeoutMs ?? 5_000));
    let xml;
    try {
        const response = await (0, undici_1.fetch)(url, { signal });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        xml = await response.text();
    }
    catch (err) {
        throw new errors_1.CannotConnect(`Sonos S1 device description from ${host} failed (${err.message})`, err instanceof Error ? err : undefined);
    }
    const udn = (0, node_upnp_1.extractTag)(xml, 'UDN') ?? '';
    const uuid = udn.replace(/^uuid:/i, '').trim();
    if (!uuid) {
        throw new errors_1.CannotConnect(`Sonos S1 device description from ${host} carried no UDN`);
    }
    // roomName is what the user named the speaker. friendlyName is "<ip> - <model>",
    // which is a fallback, not a name anyone chose.
    const name = (0, node_upnp_1.extractTag)(xml, 'roomName') || (0, node_upnp_1.extractTag)(xml, 'friendlyName') || uuid;
    return {
        uuid,
        name,
        host,
        port,
        modelName: (0, node_upnp_1.extractTag)(xml, 'modelName') || undefined,
    };
}
