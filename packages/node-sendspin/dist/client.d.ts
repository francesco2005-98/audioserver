import { AudioCodec, ClientHelloArtworkSupport, ClientHelloPayload, ClientHelloPlayerSupport, ClientHelloSourceSupport, ClientHelloVisualizerSupport, ClientStateArtwork, ClientStateArtworkChannel, ClientStateVisualizer, ClientStreamStartSource, GoodbyeReason, GroupUpdateServerPayload, MediaCommand, PlayerCommand, PlayerStatePayload, RoleName, Roles, ServerCommandPayload, ServerStatePayload, StreamStartMessage, SourceClientCommand, SourceCommandPayload, SourceStatePayload, SupportedAudioFormat } from './types.js';
import { PskCategory, type PskResolver } from './noise/handshake.js';
import type { Identity } from './noise/keys.js';
import type { NoiseCipherSuite } from './noise/session.js';
export type MetadataCallback = (payload: ServerStatePayload) => void;
export type GroupUpdateCallback = (payload: GroupUpdateServerPayload) => void;
export type ControllerStateCallback = (payload: ServerStatePayload) => void;
export type StreamStartCallback = (message: StreamStartMessage) => void;
export type StreamEndCallback = (roles: RoleName[] | undefined) => void;
export type StreamClearCallback = (roles: RoleName[] | undefined) => void;
/**
 * One player audio chunk. `sendAheadUs` is how far ahead of `timestampUs` the
 * server transmitted it (rc1's 13-byte header, #167); undefined from a pre-rc1
 * server, whose 9-byte header does not carry it.
 */
export type AudioChunkCallback = (timestampUs: number, audioData: Buffer, format: AudioFormat, sendAheadUs?: number) => void;
export type DisconnectCallback = () => void;
export type ServerCommandCallback = (payload: ServerCommandPayload) => void;
/**
 * A complete artwork image on `channel` (0-3), to show at `timestampUs` (server
 * clock). An empty `image` clears the channel; so does the artwork stream ending.
 */
