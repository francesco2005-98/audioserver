/**
 * The legacy NTP timing lane.
 *
 * Not every AirPlay 2 receiver does PTP, and the ones that do not are not
 * honest about it: a device can advertise SupportsPTP, accept a PTP session
 * SETUP with a 200, and then never send a single clock probe — after which it
 * renders silence while the sender looks perfectly healthy. Measured on a
 * BeoLab 50: audio on the wire at the right rate, nothing coming back, no
 * sound. The tell is in the SETUP reply, which carries a `timingPort` instead
 * of just a `timingPeerInfo`.
 *
 * For those receivers the sender runs this instead: a responder the device
 * polls for the time, and a different sync packet. Apple receivers are the
 * opposite case — they render silence on an NTP-timed realtime stream — so the
 * two lanes are not interchangeable, they are per device.
 */
/** Now, as an NTP fixed-point value (seconds << 32 | fraction). */
export declare function ntpNow(): bigint;
/**
 * Answers a receiver's timing requests so it can place our clock.
 *
 * The exchange is the RAOP one: a 32-byte request with type 0xD2, answered with
 * type 0xD3 carrying the request's transmit time as the reference, plus our
 * receive and transmit times. Left unanswered the receiver has no timeline and
 * plays nothing.
 */
export declare class NtpTimingResponder {
    private socket;
    /** Requests answered — a receiver that stops asking has dropped the session. */
    exchanges: number;
    start(): Promise<number>;
    stop(): void;
    private onMessage;
}
/**
 * The NTP flavour of the anchor packet (20 bytes, type 0xD4) — where the media
 * timeline sits on the NTP clock. The PTP lane sends a different, longer one.
 *
 * :param rtpTimestamp: the sender's current RTP position.
 * :param leadFrames: how far ahead of the render point that position is.
 */
export declare function buildNtpSyncPacket(rtpTimestamp: number, leadFrames: number, first: boolean): Buffer;
