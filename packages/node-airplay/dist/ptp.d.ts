/**
 * Sender-side PTP: the clock an AirPlay 2 receiver slaves to.
 *
 * Ported from cliairplay's `ap2_ptp.c`. Three things in here are not optional
 * and each one fails silently when wrong — the receiver keeps answering RTSP
 * and simply never renders:
 *
 *  - **majorSdoId = 1** in the first header byte. Receivers run the gPTP
 *    (802.1AS) profile and discard plain-1588 framing outright, so `0x10 | type`
 *    rather than the type alone.
 *  - **The announce dataset must out-rank the receiver's own clock.** iOS
 *    announces priority1 128 / clockClass 6 / accuracy 0x21 / variance 0x436A
 *    with timeSource GPS; a HomePod announces 248/248, so those values are what
 *    win the election and make our timeline the session's.
 *  - **Timing is unicast to the peers**, not multicast: that is what iOS does,
 *    and a receiver only follows a master it was handed in `timingPeerList`.
 *
 * Timestamps come from `CLOCK_REALTIME` (the same base the reference uses) with
 * userspace software timestamping, so accuracy is tens of microseconds — which
 * is the same class the C implementation achieves, since it timestamps in
 * userspace too.
 */
export interface PtpEngineOptions {
    /** Our 64-bit clock identity — the same value the session SETUP advertises. */
    clockId: bigint;
    /** Receivers to unicast timing to; add and remove them as sessions come and go. */
    peers: string[];
    /** Local address to bind; empty binds all interfaces. */
    bindAddress?: string;
    onLog?: (message: string) => void;
}
/**
 * A PTP grandmaster serving one or more AirPlay receivers.
 *
 * Binding 319/320 needs privilege (or `CAP_NET_BIND_SERVICE`); {@link start}
 * rejects when it cannot, and the caller must then fall back to NTP timing —
 * on an Apple receiver that means silence, so the failure has to surface.
 */
export declare class PtpEngine {
    private readonly options;
    private eventSocket;
    private generalSocket;
    private announceTimer;
    private syncTimer;
    private signalingTimer;
    /**
     * sequenceId is 16 bits wide, so these wrap rather than grow: a sync every
     * 125 ms runs out of room after a little over two hours of playing.
     */
    private announceSeq;
    private syncSeq;
    private signalingSeq;
    private readonly clock;
    /** Delay_Req exchanges answered — the receiver probing us is the sign of life. */
    exchanges: number;
    private readonly peers;
    constructor(options: PtpEngineOptions);
    get clockId(): bigint;
    /**
     * Serve timing to one more receiver. Only one process on a host can bind
     * 319/320, so a single engine carries every session — sessions add and drop
     * themselves here rather than each running an engine of their own.
     */
    addPeer(address: string): void;
    removePeer(address: string): void;
    get peerCount(): number;
    /** Time on the session timeline, in nanoseconds. */
    now(): bigint;
    start(): Promise<void>;
    stop(): void;
    private bind;
    /**
     * A timer callback throws into nobody's hands: without this the process takes
     * the exception. A missed timing packet costs a beat, not the server.
     */
    private tick;
    private log;
    /** The common 34-byte PTPv2 header, in the gPTP dialect receivers require. */
    private header;
    private send;
    private sendAnnounce;
    /** Two-step master: Sync with an empty timestamp, then Follow_Up with the real one. */
    private sendSync;
    /** The once-a-second Signaling iOS sends its timing peers: two Apple TLVs. */
    private sendSignaling;
    private onEvent;
    private onGeneral;
    /** Echo the requester's port identity and sequence with our receive time. */
    private sendDelayResp;
    /**
     * Answer the gPTP peer-delay probe. An 802.1AS receiver may mark a neighbour
     * that ignores this not-asCapable and then distrust its timeline, so it is
     * answered in any role — peer delay measures the link, not the timeline.
     */
    private sendPdelayResp;
}
