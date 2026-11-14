/**
 * The realtime (type 96) audio stream: RECORD, the stream SETUP, and the RTP
 * send path with its PTP anchor.
 *
 * Ported from cliairplay's `ap2_client.c`. Two orderings in here are load-bearing:
 * RECORD goes out BEFORE the stream SETUP (a Samsung receiver 200-ACKs the other
 * order and then renders silence), and the anchor line is frozen once at stream
 * start so every periodic sync packet extrapolates along the same line rather
 * than re-deriving one.
 */
import { type Socket } from 'node:dgram';
import type { PtpEngine } from './ptp.js';
import type { RtspConnection } from './rtsp.js';
/** ALAC 44100/16/2 — bit 18 of the audioFormat space. */
export declare const AUDIO_FORMAT_ALAC_44100_16_2: number;
/** Frames per packet the AirPlay session negotiates. */
export declare const FRAMES_PER_PACKET = 352;
export interface StreamSetupResult {
    /** UDP port on the receiver that RTP audio goes to. */
    dataPort: number;
    /** UDP port on the receiver that anchor/sync packets go to. */
    controlPort: number;
}
/**
 * RECORD, then the stream SETUP. Returns the receiver's ports.
 *
 * :param audioKey: the 32-byte `shk` — the pairing shared secret, which is what
 *   the receiver decrypts RTP payloads with.
 * :param localDataPort/localControlPort: our own bound UDP ports.
 */
export declare function setupRealtimeStream(rtsp: RtspConnection, sessionUrl: string, options: {
    audioKey: Buffer;
    localDataPort: number;
    localControlPort: number;
    streamConnectionId: number;
}): Promise<StreamSetupResult>;
/** Map a 0-100 level onto the AirPlay dB scale; 0 is mute. */
export declare function volumeToDb(volume: number): number;
export declare function setVolume(rtsp: RtspConnection, sessionUrl: string, volume: number): Promise<void>;
/**
 * Push track metadata over the encrypted control channel as a DMAP `mlit` blob.
 *
 * There are two metadata paths on AirPlay 2 and only this one is open to us:
 * Apple's now-playing screen rides the type-130 MediaRemote channel, whose keys
 * derive from a pair-VERIFY shared secret, so it needs stored credentials from a
 * PIN pairing. A transiently paired session cannot reach it. This DMAP push over
 * SET_PARAMETER needs no credentials, and some receivers (Sonos) withhold audio
 * entirely until they have had it.
 *
 * :param rtpTimestamp: the current RTP position — the blob is anchored to it,
 *   and a receiver may reject a metadata request that arrives without one.
 */
export declare function setMetadata(rtsp: RtspConnection, sessionUrl: string, metadata: {
    title?: string;
    artist?: string;
    album?: string;
}, rtpTimestamp: number): Promise<void>;
/** Push cover art on the same DMAP/SET_PARAMETER path as {@link setMetadata}. */
export declare function setArtwork(rtsp: RtspConnection, sessionUrl: string, contentType: string, data: Buffer, rtpTimestamp: number): Promise<void>;
export interface RealtimeSenderOptions {
    host: string;
    dataPort: number;
    controlPort: number;
    /** The `shk` the stream SETUP announced. */
    audioKey: Buffer;
    ptp: PtpEngine;
    /**
     * Timing lane. `ntp` swaps the anchor packet for the 20-byte NTP form and
     * leaves the PTP engine out of the timeline; the receiver polls our responder
     * instead. Apple receivers must stay on `ptp` — they render silence on an
     * NTP-timed realtime stream.
     */
    timing?: 'ptp' | 'ntp';
    /**
     * How far ahead of the render point audio is handed over, in milliseconds:
     * the receiver plays a sample this long after we send it.
     */
    leadMs?: number;
    onLog?: (message: string) => void;
}
/**
 * Feeds one receiver: ALAC-encodes PCM, encrypts each packet, and keeps the
 * anchor announcements flowing so the receiver knows where on the PTP timeline
 * the audio belongs.
 */
export declare class RealtimeSender {
    private readonly options;
    private readonly dataSocket;
    private readonly controlSocket;
    private sequence;
    private rtpTimestamp;
    private firstPacket;
    private anchorWall0;
    private anchorPos0;
    private anchored;
    private syncTimer;
    private readonly leadMs;
    packetsSent: number;
    /** Current RTP position; metadata is anchored to it. */
    get rtpPosition(): number;
    /** Packets kept on the wire exactly as sent, so a resend is a byte copy —
     * re-encrypting would need the original nonce anyway. */
    private readonly rtxRing;
    private readonly rtxSeq;
    rtxRequested: number;
    rtxAnswered: number;
    rtxExpired: number;
    constructor(options: RealtimeSenderOptions, dataSocket: Socket, controlSocket: Socket);
    /**
     * Answer a receiver's request for audio it lost.
     *
     * Request (type 0x55): [2:4] the request's own sequence, [4:6] the first
     * missing RTP sequence, [6:8] how many. The reply wraps the original packet
     * verbatim behind a 4-byte header echoing that request sequence, and goes
     * back to where the request came from rather than the configured control
     * address — the same endpoint for a well-behaved receiver, and it keeps
     * working for one that asks from a different source port.
     */
    private onControl;
    /** Bind the two local UDP sockets the stream SETUP has to advertise. */
    static bindSockets(): Promise<{
        data: Socket;
        control: Socket;
        dataPort: number;
        controlPort: number;
    }>;
    /**
     * Freeze the anchor line and start announcing it.
     *
     * :param startAtUnixMs: for a synchronised group, the wall-clock instant the
     *   first sample must be AUDIBLE on every member. All members are handed the
     *   same value, so they map the same sample to the same moment however far
     *   ahead each one runs. Anchoring one lead early is what makes the line's
     *   audible point land exactly on that instant. Omitted = start now, which is
     *   the solo case.
     *
     * This works because our timeline is the host's realtime clock — the same
     * base the caller's shared instant comes from — and because every member of
     * the group is served by the one grandmaster this process runs.
     */
    start(startAtUnixMs?: number): void;
    stop(): void;
    /**
     * Send one packet of interleaved s16le PCM — exactly
     * {@link FRAMES_PER_PACKET} frames unless it is the last one.
     */
    sendPacket(pcm: Buffer): void;
    /**
     * The 28-byte anchor packet: where the media timeline sits on the PTP clock.
     * Every one extrapolates along the line frozen in {@link start}, so all of
     * them agree.
     */
    private sendSyncPacket;
}
