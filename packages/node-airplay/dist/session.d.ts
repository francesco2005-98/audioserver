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
import { type Socket } from 'node:net';
import { type PlistValue } from './bplist.js';
import type { RtspConnection } from './rtsp.js';
/** The 8-byte identity behind deviceID, macAddress and the PTP ClockID. */
export interface SenderIdentity {
    /** The raw 8 bytes. */
    bytes: Buffer;
    /** All 8 bytes, colon-separated — the `deviceID`. */
    deviceId: string;
    /** The first 6 bytes, colon-separated — the `macAddress`. */
    macAddress: string;
    /** The same 8 bytes as a 64-bit integer — the PTP clock identity. */
    clockId: bigint;
}
/** Build the sender identity from 8 bytes (random when not supplied). */
export declare function createIdentity(bytes: Buffer): SenderIdentity;
export interface SessionSetupOptions {
    identity: SenderIdentity;
    /**
     * Which clock the session runs on. PTP is the normal lane; NTP is for
     * receivers that do not actually serve PTP — see {@link NtpTimingResponder}.
     * On NTP the SETUP carries our timing port instead of a peer list.
     */
    timing?: 'ptp' | 'ntp';
    /** Our NTP responder's port; required when `timing` is `ntp`. */
    timingPort?: number;
    /** Our address as the receiver must reach it — goes into the timing peer list. */
    localAddress: string;
    /** Name the receiver shows for this session. */
    name: string;
    /**
     * The clock the session timeline follows. Ours when we hold grandmaster,
     * which is the normal case; BMCA may hand it to the receiver instead.
     */
    timelineClockId: bigint;
    sessionUuid?: string;
    groupUuid?: string;
}
export interface SessionSetupResult {
    sessionUuid: string;
    groupUuid: string;
    /** TCP port the receiver opens for session events; 0 when it reports none. */
    eventPort: number;
    /**
     * The receiver answered with a timing port of its own, which means it wants
     * the NTP lane however loudly its TXT record advertises PTP.
     */
    wantsNtpTiming: boolean;
    /** The parsed SETUP reply, for callers that want the rest of it. */
    response: {
        [key: string]: PlistValue;
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
export declare function setupSession(rtsp: RtspConnection, sessionUrl: string, options: SessionSetupOptions): Promise<SessionSetupResult>;
/**
 * The reverse TCP connection to the receiver's event port. Nothing is written
 * on it — the receiver pushes session events — but it must exist and stay open:
 * the reference sender opens it right after the session SETUP and holds it for
 * the life of the session.
 */
export declare function connectEvents(host: string, port: number, timeoutMs?: number): Promise<Socket>;
/** How often the keepalive POST goes out. */
export declare const FEEDBACK_INTERVAL_MS = 2000;
/**
 * Start the `POST /feedback` keepalive. **This is what resets the receiver's
 * idle timer.** Without it an Apple receiver drops the timeline after about
 * half a minute and goes quiet while the sender keeps streaming happily, with
 * nothing in any log to show for it — measured: PTP Delay_Req probes stop at
 * ~30 s and the audio dies with them.
 *
 * :returns: a stop function.
 */
export declare function startFeedback(rtsp: RtspConnection, onResult?: (status: number | null, err?: Error) => void): () => void;
