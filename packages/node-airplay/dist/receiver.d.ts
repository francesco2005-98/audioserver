/**
 * The receiving half: an AirPlay 1 (RAOP) target other devices can stream to.
 *
 * Ported from libraop's `raop_server.c`. This is the mirror of everything else
 * in the package — an RTSP *server* instead of a client, ALAC decoding instead
 * of encoding, polling someone else's clock instead of serving our own.
 *
 * **Encryption is the caller's decision, not this package's.** A sender may
 * encrypt the audio with an AES key it wraps in the receiver's RSA public key,
 * and may demand an `Apple-Challenge` response signed with the matching private
 * key. That key is Apple's, and shipping it is not something a library should
 * decide for the person publishing it — so both operations are optional hooks
 * ({@link ReceiverOptions.rsa}). With no hook the service advertises `et=0`,
 * which is the honest statement that it takes cleartext only.
 *
 * mDNS advertising is likewise left to the caller: the port and the TXT record
 * are handed out, and the application publishes them with whatever responder it
 * already runs.
 */
export type ReceiverEvent = {
    type: 'stream';
    port: number;
}
/** The sender named its remote-control service; resolve it to send commands back. */
 | {
    type: 'remote';
    dacpId: string;
    activeRemote: string;
} | {
    type: 'play';
} | {
    type: 'pause';
} | {
    type: 'flush';
} | {
    type: 'stop';
} | {
    type: 'volume';
    value: number;
} | {
    type: 'metadata';
    title?: string;
    artist?: string;
    album?: string;
    durationMs?: number;
}
/** Where the sender says it is in the track. */
 | {
    type: 'progress';
    elapsedMs: number;
    durationMs: number;
} | {
    type: 'artwork';
    contentType: string;
    data: Buffer;
} | {
    type: 'pcm';
    sampleRate: number;
    channels: number;
    data: Buffer;
};
export interface ReceiverOptions {
    /** Name shown to senders; goes in the mDNS instance name. */
    name: string;
    /** Model string for the TXT record's `am` field. */
    model?: string;
    /** Six bytes identifying this receiver — the mDNS instance name's prefix. */
    mac?: Buffer;
    /** TCP port for RTSP; 0 picks a free one. */
    port?: number;
    /**
     * Hooks for the two operations that need Apple's AirPort private key. Supply
     * them to accept encrypted senders; leave them out and the service advertises
     * cleartext only.
     */
    /** Called for every request, so a caller can see how far a sender got. */
    onRequest?: (info: {
        method: string;
        appleChallenge: boolean;
        encryptedKey: boolean;
        headers: string[];
    }) => void;
}
/** What the caller needs to advertise the service over mDNS. */
export interface ReceiverAdvertisement {
    /** `<mac hex>@<name>`, the instance name senders expect. */
    instanceName: string;
    port: number;
    /** TXT record as key/value pairs. */
    txt: Record<string, string>;
}
/**
 * A running RAOP receiver. One instance serves one sender at a time, which is
 * what the protocol assumes: a second ANNOUNCE replaces the first.
 */
export declare class AirPlayReceiver {
    private readonly options;
    private readonly onEvent;
    private server;
    private readonly sessions;
    private readonly mac;
    private lastSeq;
    private lastTs;
    private counters;
    private volume;
    constructor(options: ReceiverOptions, onEvent: (event: ReceiverEvent) => void);
    /**
     * What the audio path has seen since the stream started.
     *
     * `missed` counts gaps in the sender's sequence numbers -- audio that never
     * arrived -- and is the number that separates a network problem from a
     * decoding one, which sound identical from the outside.
     */
    get stats(): {
        received: number;
        missed: number;
        retransmitted: number;
        undecodable: number;
        resendsAsked: number;
        framesAnnounced: number;
        framesDecoded: number;
    };
    /** Start listening. Returns what the caller needs to advertise. */
    start(): Promise<ReceiverAdvertisement>;
    stop(): void;
    private onConnection;
    private reply;
    private handleRequest;
    /** Read the codec parameters, and the AES key when the sender encrypted one. */
    private handleAnnounce;
    private handleSetup;
    /**
     * Ask the sender to send a run of packets again.
     *
     * Not a standard RTCP NACK: eight bytes, type 0x55, carrying the first
     * missing sequence number and how many follow. Without this a receiver simply
     * keeps whatever holes the network left, and on a link with any loss that is
     * the difference between clean audio and a hiccup every few seconds.
     */
    private requestResend;
    /**
     * The control port carries two different things and they must not be
     * confused: a retransmit reply (type 0xD6) wraps a real audio packet behind a
     * four-byte header, while a sync packet (0xD4) is the sender telling us where
     * its timeline is. Feeding the latter to the decoder produces exactly what it
     * sounds like.
     */
    private onControl;
    /** Ask the sender for the time, the same 0xD2/0xD3 exchange we answer as a sender. */
    private startTimingClient;
    /**
     * One audio packet: strip the RTP header, decrypt when the sender encrypted,
     * decode, and hand the PCM up.
     *
     * AES here is CBC over whole 16-byte blocks only — the tail of the payload is
     * left in the clear, which is what the format specifies and what a decoder
     * that assumes otherwise gets wrong.
     */
    private onAudio;
    /** Volume, track metadata and cover art all arrive on SET_PARAMETER. */
    private handleSetParameter;
    private teardown;
}
/**
 * Send a transport command back to the device that is streaming to us.
 *
 * The sender publishes an `_dacp._tcp` service named `iTunes_Ctrl_<DACP-ID>`;
 * resolving that is the caller's job (this package carries no mDNS), and the
 * address it finds goes in here. The request itself is a bare HTTP GET carrying
 * the `Active-Remote` token as its only credential.
 */
export declare function sendRemoteCommand(host: string, port: number, activeRemote: string, command: 'play' | 'pause' | 'playpause' | 'stop' | 'nextitem' | 'previtem' | 'mutetoggle', timeoutMs?: number): Promise<boolean>;