export type ArtworkCallback = (channel: number, image: Buffer, timestampUs: number) => void;
export type SourceCommandCallback = (payload: SourceCommandPayload) => void;
export declare class PCMFormat {
    readonly sampleRate: number;
    readonly channels: number;
    readonly bitDepth: number;
    constructor(sampleRate: number, channels: number, bitDepth: number);
    get frameSize(): number;
}
export declare class AudioFormat {
    readonly codec: AudioCodec;
    readonly pcm: PCMFormat;
    readonly codecHeader?: Buffer | undefined;
    constructor(codec: AudioCodec, pcm: PCMFormat, codecHeader?: Buffer | undefined);
}
export interface SendspinClientOptions {
    deviceInfo?: ClientHelloPayload['device_info'];
    playerSupport?: ClientHelloPlayerSupport;
    /**
     * Artwork channels as a pre-rc1 hello declares them. An rc1 server gets them in
     * `client/state` instead, derived from these (`media_width`/`media_height` as
     * `width`/`height`; `bmp`, removed in rc1, as `png`) unless `artworkState` is set.
     */
    artworkSupport?: ClientHelloArtworkSupport;
    /** Artwork channels as rc1 `client/state` declares them (#195); a pre-rc1 hello gets them derived. */
    artworkState?: ClientStateArtwork;
    visualizerSupport?: ClientHelloVisualizerSupport;
    /**
     * The visualization wanted, which an rc1 server reads from `client/state` (#195).
     * Left unset, it is taken from `types`/`rate_max`/`spectrum` on
     * `visualizerSupport` if the caller put them there, else nothing is requested.
     * A pre-rc1 server gets these fields in the hello's support object instead.
     */
    visualizerState?: ClientStateVisualizer;
    sourceSupport?: ClientHelloSourceSupport;
    /** @deprecated Pre-rc1 name of {@link outputDelayMs}; used when that is unset. */
    staticDelayMs?: number;
    /**
     * The delay after the audio port (an amplifier, active speakers), 0-5000 ms.
     * Persist it across restarts and pass it back here: the server may change it
     * with `set_output_delay`, which {@link SendspinClient.addOutputDelayListener} reports.
     */
    outputDelayMs?: number;
    /** Startup lead time reported in `client/state` (rc1), in ms. Default 250, as aiosendspin. */
    requiredLeadTimeMs?: number;
    /** Minimum ongoing buffer reported in `client/state` (rc1), in ms, 0-5000. Default 250. */
    minBufferMs?: number;
    /**
     * Player commands to offer in `client/state` (rc1, #177), merged with
     * `playerSupport.supported_commands` (`set_static_delay` there is offered as
     * `set_output_delay`). Leave `set_output_delay` out to keep the server from
     * changing the output delay.
     */
    stateSupportedCommands?: PlayerCommand[];
    /** The format the player prefers, one of `playerSupport.supported_formats` (rc1 `client/state`). */
    preferredFormat?: SupportedAudioFormat;
    initialVolume?: number;
    initialMuted?: boolean;
    /** Speak the encrypted path. Omit for a transition-mode (unencrypted) connection. */
    encryption?: SendspinClientEncryption;
}
export interface ServerInfo {
    serverId: string;
    name: string;
    version: number;
}
/**
 * Speak the encrypted path.
 *
 * `identity` is this client's long-term keypair; its public half becomes the
 * `client_id` the server authenticates, so persist it — a new one each run is a new
 * client, and any zone bound to the old id stops matching.
 *
 * `expectedServerId` is what turns encryption into authentication. Leave it unset
 * and the connection is confidential against a passive listener but open to an
 * active man-in-the-middle, since the statics are only what this connection
 * claimed. Set it to the id you stored when you last paired.
 *
 * `pskResolver` defaults to recognising the Sentinel PSK alone, i.e. unpaired
 * access.
 */
