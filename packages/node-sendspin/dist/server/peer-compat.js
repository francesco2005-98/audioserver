import { MediaCommand } from '../types.js';
/**
 * Which media commands a peer's own library is too old to name.
 *
 * The protocol offers no way to ask. `client/hello` has no controller support
 * object, and the core `version` has stayed 1 across every release, so a command
 * added to the enum later looks exactly like one that was always there. Getting
 * it wrong is not a degraded feature: a client that cannot name a value in
 * `supported_commands` does not skip that value, it rejects the whole
 * `server/state` message, and loses volume, metadata and the stream start along
 * with the command it had never heard of.
 *
 * The one thing a peer does tell us is which library it is — the reference
 * daemon reports `aiosendspin <version>` in `device_info.software_version`. So
 * this is a deny-list of peers known to be blind, not an allow-list of peers
 * known to be good: anything we cannot identify keeps the full command set.
 */
const EMPTY = new Set();
const AIOSENDSPIN_COMMANDS = [
    { command: MediaCommand.SEEK, since: [6, 1, 0] },
    { command: MediaCommand.SEEK_RELATIVE, since: [6, 1, 0] },
];
/** `aiosendspin 6.0.1`, as the reference daemon spells it in `device_info`. */
const AIOSENDSPIN = /^aiosendspin\b/i;
const AIOSENDSPIN_VERSION = /^aiosendspin\s+v?(\d+)\.(\d+)\.(\d+)/i;
/**
 * `null` for anything that is not aiosendspin, `unknown` for an aiosendspin that
 * would not say which version it is — the daemon falls back to
 * `aiosendspin (unknown version)` when its package metadata is missing, and an
 * unreadable version is no reason to assume the newer enum.
 */
function parseAiosendspinVersion(deviceInfo) {
    const raw = deviceInfo?.software_version;
    if (typeof raw !== 'string')
        return null;
    const trimmed = raw.trim();
    if (!AIOSENDSPIN.test(trimmed))
        return null;
    const match = AIOSENDSPIN_VERSION.exec(trimmed);
    if (!match)
        return 'unknown';
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}
function isBelow(version, floor) {
    for (let i = 0; i < 3; i += 1) {
        if (version[i] !== floor[i])
            return version[i] < floor[i];
    }
    return false;
}
/**
 * Media commands this peer would choke on, or an empty set when it is not a
 * library we have a table for.
 */
export function unnameableMediaCommands(deviceInfo) {
    const version = parseAiosendspinVersion(deviceInfo);
    if (!version)
        return EMPTY;
    const blind = new Set();
    for (const entry of AIOSENDSPIN_COMMANDS) {
        if (version === 'unknown' || isBelow(version, entry.since))
            blind.add(entry.command);
    }
    return blind.size ? blind : EMPTY;
}
