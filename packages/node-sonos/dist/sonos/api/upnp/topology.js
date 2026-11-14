"use strict";
// Sonos topology: who is grouped with whom.
//
// ZoneGroupTopology reports the whole household in one document, handed over as
// XML escaped inside a `<ZoneGroupState>` element. It is a flat, attribute-only
// shape, so we read it with regexes rather than pulling in an XML stack — the
// same trade node-upnp makes for SOAP.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getZoneGroups = getZoneGroups;
exports.parseZoneGroups = parseZoneGroups;
const node_upnp_1 = require("@audioserver/node-upnp");
const soap_1 = require("./soap");
/** Ask a speaker for the household topology. Any speaker answers for all of them. */
async function getZoneGroups(host, options = {}) {
    const response = await (0, soap_1.callAction)(host, 'ZoneGroupTopology', 'GetZoneGroupState', {}, options);
    const state = (0, node_upnp_1.extractTag)(response, 'ZoneGroupState') ?? '';
    return parseZoneGroups(state);
}
/**
 * Parse a ZoneGroupState document. Accepts the `<ZoneGroupState>` wrapper, the bare
 * `<ZoneGroups>` list, or either still XML-escaped.
 */
function parseZoneGroups(xml) {
    let doc = xml ?? '';
    // Firmware versions differ on how many times they escape this; unescape until the
    // element markup is real. Bounded so a pathological payload can't spin.
    for (let i = 0; i < 3 && !/<ZoneGroup[\s>]/i.test(doc) && /&lt;ZoneGroup/i.test(doc); i += 1) {
        doc = (0, node_upnp_1.unescapeXml)(doc);
    }
    const groups = [];
    const groupRe = /<ZoneGroup\b([^>]*)>([\s\S]*?)<\/ZoneGroup>/gi;
    let groupMatch;
    while ((groupMatch = groupRe.exec(doc)) !== null) {
        const attrs = groupMatch[1] ?? '';
        const inner = groupMatch[2] ?? '';
        const groupId = readAttr(attrs, 'ID');
        const coordinatorUuid = readAttr(attrs, 'Coordinator');
        if (!groupId) {
            continue;
        }
        const members = [];
        // Matches both the self-closing form and the open form used when a member has
        // paired <Satellite> children. Satellites are not members in their own right.
        const memberRe = /<ZoneGroupMember\b([^>]*?)\/?>/gi;
        let memberMatch;
        while ((memberMatch = memberRe.exec(inner)) !== null) {
            const member = parseMember(memberMatch[1] ?? '');
            if (member) {
                members.push(member);
            }
        }
        const coordinator = members.find((m) => m.uuid === coordinatorUuid) ?? null;
        // Bridges, Boosts and paired satellites show up in the topology but aren't
        // players anyone can address.
        const playable = members.filter((m) => !m.invisible);
        groups.push({
            groupId,
            name: buildGroupName(coordinator, playable),
            coordinator,
            members: playable,
        });
    }
    return groups;
}
function parseMember(attrs) {
    const uuid = readAttr(attrs, 'UUID');
    if (!uuid) {
        return null;
    }
    const location = readAttr(attrs, 'Location');
    const { host, port } = parseLocation(location);
    return {
        uuid,
        name: readAttr(attrs, 'ZoneName') ?? uuid,
        host,
        port,
        invisible: readAttr(attrs, 'Invisible') === '1' || readAttr(attrs, 'IsZoneBridge') === '1',
    };
}
/**
 * Sonos names a group after its coordinator, with a count of the rooms that joined —
 * "Kitchen + 2". A lone speaker is just its room name.
 */
function buildGroupName(coordinator, members) {
    const base = coordinator?.name ?? members[0]?.name ?? '';
    const joined = Math.max(0, members.length - 1);
    return joined > 0 ? `${base} + ${joined}` : base;
}
function parseLocation(location) {
    if (!location) {
        return { host: '', port: 1400 };
    }
    try {
        const url = new URL(location);
        return { host: url.hostname, port: url.port ? Number(url.port) : 1400 };
    }
    catch {
        return { host: '', port: 1400 };
    }
}
function readAttr(attrs, name) {
    const re = new RegExp(`\\b${name}="([^"]*)"`, 'i');
    const value = re.exec(attrs)?.[1];
    return value === undefined ? undefined : (0, node_upnp_1.unescapeXml)(value);
}
