import type { IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import { AudioCodec, ClientStateType, ClientHelloSourceSupport, SupportedAudioFormat, SourceStateType, SourceSignalType, ConnectionReason, ControllerStatePayload, DeviceInfo, GoodbyeReason, MediaCommand, PlaybackStateType, PlayerCommand, RepeatMode, RoleName, ServerCommandPayload, SessionUpdateColor, VisualizerSupport, VisualizerStreamConfig, SourceClientCommand, TrustLevel } from '../types.js';
import { PskCategory, type PskProvider } from '../noise/handshake.js';
import type { Identity } from '../noise/keys.js';
/**
 * What a session needs to speak the encrypted path.
 *
 * Without it a `client/init` is refused and only transition-mode (unencrypted)
 * clients can connect. `identity` must be stable across restarts: it *is* the
 * server's `server_id`, and regenerating it makes us a different server to every
 * client that remembered us.
 */
export interface SendspinSecurity {
    identity: Identity;
    pskProvider: PskProvider;
    /**
     * Whether the operator has approved this client for unpaired playback.
     *
     * pairing.md "Unpaired Access": a server MUST NOT declare `'playback'` or
     * activate roles on an unpaired connection to a client its operator has not
     * approved. Omitted means every client is approved, which is what a host that
     * dials only the devices its user picked (Audioserver) amounts to.
     */
    isApprovedUnpaired?: (clientId: string) => boolean;
}
/**
 * Why an encrypted session is held idle (no activities, no roles) instead of
 * playing: the client admits no unpaired playback, the operator has not approved
 * it, or it no longer holds the credential this server offered.
 */
export type SendspinPairingRequiredReason = 'unpaired_access_disabled' | 'not_approved' | 'credential_mismatch';
/**
 * How this server names itself to clients.
 *
 * `serverId` must be unique on the network and stable across restarts: a client
 * doing multi-server arbitration keys on it, so two servers sharing one id are
 * indistinguishable and a client will treat them as the same machine. Under
 * encryption it is the identity's public key and this value is ignored.
 */
export interface SendspinServerInfo {
    serverId: string;
    name: string;
    /**
     * Codecs this server accepts in a source's `client-stream/start`, announced as
     * `source@v1_support.supported_codecs` in the encrypted `server/hello` (rc1
     * source role: "required if the server supports the source@v1 role"). `flac`
     * and `pcm` are always added, as the spec requires; list `opus` only if you can
     * decode it. Pass `[]` for just those two. Left unset, nothing is announced, as
     * before: an rc1 source then falls back to `flac` or `pcm` by itself.
     */
    sourceCodecs?: AudioCodec[];
}
/** A role family that receives a server-to-client stream. */
export type StreamFamily = 'player' | 'artwork' | 'visualizer';
export type SendspinConnectionMeta = {
    zoneId?: number;
    playerId?: string;
    remote?: string | null;
};
export interface SendspinPcmFrame {
    data: Buffer;
    timestampUs?: number;
    /**
     * How long the chunk plays, in microseconds. Needed for buffer accounting
     * ({@link SendspinSession.getPlayerBufferedBytes}); derived from the stream
     * format for PCM, so only an encoded (FLAC, Opus) chunk has to state it.
     */
    durationUs?: number;
}
export interface PlayerFormat {
    codec: AudioCodec;
    sampleRate: number;
    channels: number;
    bitDepth: number;
    codecHeader?: string;
}
export type PlayerFormatWithBitDepth<T extends number = number> = Omit<PlayerFormat, 'bitDepth'> & {
    bitDepth: T;
};
export interface SendspinPlayerStateUpdate {
    clientId: string | null;
    roles: RoleName[];
    /**
     * Whether the client is available for playback, as it last reported.
     *
     * Resolved from `available` when the client sends it, and from the legacy
     * `state` enum otherwise, so a consumer never has to know which spelling
     * arrived. Undefined only while a client has said nothing either way.
     */
    available?: boolean;
    /**
     * @deprecated The legacy enum: as the client sent it, or for an rc1 client (which
     * sends only `available`) derived from that. Prefer {@link available}.
     */
    state?: ClientStateType;
    volume?: number;
    muted?: boolean;
    /**
     * The player's own timing declarations, as last reported.
     *
     * Absent from an update means the client did not restate them, not that they changed — per the
     * spec's delta rules a player may omit anything unchanged after its initial message. So these
     * carry the session's *current* view rather than only what this message contained, which is what a
     * server needs: it has to factor `staticDelayMs` into how far ahead it sends on every stream, not
     * only on the one that happened to follow a full state report.
     */
    staticDelayMs?: number;
    /** The same value as {@link staticDelayMs}, under its 1.0.0-rc1 name (`output_delay_ms`, #164). */
    outputDelayMs?: number;
    requiredLeadTimeMs?: number;
    minBufferMs?: number;
}
export interface SendspinGroupCommand {
    clientId: string | null;
    roles: RoleName[];
    command: MediaCommand;
    volume?: number;
    mute?: boolean;
    /** Absolute target position in ms, on a `seek`. */
    positionMs?: number;
    /** Signed offset in ms, on a `seek_relative`. */
    offsetMs?: number;
}
export interface SendspinSourceStateUpdate {
    clientId: string | null;
    roles: RoleName[];
    state?: SourceStateType;
    level?: number;
    signal?: SourceSignalType;
}
export interface SendspinSourceCommand {
    clientId: string | null;
    roles: RoleName[];
    command: SourceClientCommand;
}
export interface SendspinSourceAudioChunk {
    timestampUs: number;
    data: Buffer;
}
/** The format a source client announced with `client_stream/start`. */
export interface SendspinSourceStreamFormat {
    codec: AudioCodec;
    sampleRate: number;
    channels: number;
    bitDepth: number;
    codecHeader?: string;
}
/** One artwork channel as the client declared it, in the shape core consumes. */
export interface SendspinArtworkChannel {
    source: 'album' | 'artist' | 'none';
    format: 'jpeg' | 'png' | 'bmp';
    width: number;
    height: number;
}
export interface SendspinSessionHooks {
    onPlayerState?: (session: SendspinSession, update: SendspinPlayerStateUpdate) => void;
    onGroupCommand?: (session: SendspinSession, command: SendspinGroupCommand) => void;
    onSourceState?: (session: SendspinSession, update: SendspinSourceStateUpdate) => void;
    onSourceCommand?: (session: SendspinSession, command: SendspinSourceCommand) => void;
    onSourceAudio?: (session: SendspinSession, chunk: SendspinSourceAudioChunk) => void;
    /**
     * A source client announced (or re-announced) its input stream format via
     * `client_stream/start`. Fires before any audio for that stream arrives, so a
     * consumer can stand up its ingest with the real format instead of guessing.
     */
    onSourceStreamStart?: (session: SendspinSession, format: SendspinSourceStreamFormat) => void;
    /**
     * A source's `signal` changed (or was first reported, or reported again after it
     * came back available): `present` means it has audio to offer, a cue to send
     * `start`; `absent` a cue to send `stop`. rc1 sources send no `state`.
     */
    onSourceSignalChanged?: (session: SendspinSession, signal: SourceSignalType) => void;
    /** A source client ended its input stream via `client_stream/end`. */
    onSourceStreamEnd?: (session: SendspinSession) => void;
    /**
     * The visualizer client renegotiated its stream via `stream/request-format`.
     * The new config has already been echoed back in a fresh `stream/start`; the
     * consumer needs it to re-pace or re-shape what it feeds in.
     */
    onVisualizerFormatChanged?: (session: SendspinSession, config: VisualizerStreamConfig) => void;
    /**
     * An rc1 artwork client changed its channels in `client/state` while its stream
     * was up. The session has already re-sent `stream/start` with the new channels;
     * images for them have to be re-encoded at the new size and sent again.
     */
    onArtworkChannelsChanged?: (session: SendspinSession, channels: SendspinArtworkChannel[]) => void;
    /**
     * This encrypted session is held idle: it may not play until the device is
     * paired or its unpaired access is enabled (or the operator approves it). The
     * session stays open; see {@link SendspinSession.getPairingRequired}.
     */
    onPairingRequired?: (session: SendspinSession, reason: SendspinPairingRequiredReason) => void;
    /**
     * The client sent `client/leave` (1.0.0-rc1, #209): take it out of its group into
     * a stopped solo group. Without this hook the session reports the leave as an
     * `external_source` then `synchronized` player state, the pre-rc1 spelling.
     */
    onLeave?: (session: SendspinSession) => void;
    onIdentified?: (session: SendspinSession, req: IncomingMessage | null) => void;
    onDisconnected?: (session: SendspinSession) => void;
    onFormatChanged?: (session: SendspinSession, format: PlayerFormat) => void;
    onGoodbye?: (session: SendspinSession, reason: GoodbyeReason) => void;
    onUnsupportedRoles?: (session: SendspinSession, roles: RoleName[]) => void;
    /**
     * A client deviated from the spec and the session tolerated it. Fired once per
     * distinct reason, so it is safe to log at warning level.
     */
    onNoncompliance?: (session: SendspinSession, reason: string) => void;
}
/**
 * Per-connection Sendspin session. Handles handshake, time sync, player/controller state,
 * and sending stream/metadata/commands to the client.
 */
export declare class SendspinSession {
    private readonly ws;
    private readonly req;
    private connectionReason;
    private readonly connectionMeta;
    private ready;
    private clientId;
    private clientName;
    private roles;
    private playerSupport;
    /** `device_info` from the hello, kept for peer-compatibility decisions. */
    private deviceInfo;
    /** Media commands this peer's library is too old to name; see peer-compat. */
    private blindMediaCommands;
    private sourceSupport;
    private artworkChannels;
    /**
     * How this peer speaks, decided once at hello time as the reference does.
     *
     * A legacy peer predates 1.0.0-rc1: it connected unencrypted, or its hello still
     * carried `trust_level` (#158) or `player@v1_support.supported_commands` (#177).
     * Every wire difference with no role-local marker of its own switches on this:
     * the 9-byte audio header, the 2/3 fragment framing, and so on.
     */
    private legacyWire;
    /** The hello declared `artwork@v1_support` (pre-#195), so artwork uses the single-message wire (pre-#188). */
    private legacyArtwork;
    /** The hello carried visualizer stream config (`types`/`rate_max`/`spectrum`), pre-#195. */
    private legacyVisualizer;
    /** An rc1 artwork peer's channels arrived in `client/state`; until then no artwork may be sent. */
    private artworkStateReceived;
    /** An artwork `stream/start` was asked for before the channels were known. */
    private artworkStartPending;
    /** The rc1 artwork stream is active; carries the 4-channel config it was started with. */
    private artworkStreamConfigs;
    /** Images waiting to be transferred, latest per channel, in arrival order. */
    private readonly artworkQueue;
    /** The one transfer allowed in flight across all channels. */
    private artworkInFlight;
    private artworkPumping;
    /** Images sent while the artwork `stream/start` was held, sent once it goes out. */
    private readonly artworkHeld;
    private visualizerSupport;
    /** The visualizer config the host last asked to stream, before fitting it to the client. */
    private visualizerHostConfig;
    /** An rc1 visualizer's stream config arrived in `client/state` (#195). */
    private visualizerStateReceived;
    /** Last visualizer@v1 config we announced, so a renegotiation can patch it. */
    private visualizerStreamConfig;
    private expectVolume;
    private expectMute;
    /** Player commands a legacy hello listed in `player@v1_support.supported_commands` (pre-#177). */
    private helloPlayerCommands;
    /** `supported_commands` from the latest `client/state` player object (#177), null until one arrives. */
    private statePlayerCommands;
    /** A `client/state` carrying the player object has arrived; no player command may precede it. */
    private playerStateReceived;
    /** What the player holds against its `buffer_capacity`, counted as rc1 defines it (#288). */
    private readonly playerBuffer;
    /** Stream starts asked for while rc1 forbade them, flushed once a client/state allows them. */
    private readonly pendingStarts;
    /** The visualizer config of a pending visualizer start. */
    private pendingVisualizerConfig;
    /** The group id and name last sent an rc1 peer, to fill an update that omits them. */
    private lastGroup;
    /** The format the player's latest `client/state` prefers (#195), or null for no preference. */
    private playerPreferredFormat;
    /** Controller commands as last offered in `sendControllerState`, after per-peer filtering. */
    private offeredControllerCommands;
    private warnedMissingVolume;
    private warnedMissingMute;
    private initialStateReceived;
    /** Last reported player timing (see SendspinPlayerStateUpdate); undefined until the client says. */
    private staticDelayMs;
    private requiredLeadTimeMs;
    private minBufferMs;
    private initialStateTimer;
    private initialStateRequired;
    private identified;
    private playbackState;
    private lastStateSignature;
    private sourceState;
    private sourceSignal;
    /** Format from the source's last `client_stream/start`, cleared on `client_stream/end`. */
    private sourceStreamFormat;
    /** Availability as last reported, resolved across `available` and the legacy enum. */
    private available;
    private trustLevel;
    private unpairedAccess;
    /** Deviations already reported, so a chatty client is flagged once per reason. */
    private readonly flaggedNoncompliance;
    /**
     * Where this connection is in the Noise bring-up.
     *
     * `plaintext` covers both "nothing decided yet" and a transition-mode client that
     * opened with `client/hello`; the two are distinguished by `ready`.
     */
    private noisePhase;
    private handshake;
    private transport;
    private security;
    private authenticatedClientId;
    private pskCategory;
    /** The handshake only verified against the Sentinel after naming another PSK (Sentinel Fallback). */
    private credentialMismatch;
    /** Why this session is held idle, or null when it may play. */
    private pairingRequired;
    /** The roles negotiated from the hello, whether or not they could be activated. */
    private negotiatedRoles;
    /** Activities declared in the last `server/activate`. */
    private declaredActivities;
    private readonly serverName;
    private readonly sourceCodecs;
    /** A source `start` asked for before rc1 allowed it, sent once a `client/state` does. */
    private pendingSourceStart;
    /** The source object of a `client/state` has arrived; no `start` may precede it. */
    private sourceStateReceived;
    private readonly serverId;
    private hooks;
    private hooksAttached;
    /**
     * Server-to-client streams currently open on this connection, by role family.
     *
     * rc1 forbids a `stream/clear` or `stream/end` naming a role with no active
     * stream, or sent when none is (messaging.md), so both are filtered against it.
     */
    private readonly activeStreams;
    private get activeStream();
    private streamFormat;
    private lastGoodbyeReason;
    /** Full metadata@v1 state as last sent to an rc1 peer (see {@link sendMetadata}). */
    private readonly metadataState;
    /** Full color@v1 state as last sent to an rc1 peer (see {@link sendColor}). */
    private readonly colorState;
    private readonly maxBufferedSend;
    private streamGeneration;
    private backpressureDrops;
    private lastBackpressureBytes;
    private lastBackpressureTs;
    private backpressureEvents;
    constructor(ws: WebSocket, req: IncomingMessage | null, connectionReason?: ConnectionReason, connectionMeta?: SendspinConnectionMeta, hooks?: SendspinSessionHooks, security?: SendspinSecurity | null, serverInfo?: SendspinServerInfo);
    /** Whether this connection is carrying its application messages under Noise. */
    isEncrypted(): boolean;
    /**
     * Whether this peer predates 1.0.0-rc1 and gets the pre-rc1 wire.
     *
     * Decided at hello time: an unencrypted connection, or a hello carrying
     * `trust_level` or `player@v1_support.supported_commands`. False before the hello.
     */
    isLegacyWire(): boolean;
    /** Whether artwork goes out as one `[type][timestamp][image]` message (hello-declared artwork). */
    usesLegacyArtworkWire(): boolean;
    /** Whether the visualizer stream config came from the hello rather than `client/state`. */
    usesLegacyVisualizerConfig(): boolean;
    /**
     * Bytes of header in front of each player audio chunk on this connection: 13 for
     * an rc1 peer (with `send_ahead`), 9 for a legacy one. A capacity count against
     * the player's `buffer_capacity` has to include it.
     */
    getAudioHeaderSize(): number;
    /**
     * How this connection was admitted, or null when it is unencrypted.
     *
     * `SENTINEL` means the published constant PSK admitted it: encrypted against a
     * passive listener, but authenticating nothing. Do not treat it as paired.
     */
    getPskCategory(): PskCategory | null;
    setHooks(hooks: SendspinSessionHooks, context?: SendspinConnectionMeta): void;
    hasHooksAttached(): boolean;
    getClientId(): string | null;
    /**
     * The player's timing declarations, or undefined for each the client has not reported.
     *
     * Read this at stream start: `staticDelayMs` must be added to the send-ahead, and the two lead
     * hints shape the first chunk's timestamp. Waiting for the next `client/state` would mean a stream
     * that begins before one arrives is scheduled as if the client had declared nothing.
     */
    getPlayerTiming(): {
        staticDelayMs: number | undefined;
        outputDelayMs: number | undefined;
        requiredLeadTimeMs: number | undefined;
        minBufferMs: number | undefined;
    };
    getClientName(): string | null;
    getRoles(): RoleName[];
    getInfo(): {
        id: string | null;
        roles: RoleName[];
        playbackState: PlaybackStateType;
    };
    getDescriptor(): {
        clientId: string | null;
        roles: RoleName[];
        playbackState: PlaybackStateType;
        remote: string | null;
    };
    getConnectionReason(): ConnectionReason;
    getLastGoodbyeReason(): GoodbyeReason | null;
    getRemoteAddress(): string | null;
    getStreamFormat(): PlayerFormat;
    getSourceStatus(): {
        state: SourceStateType | null;
        signal: SourceSignalType | null;
    };
    /**
     * Whether the client last reported itself available for playback, or undefined
     * if it has said nothing either way. Resolved across `available` and the legacy
     * `state` enum.
     */
    isAvailable(): boolean | undefined;
    /** The format the source announced with `client_stream/start`, or null when no stream is up. */
    getSourceStreamFormat(): SendspinSourceStreamFormat | null;
    /** `device_info` as reported in the hello, or null when the client sent none. */
    getDeviceInfo(): DeviceInfo | null;
    /** What the client said in its hello about trust and unpaired access. */
    getTrust(): {
        trustLevel: TrustLevel;
        unpairedAccess: boolean;
    };
    getSourceSupport(): ClientHelloSourceSupport | null;
    getBackpressureStats(): {
        drops: number;
        lastBytes: number;
        lastDropTs: number | null;
        recentDrops: number;
    };
    getPlayerBufferCapacity(): number;
    /**
     * The player's declared format list from client/hello, in the client's own
     * priority order (first entry = preferred).
     *
     * Hosts need the whole list, not just the preferred entry, to pick a format that
     * matches the *source* instead of always taking entry 0 — e.g. streaming a
     * 24-bit/96 kHz file untouched to a client that happens to list 48 kHz first,
     * but only when that client also declared 96 kHz support.
     *
     * Returns copies so callers cannot mutate session state, and an empty array when
     * the client declared nothing.
     */
    getPlayerSupportedFormats(): SupportedAudioFormat[];
    /**
     * Player commands this client accepts: those listed in its latest `client/state`
     * player object (#177), plus any a legacy hello listed. Empty until either says.
     */
    getPlayerSupportedCommands(): string[];
    getArtworkChannels(): SendspinArtworkChannel[];
    destroy(): void;
    /**
     * A cleartext frame from the socket.
     *
     * Only the Noise bring-up and transition-mode clients arrive here; once
     * encryption is up every application message is a binary frame and reaches
     * {@link dispatchText} through the transport instead.
     */
    handleText(text: string): void;
    /** Whether a pre-hello cleartext frame belongs to a transition-mode (unencrypted) client. */
    private isTransitionOpening;
    /** Answer an unacceptable `client/init` with `server/error`, then close. */
    private rejectInit;
    /**
     * Parse and route one JSON message, never letting a bad one escape.
     *
     * A peer controls every byte here, so nothing it sends may throw out of the
     * socket handler: in Audioserver an uncaught exception shuts the whole server
     * down. rc1 lets a receiver ignore an unknown `type` only when the message is a
     * JSON object with a `type` string and a `payload` object (#289); anything else
     * is not a Sendspin message at all.
     */
    private dispatchText;
    /**
     * Answer a message that is not a Sendspin message.
     *
     * rc1 peers are closed, as the spec has it (a type-0 body that is not a JSON
     * object with a `type` string and a `payload` object is a protocol error). A
     * legacy, plaintext peer keeps today's treatment, which is to skip it.
     */
    private rejectMalformed;
    private routeMessage;
    /** Run the cleartext init exchange and put Noise message 1 on the wire. */
    private startHandshake;
    /** Consume Noise message 2 and switch the connection to transport mode. */
    private completeHandshake;
    handleBinary(data: WebSocket.RawData): void;
    /** Decrypt one transport frame and route its contents as if it arrived in the clear. */
    private handleEncryptedFrame;
    private handleAppBinary;
    private handleHello;
    private handleClientTime;
    private handleClientState;
    /**
     * Follow the format the player says it prefers in `client/state` (#195, #286).
     *
     * rc1 folded `stream/request-format` into the player object: `format` names one
     * of its `supported_formats`, and absent means no preference. With a player
     * stream active, a preference that changes the stream format is applied with a
     * new `stream/start` and reported through `onFormatChanged` (which is what the
     * old request did); with none active nothing starts, and the preference is used
     * for the next stream and readable from {@link getPlayerPreferredFormat}.
     */
    private applyPlayerFormatPreference;
    /**
     * The format the player's latest `client/state` says it prefers, or null when it
     * expressed none. Per rc1 the server SHOULD stream it whenever it can produce it.
     */
    getPlayerPreferredFormat(): PlayerFormat | null;
    /**
     * Remember the timing fields rather than passing this message's copy through.
     *
     * A legacy player may omit them from later updates when unchanged, so reading
     * them off each message alone would report "no delay" after a volume change.
     *
     * The delay is `output_delay_ms` since 1.0.0-rc1 (#164); `static_delay_ms` is
     * its old name and still read, the new key winning when both are present. It
     * is clamped to the spec's 0-5000 (#176), and the lead and buffer hints to
     * 0-30000 as aiosendspin does, so a wild value cannot push the send-ahead out.
     */
    private readPlayerTiming;
    /**
     * Take an rc1 visualizer's stream config from its `client/state` (#195).
     *
     * rc1 moved `types`, `rate_max` and `spectrum` out of the hello into the
     * `client/state` visualizer object, so an rc1 hello yields no types and nothing
     * was ever streamed. The config now lands in {@link getVisualizerSupport}; a
     * change while the stream is up re-derives it and re-sends `stream/start` when
     * that changes anything, firing `onVisualizerFormatChanged`. `spectrum` in
     * `types` without a `spectrum` object is a protocol error and closes. Type 21
     * (`pitch`) is reserved in rc1 and never taken from here.
     *
     * Returns false when the connection is closing.
     */
    private handleVisualizerState;
    /**
     * A visualizer stream config cut down to what an rc1 client currently asks for.
     *
     * rc1: `types` MUST be a subset of the requested ones, `rate_max` MUST NOT exceed
     * the requested rate, `spectrum` MUST match the requested config, and
     * `tracks_downbeats` is required with `beat` and absent without it. With `fit`
     * false only the shape rules are applied, to compare against what was sent.
     */
    private fitVisualizerConfig;
    /**
     * Take an rc1 artwork client's channels from its `client/state` (#195).
     *
     * Returns false when the message must go no further (the connection is closing).
     * A hello-declared (pre-#195) artwork peer keeps the channels it declared there.
     */
    private handleArtworkState;
    private handleClientCommand;
    /**
     * Record a client deviating from the spec, once per distinct reason.
     *
     * The reference funnels every backwards-compatibility tolerance through one place
     * so a deviation is visible rather than silently absorbed. This is that place: we
     * stay lenient on the wire, but the host gets told what was tolerated.
     */
    private flagNoncompliance;
    private handleClientGoodbye;
    /**
     * The client left its group (1.0.0-rc1, #209).
     *
     * The server treats it like the client becoming unavailable: it ends up alone in
     * a stopped group and rejoins only through `switch`; unlike unavailability, a
     * leave ends no stream by itself (spec main #316). Grouping is the host's, so it
     * is told through `onLeave`. A host without that hook still hears it the way the
     * pre-rc1 spec spelled a leave, as an `available` flap: an `external_source`
     * player state followed by a `synchronized` one.
     */
    private handleClientLeave;
    /**
     * A source client announced the format of the input stream it is about to send.
     *
     * The spec puts the source format here rather than in the hello support object, so
     * this is the only place a conformant source states it — and it may restate a new
     * one mid-session, which is why the format is replaced rather than merged.
     */
    private handleClientStreamStart;
    private handleClientStreamEnd;
    private handleStreamRequestFormat;
    /**
     * Answer the client's hello, in whichever shape this connection uses.
     *
     * Encrypted connections were already greeted right after the handshake, so what
     * is owed here is `server/activate` — which is where everything the legacy hello
     * used to carry now lives. The wider legacy shape
     * (`server_id`/`version`/`active_roles`/`connection_reason`) is transition-mode
     * only; the reference calls it `LegacyServerHelloMessage` and still accepts it.
     */
    private sendServerHello;
    /**
     * Declare what this connection is currently for.
     *
     * Encrypted connections learn their roles here rather than from the hello.
     * `playback` is the only activity we ever claim: pairing and management are not
     * implemented, so admission rests entirely on the Sentinel PSK.
     */
    private sendServerActivate;
    /**
     * Declare or drop the `'playback'` activity on this encrypted rc1 connection.
     *
     * Raising it is rarely needed by hand: a player or visualizer `stream/start` or
     * a source `start` raises it first. Dropping it is the host's call, when the
     * client's group stops (not on a pause or track change, spec main #314): the
     * player and visualizer streams are ended first, as the spec requires, then
     * `server/activate` goes out with the new activities and no `active_roles`
     * (they persist). A no-op on a legacy or plaintext peer and on an idle session.
     */
    setPlaybackActive(active: boolean): void;
    /** Declare `'playback'` ahead of something that needs it (no-op when declared or not allowed). */
    private raisePlayback;
    /**
     * Whether this encrypted session must be held idle, and why.
     *
     * A long-term PSK admits playback outright. Anything else is an unpaired
     * session (pairing.md "Unpaired Access"), which may play only when the client
     * says it admits unpaired access and the operator approved it; offering
     * `'playback'` or roles otherwise just gets a `client/goodbye`
     * `pairing_required`. A session that fell back to the Sentinel carries nothing
     * while this server keeps the credential the client lost (connection.md).
     * This mirrors aiosendspin 10.3's `_playback_capable`. A legacy client that
     * predates the `unpaired_access` field keeps today's admission.
     */
    private pairingRequirement;
    /**
     * Why this encrypted session is held idle (no roles, no `'playback'`), or null
     * when it may play. A host shows it as "pairing required" or "enable unpaired
     * access on the device"; the roles the client offered are in
     * {@link getNegotiatedRoles}.
     */
    getPairingRequired(): SendspinPairingRequiredReason | null;
    /** Whether the handshake fell back to the Sentinel: the client lost the credential we hold. */
    isCredentialMismatch(): boolean;
    /** The roles negotiated from the hello, including those held back on an idle session. */
    getNegotiatedRoles(): RoleName[];
    /** The activities declared in the last `server/activate`; empty when not encrypted. */
    getActivities(): string[];
    sendStreamStart(format?: Partial<PlayerFormat>): void;
    private sendStreamFormat;
    /**
     * Clear buffered data on the client's streams (a seek, a track jump).
     *
     * An rc1 peer is sent it only for roles whose stream is active (rc1: "The server
     * MUST NOT send this message when no targeted streams are active ... Every listed
     * role MUST have an active stream"), with role names reduced to their families,
     * and not at all when nothing is left. So Audioserver's usual `stream/end` followed
     * by `stream/clear` costs nothing on the wire. A legacy peer gets it as before.
     */
    sendStreamClear(roles?: RoleName[]): void;
    /**
     * End the client's streams: the given roles, or all of them when omitted.
     *
     * For an rc1 peer only roles with an active stream are ended, and nothing is
     * sent when none is (rc1 stream/end rules). Note that a role-less end also ends
     * the artwork stream, which clears the device's image; to pause, end only
     * `['player', 'visualizer']` (spec main #346), as {@link endPlaybackStreams} does.
     */
    sendStreamEnd(roles?: RoleName[]): void;
    /**
     * End the `player` and `visualizer` streams and leave `artwork` alone.
     *
     * This is what a pause is (spec main #346: "When a group pauses, the server MUST
     * end the active player and visualizer streams, but not the artwork stream"), so
     * the device keeps showing the cover. Resume with a fresh `stream/start`.
     */
    endPlaybackStreams(): void;
    /** Role families with a server-to-client stream open on this connection. */
    getActiveStreams(): StreamFamily[];
    /** The active stream families a stream/clear or stream/end for `roles` reaches. */
    private activeTargets;
    /**
     * Keep only the roles the given stream message applies to.
     *
     * `stream/clear` reaches roles that hold a buffer, `stream/end` roles that
     * receive a stream; naming any other role makes the payload invalid, so drop
     * the strays rather than have the client reject the whole message. An omitted
     * list means "all applicable roles" and is passed through untouched.
     */
    private filterStreamRoles;
    /**
     * Send one player audio chunk.
     *
     * An rc1 peer reads a 13-byte header whose `send_ahead` (#167) is the time from
     * transmit to `timestamp`, so it is written in {@link sendBinary}, immediately
     * before encryption — on the deferred path too, where stamping at build time
     * would overstate it by the wait. A legacy peer gets the 9-byte header it reads.
     */
    sendPcmAudioFrame(frame: SendspinPcmFrame): void;
    /** Playing time of `bytes` of PCM in the current stream format, or undefined for another codec. */
    private pcmDurationUs;
    /**
     * Bytes of audio the player holds against its `buffer_capacity` right now, under
     * rc1's accounting (#288): each chunk's header and payload, from transmission
     * until its end time minus the output delay, emptied by a player `stream/clear`
     * or `stream/end`. Chunks of a codec other than PCM count only when the caller
     * gave their `durationUs`.
     */
    getPlayerBufferedBytes(): number;
    /**
     * Microseconds until `bytes` more audio fit in the player's buffer: 0 when they
     * fit now, Infinity when they never can, and 0 when the player declared no
     * capacity. A server MUST NOT send a chunk that does not fit (rc1, #288).
     */
    timeUntilPlayerCapacityUs(bytes: number): number;
    sendServerCommand(payload: ServerCommandPayload): void;
    sendServerCommand(command: PlayerCommand, payload?: {
        volume?: number;
        mute?: boolean;
        static_delay_ms?: number;
    }): void;
    /**
     * The source command an rc1 peer may be sent now, or undefined.
     *
     * rc1: the server MUST NOT send `start` unless the source role is active,
     * `'playback'` is declared, the source object of the client's `client/state`
     * has arrived and the latest state reports `available: true`. A `start` asked
     * for earlier is held and sent from {@link flushPendingSourceStart}; a `stop`
     * withdraws a held one.
     */
    private sourceCommandForPeer;
    private sourceStartAllowed;
    /** Send a held source `start` once the client's state allows it. */
    private flushPendingSourceStart;
    /**
     * The player command an rc1 peer may be sent for what the caller asked, or undefined.
     *
     * rc1 (#177) has the server send only commands the player's latest `client/state`
     * lists, and none before that state arrives; the client ignores anything else.
     * The output-delay command is matched to the name the player offers, so a caller
     * sending `set_static_delay` + `static_delay_ms` (the pre-#164 spelling) still
     * reaches a player that offers `set_output_delay`. Values are put in the spec's
     * integer ranges, and fields that do not belong to the command are left out.
     */
    private playerCommandForPeer;
    /**
     * Tell the client about its group.
     *
     * rc1 (#216, #260) has every `group/update` carry all three fields, and only
     * `'playing'` or `'stopped'` as the state; a paused group reports `'stopped'`
     * (spec main #346). So for an rc1 peer `PAUSED` goes out as `'stopped'` (the
     * session still reports it as paused to its host), an omitted id or name is the
     * last one sent, and the name is cut to 64 bytes of UTF-8 (#339). A legacy peer
     * gets the arguments as given.
     */
    sendGroupUpdate(playbackState: PlaybackStateType, groupId?: string, groupName?: string): void;
    /**
     * Push metadata@v1 state via `server/state`.
     *
     * Callers may pass a partial update: a field that is `undefined` (or absent) is
     * left as it was, `null` clears it. What goes on the wire depends on the peer.
     *
     * A legacy (pre-rc1) peer merges each message into what it already has, so it
     * gets the caller's object as given, `null` leaves and `repeat`/`shuffle`
     * included, exactly as before.
     *
     * An rc1 peer replaces its whole metadata object with every message (#175):
     * "Every message MUST carry the full state of each role object it includes",
     * and omitting a field clears it. A progress-only update would therefore wipe
     * the title, artist and album on every pause or seek. So the session keeps the
     * merged state and sends all of it each time, with no `null` (the rc1 fields
     * are not nullable) and no `repeat`/`shuffle`, which moved to the controller
     * object (#81) and are not metadata fields any more.
     */
    sendMetadata(metadata: {
        title?: string | null;
        artist?: string | null;
        album_artist?: string | null;
        album?: string | null;
        artwork_url?: string | null;
        year?: number | null;
        track?: number | null;
        repeat?: RepeatMode | null;
        shuffle?: boolean | null;
        progress?: {
            track_progress: number;
            track_duration: number;
            playback_speed: number;
        } | null;
    }): void;
    /** The metadata the session last sent an rc1 peer, merged across partial updates. */
    getMetadataState(): Record<string, unknown>;
    sendControllerState(controller: ControllerStatePayload): void;
    /**
     * Drop commands this peer's library cannot name.
     *
     * `supported_commands` is a typed enum list on the far side, so one unknown
     * value does not degrade a feature — it invalidates the whole `server/state`
     * and the client goes silent while the server's own log looks healthy. Whoever
     * builds the payload advertises what the *server* can do; deciding what this
     * particular peer can be told belongs here, at the socket that knows it.
     *
     * `seek_max_ms` goes with `seek`: the spec sets it only when seek is offered.
     */
    private withoutBlindCommands;
    /**
     * Push a color@v1 palette via `server/state`. Each field is an `[R, G, B]`
     * tuple, `null` to clear it, or omitted to leave it unchanged. The caller
     * owns diffing and the spec's WCAG contrast invariants; `timestamp` is
     * filled with the current server clock when omitted.
     *
     * As with {@link sendMetadata}, a legacy peer gets the update as given and an
     * rc1 peer the merged full palette with cleared fields left out (#175), so an
     * all-null clear reaches it as a bare `{timestamp}`.
     */
    sendColor(color: Omit<SessionUpdateColor, 'timestamp'> & {
        timestamp?: number;
    }): void;
    /**
     * Start (or re-start) the artwork stream.
     *
     * For a hello-declared (pre-rc1) artwork peer `channels` is sent as given, in
     * full, as it always was. For an rc1 peer each channel of `stream/start` MUST
     * match the client's own `client/state` declaration, so `channels` is not used:
     * the session streams what the client declared, waits for that declaration if
     * it has not arrived yet, and skips a `stream/start` that would change nothing.
     */
    sendArtworkStreamStart(channels: SendspinArtworkChannel[]): void;
    /**
     * Show `imageData` on an artwork channel, or clear it with null.
     *
     * A pre-rc1 artwork peer gets one `[type][timestamp][image]` message (a bare
     * header clears). An rc1 peer gets a transfer (#188): an announce, then parts of
     * at most 65519 bytes each, paced against the socket, with one transfer in flight
     * across all channels; a clear is an announce of size 0. A new image for the
     * channel in flight cancels that transfer first. Nothing goes out for a channel
     * the stream does not carry, or while no artwork stream is active.
     */
    sendArtwork(channel: 0 | 1 | 2 | 3, imageData: Buffer | null): void;
    /** The 4-channel stream configuration an rc1 client's declaration implies. */
    private artworkStreamConfigsFor;
    /** Send an rc1 artwork `stream/start` for the declared channels, if it would change anything. */
    private startArtworkStream;
    /** Cancel the transfer in flight, if any, so the next announce is legal. */
    private cancelArtworkInFlight;
    /** Before an artwork `stream/end`: no transfer may be left in flight, nothing more may follow. */
    private endArtworkStream;
    /** Run queued artwork transfers one at a time until the queue is empty. */
    private pumpArtwork;
    private waitForArtworkDrain;
    /** Announce a legacy `visualizer@_draft_r1` stream (batched DATA blob wire). */
    sendVisualizerStreamStart(config?: Record<string, any>): void;
    /** Send one batched `visualizer@_draft_r1` DATA blob. */
    sendVisualizerFrame(data: Buffer, timestampUs?: number): void;
    /** Normalize a client/hello visualizer@v1 support object. */
    private parseVisualizerSupport;
    /** Visualizer@v1 capabilities the client advertised, or null when not negotiated. */
    getVisualizerSupport(): VisualizerSupport | null;
    /**
     * Announce a visualizer@v1 stream. `types` must be a subset of what the
     * client advertised; the spectrum config is echoed from the client's support.
     */
    sendVisualizerStreamStartV1(config: VisualizerStreamConfig): void;
    private openVisualizerStream;
    /** Send one visualizer@v1 binary frame: `[type:1][ts:8][payload]`. */
    private sendVisualizerV1;
    /** Loudness frame (0-65535). */
    sendVisualizerLoudness(loudness: number, timestampUs?: number): void;
    /** Display-binned spectrum frame: one big-endian u16 per bin. */
    sendVisualizerSpectrum(bins: ArrayLike<number>, timestampUs?: number): void;
    /** Dominant frequency (Hz) + amplitude (0-65535). */
    sendVisualizerFpeak(freqHz: number, amplitude: number, timestampUs?: number): void;
    /** Energy onset event with strength (0-255). */
    sendVisualizerPeak(strength: number, timestampUs?: number): void;
    /** Perceived pitch as MIDI 8.8 fixed-point + confidence (0-255). */
    sendVisualizerPitch(midiQ88: number, confidence: number, timestampUs?: number): void;
    /** Musical beat event. `downbeat` sets the low flag bit. */
    sendVisualizerBeat(downbeat?: boolean, timestampUs?: number): void;
    /**
     * Apply a player format request, but only to a format the client can actually decode.
     *
     * A partial update merged onto the current format, then checked against the
     * `supported_formats` from the client's hello. We honoured the merge unconditionally
     * before, so a client could ask for — and be sent — a rate or depth it never
     * declared, which surfaces at the far end as every packet failing to decode. The
     * reference falls back to the format in force rather than refusing outright, and
     * still re-announces, so the client learns what it is actually getting.
     */
    private applyPlayerFormatRequest;
    /** Whether a fully-resolved format appears in the client's declared `supported_formats`. */
    private isDeclaredFormat;
    /**
     * Apply a visualizer renegotiation and echo the result back.
     *
     * A partial update: omitted fields keep their current value. Requested types are
     * intersected with what the client declared in its hello, since a renegotiation
     * narrows the wire rather than widening what the client can decode.
     */
    private applyVisualizerFormatRequest;
    private applyArtworkFormatRequest;
    private applyPreferredStreamFormat;
    private normalizeCodec;
    /**
     * Normalize a `source@v1_support` object.
     *
     * The spec object carries `features` alone; a source announces its format per
     * stream with `client_stream/start`. `supported_formats` and `controls` are vendor
     * additions, so both are optional and an object without them is valid — rejecting
     * a source for omitting `supported_formats` locked out every conformant client.
     */
    private normalizeSourceSupport;
    private resolveActiveRoles;
    private ensureStreamStarted;
    /**
     * Whether an rc1 `stream/start` for `family` must wait, recording it as pending if so.
     *
     * rc1 messaging.md: the server MUST NOT send `stream/start` unless the latest
     * `client/state` reports `available: true`, and after activating a role it
     * MUST wait for that role's `client/state` object before starting its stream.
     * A held start is sent from {@link flushPendingStarts} once both hold; a role
     * that is not active is simply refused. A legacy peer is never held.
     */
    private holdStreamStart;
    /** Send the stream starts a `client/state` has just allowed. */
    private flushPendingStarts;
    /**
     * Flag a client whose initial `client/state` is late, without dropping it.
     *
     * rc1 sets no deadline, and spec main (#349) has a player or source hold that
     * state until its clock has converged, so a slow first state is legitimate. The
     * reference flags it and lets the client in; closing here turned a slow Wi-Fi
     * sync into a reconnect loop. The state still counts whenever it arrives.
     */
    private startInitialStateTimeout;
    private maybeNotifyIdentified;
    private getDefaultGroupInfo;
    private sendBinary;
    private sendJson;
    /** A cleartext TEXT frame, used only by the Noise bring-up. */
    private sendRawText;
    private closeWith;
}
//# sourceMappingURL=session.d.ts.map