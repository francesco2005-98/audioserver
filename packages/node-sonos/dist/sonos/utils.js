"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDiscoveryInfo = getDiscoveryInfo;
const undici_1 = require("undici");
const constants_1 = require("./constants");
async function getDiscoveryInfo(playerIp, options) {
    const dispatcher = options?.dispatcher ?? new undici_1.Agent({ connect: { rejectUnauthorized: false } });
    const resp = await (0, undici_1.fetch)(`https://${playerIp}:1443/api/v1/players/local/info`, {
        method: 'GET',
        headers: { 'X-Sonos-Api-Key': constants_1.LOCAL_API_TOKEN },
        dispatcher,
    });
    if (!resp.ok) {
        throw new Error(`Sonos discovery failed (${resp.status} ${resp.statusText})`);
    }
    const data = (await resp.json());
    return data;
}
