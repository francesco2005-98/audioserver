/**
 * @audioserver/node-airplay — an AirPlay sender for Node.js, in TypeScript.
 *
 * The protocol logic follows Music Assistant's `cliairplay` (Apache-2.0), which
 * encodes years of measurements against real receivers; this is a port of that
 * behaviour, not a fresh reading of the protocol.
 *
 * Status: connect, device capability read and transient HAP pairing are in
 * place. Session SETUP, PTP timing and the audio stream follow.
 */
import { type SenderIdentity, type SessionSetupResult } from './session.js';
import { type PlistValue } from './bplist.js';
import { type HapSession } from './hap.js';
import { RtspConnection } from './rtsp.js';
export { parseBinaryPlist, type PlistValue } from './bplist.js';
export { buildBinaryPlist, PlistInt64, type PlistInput } from './bplistWriter.js';
export { HapError, HapSession } from './hap.js';
export { RtspConnection } from './rtsp.js';
export { TRANSIENT_PIN } from './srp.js';
export { PtpEngine, type PtpEngineOptions } from './ptp.js';
export { NtpTimingResponder, ntpNow, buildNtpSyncPacket } from './ntpTiming.js';
export { AlacDecoder, parseAlacFmtp, type AlacConfig } from './alacDecoder.js';
export { AirPlayReceiver, sendRemoteCommand, type ReceiverOptions, type ReceiverEvent, type ReceiverAdvertisement, } from './receiver.js';
export { connectRaop, RaopStreamer, RAOP_FRAMES_PER_PACKET, type RaopConnectOptions, type RaopSession, type RaopStreamOptions, } from './raop.js';
export { encodeAlacPacket, type AlacEncoderOptions } from './alac.js';
export { setupRealtimeStream, RealtimeSender, setVolume, volumeToDb, setMetadata, setArtwork, FRAMES_PER_PACKET, AUDIO_FORMAT_ALAC_44100_16_2, type StreamSetupResult, type RealtimeSenderOptions, } from './stream.js';
export { connectEvents, startFeedback, FEEDBACK_INTERVAL_MS, createIdentity, setupSession, type SenderIdentity, type SessionSetupResult } from './session.js';
/** Feature bits that decide the route (see the mDNS `features`/`ft` TXT field). */
export declare const FEATURE: {
    /** SupportsUnifiedMediaControl → the device speaks AirPlay 2. */
    readonly UNIFIED_MEDIA_CONTROL: 38n;
    /** SupportsBufferedAudio → the type-103 stream is available. */
    readonly BUFFERED_AUDIO: 40n;
    /** SupportsPTP → PTP timing rather than the NTP responder. */
    readonly PTP: 41n;
    /** SupportsHKPairingAndAccessControl. */
    readonly HK_PAIRING: 46n;
    /** SupportsCoreUtilsPairingAndEncryption → AirPlay 2, pairing-capable. */
    readonly COREUTILS_PAIRING: 48n;
};
/** Status flags (`flags`/`sf` TXT field) that force a user-visible pairing. */
export declare const STATUS_FLAG: {
    readonly PIN_REQUIRED: 8;
    readonly LEGACY_PAIRING: 512;
};
export interface DeviceTxt {
    /** `features=0xLOW,0xHIGH` (or `ft=`), as advertised. */
    features?: string;
    /** `flags=` (or `sf=`), as advertised. */
    flags?: string;
    /** `model=` (or `am=`), e.g. `AudioAccessory5,1`. */
    model?: string;
}
export interface DeviceCapabilities {
    features: bigint;
    flags: number;
    model: string;
    supportsAirPlay2: boolean;
    supportsPtp: boolean;
    supportsBufferedAudio: boolean;
    /**
     * True when the device forces a PIN/legacy pairing flow, i.e. transient
     * pairing will not do and stored credentials are required. Current HomePods
     * are false here: they take transient pairing with no user interaction.
     */
    requiresUserPairing: boolean;
    /** Apple receivers get the realtime lane; buffered is denied on measurement. */
    isAppleReceiver: boolean;
}
/** Parse the two-word `0xLOW,0xHIGH` feature form into one 64-bit value. */
export declare function parseFeatures(value: string | undefined): bigint;
/** Read a device's capabilities out of its mDNS TXT record. */
export declare function readCapabilities(txt: DeviceTxt): DeviceCapabilities;
export interface ConnectOptions {
    host: string;
    /** AirPlay 2 receivers listen on 7000. */
    port?: number;
    /** Device password, when it has one; otherwise transient pairing is used. */
    password?: string;
    timeoutMs?: number;
    /**
     * Stable 8-byte sender identity (deviceID / macAddress / PTP ClockID). Pass a
     * value derived from the host so a receiver recognises us across restarts;
     * a random one is generated otherwise.
     */
    identity?: Buffer;
    /** Name the receiver shows for the session. */
    name?: string;
    /**
     * Session-level diagnostics: the keepalive's result and the moment the
     * receiver drops the control channel. Without this a dead session looks
     * exactly like a healthy one from the sending side.
     */
    onEvent?: (event: string) => void;
}
/**
 * A control connection to an AirPlay 2 receiver: paired, encrypted, and ready
 * for the stream setup that follows.
 */
export declare class AirPlayConnection {
    readonly rtsp: RtspConnection;
    readonly hap: HapSession;
    /** The plaintext `GET /info` reply read before pairing. */
    readonly info: {
        [key: string]: PlistValue;
    };
    readonly identity: SenderIdentity;
    /** `rtsp://<our address>/<session id>` — the target for every later request. */
    readonly sessionUrl: string;
    private readonly host;
    private readonly onEvent?;
    private constructor();
    private events;
    private stopFeedback;
    /**
     * Run the session SETUP. The timeline follows our own clock, so the PTP
     * engine must be serving under {@link identity}'s clockId by the time the
     * receiver starts probing it.
     */
    setupSession(name?: string, timing?: {
        timing: 'ptp' | 'ntp';
        timingPort?: number;
    }): Promise<SessionSetupResult>;
    /**
     * Open the control channel: read the device's `/info`, run transient HAP
     * pair-setup, and switch the connection to encrypted framing.
     */
    static open(options: ConnectOptions): Promise<AirPlayConnection>;
    /**
     * Read `GET /info`. Works both before pairing (plaintext) and after, where a
     * successful reply is the proof that the encrypted channel is in step.
     */
    static readInfo(rtsp: RtspConnection): Promise<{
        [key: string]: PlistValue;
    }>;
    /** Re-read `/info` over the (now encrypted) channel. */
    refreshInfo(): Promise<{
        [key: string]: PlistValue;
    }>;
    close(): void;
}
