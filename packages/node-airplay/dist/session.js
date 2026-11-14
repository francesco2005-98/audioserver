/**
 * The AirPlay 2 session SETUP — the first encrypted exchange, which tells the
 * receiver who we are and, crucially, which clock its playback timeline will
 * follow.
 *
 * A receiver only slaves to a clock it finds in `timingPeerList`, and it cannot
 * anchor to its own, so the sender has to hold grandmaster and advertise its own
 * ClockID here. The same identity is used for the PTP engine's
 * `grandmasterIdentity`, so the two must be generated together — a session that
 * announces one ClockID and serves PTP under another looks healthy and renders
 * silence.
 */
import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { parseBinaryPlist } from './bplist.js';
import { buildBinaryPlist, PlistInt64 } from './bplistWriter.js';
const PLIST_CONTENT_TYPE = 'application/x-apple-binary-plist';
/** Build the sender identity from 8 bytes (random when not supplied). */
export function createIdentity(bytes) {
    if (bytes.length !== 8) {
        throw new Error('sender identity must be exactly 8 bytes');
    }
    const hex = (from, to) => [...bytes.subarray(from, to)].map((byte) => byte.toString(16).padStart(2, '0')).join(':');
    return {
        bytes: Buffer.from(bytes),
        deviceId: hex(0, 8),
        macAddress: hex(0, 6),
        clockId: bytes.readBigUInt64BE(0),
    };
}
function timingPeer(peerId, clockId, address) {
    return {
        ID: peerId,
        DeviceType: 0,
        ClockID: new PlistInt64(clockId),
        SupportsClockPortMatchingOverride: false,
        Addresses: [address],
    };
}
/**
 * Run the PTP-flavoured session SETUP over the encrypted control channel.
 *
 * :param rtsp: an encrypted connection (pairing already done).
 * :param sessionUrl: `rtsp://<our address>/<session id>` — note it names OUR
 *   address, not the device's, and stays the request target for the rest of the
 *   session including TEARDOWN.
 */
export async function setupSession(rtsp, sessionUrl, options) {
    const sessionUuid = options.sessionUuid ?? randomUUID().toUpperCase();
    const groupUuid = options.groupUuid ?? randomUUID().toUpperCase();
    const peerId = randomUUID().toUpperCase();
    const peer = timingPeer(peerId, options.timelineClockId, options.localAddress);
    // The two lanes send different dictionaries: PTP advertises the clock the
    // receiver must follow, NTP advertises the port it must poll.
    const body = options.timing === 'ntp'
        ? buildBinaryPlist({
            deviceID: options.identity.deviceId,
            sessionUUID: sessionUuid,
            timingPort: options.timingPort ?? 0,
            timingProtocol: 'NTP',
        })
        : buildBinaryPlist({
            timingProtocol: 'PTP',
            deviceID: options.identity.deviceId,
            sessionUUID: sessionUuid,
            name: options.name,
            macAddress: options.identity.macAddress,
            groupUUID: groupUuid,
            groupContainsGroupLeader: false,
            timingPeerInfo: peer,
            timingPeerList: [peer],
        });
    const response = await rtsp.request('SETUP', {
        uri: sessionUrl,
        contentType: PLIST_CONTENT_TYPE,
        body,
    });
    if (response.status !== 200) {
        throw new Error(`session SETUP failed with status ${response.status}`);
    }
    let parsed = {};
    if (response.body.length > 0) {
        const value = parseBinaryPlist(response.body);
        if (value !== null && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value)) {
            parsed = value;
        }
    }
    const eventPort = typeof parsed['eventPort'] === 'number' ? parsed['eventPort'] : 0;
    // A receiver that answers a PTP SETUP with its own timingPort is telling us it
    // expects the NTP model — the signature of a device that advertises
    // SupportsPTP and then never probes our clock.
    const wantsNtpTiming = typeof parsed['timingPort'] === 'number';
    return { sessionUuid, groupUuid, eventPort, wantsNtpTiming, response: parsed };
}
/**
 * The reverse TCP connection to the receiver's event port. Nothing is written
 * on it — the receiver pushes session events — but it must exist and stay open:
 * the reference sender opens it right after the session SETUP and holds it for
 * the life of the session.
 */
export async function connectEvents(host, port, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
        const socket = connect({ host, port });
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error(`events connect to ${host}:${port} timed out`));
        }, timeoutMs);
        socket.once('connect', () => {
            clearTimeout(timer);
            socket.setNoDelay(true);
            socket.on('error', () => {
                /* session health is judged on the control channel, not here */
            });
            resolve(socket);
        });
        socket.once('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}
/** How often the keepalive POST goes out. */
export const FEEDBACK_INTERVAL_MS = 2000;
/**
 * Start the `POST /feedback` keepalive. **This is what resets the receiver's
 * idle timer.** Without it an Apple receiver drops the timeline after about
 * half a minute and goes quiet while the sender keeps streaming happily, with
 * nothing in any log to show for it — measured: PTP Delay_Req probes stop at
 * ~30 s and the audio dies with them.
 *
 * :returns: a stop function.
 */
export function startFeedback(rtsp, onResult) {
    const timer = setInterval(() => {
        void rtsp
            .request('POST', { uri: '/feedback', timeoutMs: FEEDBACK_INTERVAL_MS })
            .then((res) => onResult?.(res.status))
            .catch((err) => onResult?.(null, err instanceof Error ? err : new Error(String(err))));
    }, FEEDBACK_INTERVAL_MS);
    return () => clearInterval(timer);
}
