/**
 * AirPlay 1 (RAOP) — the legacy lane, for receivers that never learned AirPlay 2.
 *
 * Ported from libraop's `raop_client.c` / `rtsp_client.c`, the same C the rest
 * of this project replaces. It shares almost everything with the AirPlay 2 NTP
 * lane already here: the timing responder is the same 0xD2/0xD3 exchange, the
 * anchor is the same 20-byte 0xD4 packet, retransmits are the same 0x55/0x56,
 * and the ALAC encoder and DMAP metadata are shared outright. What is genuinely
 * different is only the handshake — an SDP-bodied ANNOUNCE instead of a plist,
 * a Transport header instead of a stream dictionary, and no encryption.
 *
 * Apple receivers on OS 27 and later no longer render this at all: they accept
 * the whole session and stay silent. Use AirPlay 2 for those; this is for the
 * gear that has nothing else — AirPort Express, older AVRs, third-party
 * speakers whose firmware stopped in the AirPlay 1 era.
 */
import { type Socket } from 'node:dgram';
import { NtpTimingResponder } from './ntpTiming.js';
import { RtspConnection } from './rtsp.js';
/** Frames per packet. libraop's encoder sizes its output buffer for exactly this. */
export declare const RAOP_FRAMES_PER_PACKET = 352;
export interface RaopConnectOptions {
    host: string;
    /** RAOP is usually on 5000; Apple-era devices answer on 7000. */
    port?: number;
    /**
     * The device's advertised encryption types (mDNS TXT `et`). A `4` in there
     * means MFi, and the device wants the `/auth-setup` exchange before SETUP —
     * without it those receivers answer the SETUP with a 403. Nothing secret is
     * needed for it; the exchange is a plain X25519 public key.
     */
    et?: string;
    /** Read-ahead requested from the device, in frames. */
    latencyFrames?: number;
    timeoutMs?: number;
    onLog?: (message: string) => void;
}
export interface RaopSession {
    rtsp: RtspConnection;
    /** Answers the device's timing polls; the device has no clock of its own here. */
    timing: NtpTimingResponder;
    /** Our sockets: sync and retransmits on one, audio on the other. */
    control: Socket;
    audio: Socket;
    /** UDP port on the device that audio goes to. */
    serverPort: number;
    /** UDP port on the device that sync packets go to. */
    controlPort: number;
    /** Total read-ahead the device holds, in frames. */
    latencyFrames: number;
    sessionUrl: string;
}
/**
 * Open a RAOP session: OPTIONS, the MFi exchange when asked for, ANNOUNCE with
 * an SDP body, SETUP, and RECORD.
 */
export declare function connectRaop(options: RaopConnectOptions): Promise<RaopSession>;
export interface RaopStreamOptions {
    host: string;
    session: RaopSession;
    onLog?: (message: string) => void;
}
/**
 * Streams ALAC over RAOP: audio on one socket, the anchor and retransmit
 * answers on the other.
 *
 * The timeline here is the frame counter itself — `headFrames` is an absolute
 * position derived from the NTP instant playback was anchored at, and every
 * sync packet reports it. That is the whole of RAOP's clock model: no PTP, no
 * grandmaster, just a sender that keeps saying where it is.
 */
export declare class RaopStreamer {
    private readonly options;
    private sequence;
    private readonly ssrc;
    private headFrames;
    private firstPacket;
    private syncTimer;
    private readonly rtxRing;
    private readonly rtxSeq;
    packetsSent: number;
    rtxAnswered: number;
    constructor(options: RaopStreamOptions);
    /** Total read-ahead the device holds, in milliseconds. */
    get latencyMs(): number;
    /**
     * Anchor playback.
     *
     * :param startNtp: absolute NTP instant the first frame belongs to. Every
     *   member of a sync group is handed the same one, which is what lines a RAOP
     *   zone up with an AirPlay 2 zone: both express the same moment.
     */
    start(startNtp?: bigint): void;
    stop(): void;
    /** Send one packet of interleaved s16le PCM. */
    sendPacket(pcm: Buffer): void;
    /** Where the timeline is now — reported once a second so the device can follow. */
    private sendSync;
    /** Same retransmit contract as the AirPlay 2 lane: 0x55 asks, 0x56 answers. */
    private onControl;
}