export interface SendspinClientEncryption {
    identity: Identity;
    suite?: NoiseCipherSuite;
    pskResolver?: PskResolver;
    expectedServerId?: string;
}
export declare class SendspinClient {
    private readonly clientId;
    private readonly clientName;
    private readonly roles;
    private readonly deviceInfo?;
    private readonly playerSupport?;
    private readonly artworkSupport?;
    /** The artwork channels this client wants, as rc1 `client/state` carries them. */
    private artworkChannels;
    private artworkStreamActive;
    /** Images being received, by channel (rc1 announce/part transfers). */
    private artworkPending;
    /** The channel whose transfer is in flight; only one may be, across channels. */
    private artworkInFlight;
    /** Channels currently showing an image, which a stream end clears. */
    private artworkShown;
    private artworkCallbacks;
    private readonly visualizerSupport?;
    private visualizerState?;
    private visualizerStreamActive;
    /** The source object rc1 `client/state` carries while the source role is active. */
    private sourceState;
    private sourceStreamActive;
    private readonly sourceSupport?;
    private ws?;
    private connected;
    private serverInfo?;
    private serverHelloResolve?;
    /** Noise transport once the handshake is up; null on an unencrypted connection. */
    private transport;
    private readonly encryption?;
    private authenticatedServerId?;
    private pskCategory?;
    /**
     * The server speaks the wire from before 1.0.0-rc1. Always so on an unencrypted
     * (transition-mode) connection, which every server answers as a legacy peer;
     * under encryption, decided by the handshake (see {@link serverPredatesRc1}).
     */
    private legacyWire;
    /** Roles the server activated: `active_roles` of `server/activate`, or of the legacy `server/hello`. */
    private activeRoles;
    /** Activities of the latest `server/activate`; empty before one, and on a legacy connection. */
    private activities;
    /** The first activation arrived, so role messages may go out. */
    private activated;
    private activationResolve?;
    /** The initial `client/state` went out, so later activations re-send it in full. */
    private initialStateSent;
    private timeFilter;
    private streamActive;
    private currentAudioFormat?;
    private currentPlayer?;
    private outputDelayUs;
    private initialVolume;
    private initialMuted;
    /** The player state this client reports; rc1 sends all of it every time (#175). */
    private playerState;
    private requiredLeadTimeMs;
    private minBufferMs;
    private stateSupportedCommands;
    private preferredFormat?;
    /** Whether this client is available for playback (`client/state.available`). */
    private available;
    /** The player commands of the latest `client/state` sent; a server may send only these (rc1). */
    private reportedPlayerCommands;
    private readerClosed;
    private timeSyncTimer;
    /** The `client/time` exchange awaiting its reply; one at a time, as bursts send them. */
    private pendingTimeExchange;
    private timeSyncResolve?;
    private metadataCallbacks;
    private groupCallbacks;
    private controllerCallbacks;
    private streamStartCallbacks;
    private streamEndCallbacks;
    private streamClearCallbacks;
    private audioChunkCallbacks;
    private disconnectCallbacks;
    private serverCommandCallbacks;
    private sourceCommandCallbacks;
    private outputDelayCallbacks;
    constructor(clientId: string, clientName: string, roles: Roles[], options?: SendspinClientOptions);
    get info(): ServerInfo | undefined;
    get isConnected(): boolean;
    /** @deprecated Pre-rc1 name of {@link outputDelayMs}. */
    get staticDelayMs(): number;
    /** @deprecated Pre-rc1 name of {@link setOutputDelayMs}. */
    setStaticDelayMs(delayMs: number): void;
    /** The output delay, in ms: delay after the audio port that playback is moved earlier by. */
    get outputDelayMs(): number;
    /**
     * Set the output delay, clamped to 0-5000 ms as the spec requires. Takes effect
     * for scheduling at once; report it with {@link sendPlayerState} (a server's
     * `set_output_delay` is applied and reported by the client itself).
     */
    setOutputDelayMs(delayMs: number): void;
    /** Called whenever the output delay changes, including by a server's `set_output_delay`; persist it. */
    addOutputDelayListener(callback: (outputDelayMs: number) => void): () => void;
    connect(url: string, { timeoutMs }?: {
        timeoutMs?: number;
    }): Promise<void>;
    /**
     * Say goodbye and close. `reason` tells the server whether to come back:
     * `another_server`, `shutdown` and `user_request` say not to, `restart` to
     * expect us again.
     */
    goodbye(reason: GoodbyeReason): Promise<void>;
    /** Roles the server activated on this connection (versioned ids). */
    getActiveRoles(): string[];
    /** Activities the server declared in its latest `server/activate`. */
    getActivities(): string[];
    /** Whether the server activated any version of role `family` (`'player'`, `'artwork'`…). */
    isRoleActive(family: string): boolean;
    disconnect(): Promise<void>;
    /**
     * The first `client/state` after activation.
     *
     * On an rc1 connection it carries every active role's full object (just
     * `available` when no role has one), and goes out once anything was activated.
     * A pre-rc1 connection gets the initial player state the pre-rc1 spec asked for:
     * volume and mute, `static_delay_ms`, `required_lead_time_ms` and
     * `min_buffer_ms`, and `supported_commands` (`set_static_delay` alone, the only
     * state-level command then), with both availability spellings.
     */
    private sendInitialState;
    /**
     * Report player state.
     *
     * The fields given are merged into what this client reports: `volume`, `muted`,
     * `output_delay_ms` (or the old `static_delay_ms`), `required_lead_time_ms`,
     * `min_buffer_ms`, `supported_commands`, `format`, and the old `state` enum as
     * availability. An rc1 server then gets the full player object, as #175
     * requires of every message; a pre-rc1 one gets the fields given, as before.
     */
    sendPlayerState(state: PlayerStatePayload): Promise<void>;
    /**
     * Change the artwork channels this client wants (rc1 `client/state`, #195). The
     * server answers with a new artwork `stream/start` when its configuration
     * changes. A pre-rc1 server cannot be told after the hello.
     */
    setArtworkChannels(channels: ClientStateArtworkChannel[]): Promise<void>;
    /**
     * Change the visualization wanted (rc1 `client/state`, #195). The server
     * answers with a new visualizer `stream/start` when the stream configuration
     * changes. A pre-rc1 server cannot be told after the hello.
     */
    setVisualizerState(state: ClientStateVisualizer): Promise<void>;
    /** Report availability: `false` while something else uses the output (an HDMI input, local playback). */
    sendAvailable(available: boolean): Promise<void>;
    /** The rc1 player object: every field, every time. */
    private fullPlayerState;
    /** An rc1 `client/state`: availability and the full object of each active role that has one. */
    private buildFullState;
    private sendFullState;
    /**
     * The state-level player commands of the pre-rc1 wire: `set_static_delay`, if
     * the delay command is offered. Pre-rc1 servers refuse a state naming any other
     * (aiosendspin 9 validates the list), and take volume and mute from the hello.
     */
    private legacyStateCommands;
    /** A pre-rc1 `client/state`, exactly as this client always sent it. */
    private sendLegacyPlayerState;
    /**
     * Report source state.
     *
     * On an rc1 connection the source object is `{signal, level?}` (the old `state`
     * is dropped), held and carried in every `client/state` while the source role
     * is active, with `available`; the server may take a change of `signal` as its
     * cue to send `start` or `stop`. A pre-rc1 server gets the object as given.
     */
    sendSourceState(state: SourceStatePayload): Promise<void>;
    /**
     * Open the source stream: announce the format of the source audio about to be
     * sent with {@link sendSourceAudioChunk}. Send it after the server's source
     * `start` command (rc1 roles/source/v1.md). `client-stream/start` since rc1
     * (#163); a pre-rc1 server gets `client_stream/start`.
     */
    sendClientStreamStart(source: ClientStreamStartSource): Promise<void>;
    /** Close the source stream (`client-stream/end`; `client_stream/end` to a pre-rc1 server). */
    sendClientStreamEnd(): Promise<void>;
    /**
     * Leave the current group, e.g. for interruptible local playback, staying
     * available (`client/leave`, rc1 #209). The server moves this client to a solo,
     * stopped group, back only through a `switch`. A pre-rc1 server has no such
     * message; it gets the availability flap that meant the same thing there.
     */
    sendLeave(): Promise<void>;
    /** Whether a source stream is open (between client-stream start and end). */
    get isSourceStreamActive(): boolean;
    sendGroupCommand(command: MediaCommand, opts?: {
        volume?: number;
        mute?: boolean;
    }): Promise<void>;
    sendSourceCommand(command: SourceClientCommand): Promise<void>;
    sendSourceAudioChunk(audioData: Buffer, opts?: {
        captureTimestampUs?: number;
        serverTimestampUs?: number;
    }): Promise<void>;
    addMetadataListener(callback: MetadataCallback): () => void;
    addGroupUpdateListener(callback: GroupUpdateCallback): () => void;
    addControllerStateListener(callback: ControllerStateCallback): () => void;
    addStreamStartListener(callback: StreamStartCallback): () => void;
    addStreamEndListener(callback: StreamEndCallback): () => void;
    addStreamClearListener(callback: StreamClearCallback): () => void;
    addAudioChunkListener(callback: AudioChunkCallback): () => void;
    /** Artwork images as they complete; see {@link ArtworkCallback}. */
    addArtworkListener(callback: ArtworkCallback): () => void;
    addDisconnectListener(callback: DisconnectCallback): () => void;
    addServerCommandListener(callback: ServerCommandCallback): () => void;
    addSourceCommandListener(callback: SourceCommandCallback): () => void;
    isTimeSynchronized(): boolean;
    /**
     * When to submit a frame to the audio device, on this client's own clock.
     *
     * `staticDelayUs` is **subtracted**, which is the opposite of what the name suggests and is what
     * the spec requires: "Clients must translate this server timestamp to their local clock using the
     * offset computed from clock synchronization, subtracting their `static_delay_ms` from the
     * timestamp." The value is not an offset that moves playback later — it describes delay that
     * happens *after* the audio port (an amplifier, an active speaker), so playing that much earlier
     * is what makes the sound land on the timestamp.
     *
     * This used to add it, so a positive value played *late* by twice the intended amount relative to
     * a compliant peer: setting 200 ms to bring a lagging room forward pushed it 200 ms further back
     * instead, and two clients built on different libraries moved in opposite directions on the same
     * `set_static_delay`. Verified against the spec (roles/player/v1 timing rules) and against
     * aiosendspin, which subtracts here and adds in `computeServerTime`.
     */
    computePlayTime(serverTimestampUs: number): number;
    /** The inverse of computePlayTime: add the static delay back before converting to server time. */
    computeServerTime(clientTimestampUs: number): number;
    computeSourceTimestamp(captureTimestampUs: number): number;
    /**
     * Run the cleartext init exchange and the KKpsk2 handshake, then switch to
     * transport mode.
     *
     * Driven with its own frame listener rather than through the normal dispatch: the
     * bring-up frames are cleartext and strictly ordered, and mixing them into the
     * application router would mean teaching that router about states it never sees
     * again once the handshake is done.
     */
    private runNoiseHandshake;
    /**
     * Whether the server predates 1.0.0-rc1.
     *
     * rc1 requires message 1 to name its PSK's `psk_category`, and every server
     * that speaks the rc1 wire does (aiosendspin 10.x, node-sendspin after 0.6);
     * one that leaves it out is node-sendspin 0.6 or earlier, which reads the
     * hello's `supported_commands` and `artwork@v1_support`, sends 9-byte audio
     * headers and single-message artwork, and fragments with IDs 2/3.
     */
    private serverPredatesRc1;
    /**
     * Whether this connection speaks the pre-rc1 wire: always when unencrypted,
     * and under encryption when the server predates 1.0.0-rc1. Settled once the
     * handshake completes.
     */
    isLegacyWire(): boolean;
    /** Whether this connection carries its application messages under Noise. */
    get isEncrypted(): boolean;
    /** The server's authenticated `server_id`, or undefined on an unencrypted connection. */
    get encryptedServerId(): string | undefined;
    /**
     * How this connection was admitted. `SENTINEL` means the published constant PSK
     * did it: confidential, but authenticating nothing.
     */
    get admittedWith(): PskCategory | undefined;
    /** Resolves true once the first `server/activate` has been applied, false on timeout. */
    private waitForActivation;
    private waitForServerHello;
    private sendClientHello;
    /**
     * The `client/hello` for this connection.
     *
     * An rc1 server gets the rc1 hello: no `client_id`/`version` (the handshake
     * settled both), `supported_pair_methods` offering `pairing_psk` (required, #179),
     * the player support object without `supported_commands` (#177: they live in
     * `client/state`), the visualizer support object with only `buffer_capacity` and
     * no `artwork@v1_support` (#195: both configurations live in `client/state`).
     * Any of those keys would also mark us as a pre-rc1 client, and the server would
     * answer with the old wire. A pre-rc1 server gets the hello it always got.
     */
    private buildClientHello;
    /** A pre-rc1 hello carries the visualizer config in its support object; add `visualizerState` there. */
    private legacyVisualizerSupport;
    /** The hello artwork object for a pre-rc1 server: as given, or derived from `artworkState`. */
    private legacyArtworkSupport;
    /** One `client/time` exchange: the measurement of its reply, or null if none came in time. */
    private timeExchange;
    /**
     * One burst (messaging.md "Clock Synchronization", spec main): at least 8
     * `client/time` messages, each sent once the previous reply arrived, and only
     * the measurement with the lowest `max_error` goes into the filter. A burst a
     * server stops answering ends early with what it has.
     */
    private runTimeBurst;
    /** Resolves true once the time filter has converged, false on timeout. */
    private waitForTimeSync;
    private sendMessage;
    private sendBinary;
    /**
     * Route one frame from the socket.
     *
     * `isBinary` is the only reliable way to tell a text frame from a binary one: `ws`
     * hands both to the listener as a Buffer, so the `typeof data === 'string'` test
     * this used was never true and every JSON message on an unencrypted connection was
     * fed to the audio-chunk path instead. It went unnoticed because the app drives the
     * server half, and the encrypted path reads its frames elsewhere.
     */
    private handleWsMessage;
    /** Decrypt one transport frame and route it as if it had arrived in the clear. */
    private handleEncryptedFrame;
    private handleJsonMessage;
    private handleBinaryMessage;
    /**
     * One artwork message on `channel`.
     *
     * rc1 (roles/artwork/v1.md, #188): a 14-byte announce `[type][0x02][timestamp
     * int64][total_size uint32]`, parts `[type][0x00][data]`, and a 2-byte cancel
     * `[type][0x01]`; one transfer in flight across all channels. A malformed message
     * or sequence is a protocol error and closes the connection, checked even
     * before the stream is active, as the spec requires. A pre-rc1 server sends the
     * whole image in one `[type][timestamp int64][image]` message, empty to clear.
     */
    private handleArtworkMessage;
    private discardPendingArtwork;
    private showArtwork;
    /** The server broke the protocol: the spec has the client close the connection. */
    private closeOnProtocolError;
    /**
     * Apply a `server/activate` (rc1 messaging.md), or reject it.
     *
     * The activities must be a set the matched PSK allows: `['playback']` at most
     * under a long-term PSK, `'playback'` and `'pairing'` under the Sentinel since
     * this client always enables unpaired access; and roles only on a connection
     * that could carry playback. An inadmissible one, or one naming an activity we
     * do not know, ends the connection with `client/goodbye` `unauthorized`.
     * `active_roles` persists when omitted. Streams of removed roles end here, and
     * a later activation that adds roles re-sends the full state for them.
     */
    private handleServerActivate;
    /** A `server/activate` removed roles: their streams end as if by `stream/end`. */
    private endRemovedRoleStreams;
    private handleServerHello;
    /**
     * A `server/time` reply, taken with the time its frame arrived (spec main #298,
     * "Receive timestamps": at transport arrival, before decryption). Only the reply
     * to the exchange in flight counts; the burst decides what the filter gets.
     */
    private handleServerTime;
    /**
     * A `stream/start` starts a stream or reconfigures a running one. Listeners
     * hear every one that carries an artwork or visualizer object (the new
     * configuration is the only place a reconfiguration shows) and every one that
     * starts the player stream; a player-only format update stays internal, as it
     * always has.
     */
    private handleStreamStart;
    private handleStreamClear;
    private handleStreamEnd;
    /** End the streams of `families` (every stream when undefined). */
    private endStreams;
    private handleGroupUpdate;
    private handleServerState;
    private handleServerCommand;
    private configureAudioOutput;
    private handleAudioChunk;
    private notifyStreamStart;
    private notifyStreamEnd;
    private notifyStreamClear;
    private notifyDisconnect;
    private scheduleTimeSync;
    private stopTimeSync;
    /** Time between bursts: back to back until the filter converges, then by its error, never over 10 s. */
    private computeTimeSyncInterval;
    private nowUs;
    private cleanup;
}
//# sourceMappingURL=client.d.ts.map