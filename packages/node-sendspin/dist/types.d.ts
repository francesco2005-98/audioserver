/**
 * Core Sendspin protocol enums and message payload types.
 * These mirror the reference `aiosendspin` Python library but are expressed
 * as TypeScript interfaces so they can be used directly with JSON.
 */
export declare enum Roles {
    PLAYER = "player@v1",
    CONTROLLER = "controller@v1",
    METADATA = "metadata@v1",
    ARTWORK = "artwork@v1",
    /**
     * Current spec revision of the visualizer role. Per-type binary frames
     * (loudness/f_peak/spectrum/beat/peak/pitch, message types 16-21), and the
     * only visualizer wire a current client advertises.
     */
    VISUALIZER = "visualizer@v1",
    /** @deprecated Alias of {@link Roles.VISUALIZER}, kept for callers on the old name. */
    VISUALIZER_V1 = "visualizer@v1",
    /**
     * Legacy visualizer wire: one batched DATA blob per frame at message type 16,
     * and `batch_max` where v1 has `rate_max`. The reference server excludes it
     * from negotiation in strict mode; kept here for esphome.
     */
    VISUALIZER_DRAFT_R1 = "visualizer@_draft_r1",
    /**
     * Outbound-only role: the server pushes a color palette derived from the
     * current artwork via `server/state`. No client/hello support object is
     * required — clients simply list `color@v1` in `supported_roles`.
     */
    COLOR = "color@v1",
    /**
     * Captures audio from a local input and streams it to the server, which does
     * the resampling and distribution. Spec since aiosendspin 8.0.0; the format is
     * announced with `client_stream/start`, not in the hello support object.
     */
    SOURCE = "source@v1"
}
export type RoleName = Roles | string;
export declare enum BinaryMessageType {
    AUDIO_CHUNK = 4,
    ARTWORK_CHANNEL_0 = 8,
    ARTWORK_CHANNEL_1 = 9,
    ARTWORK_CHANNEL_2 = 10,
    ARTWORK_CHANNEL_3 = 11,
    /** One encoded audio frame captured by a source client (Source role, slot 0). */
    SOURCE_AUDIO_CHUNK = 12,
    /**
     * Slot 16 is shared: the legacy `visualizer@_draft_r1` wire sends a batched
     * DATA blob here, while `visualizer@v1` sends a single loudness frame. The
     * negotiated role selects the framing, so both names map to byte 16.
     */
    VISUALIZATION_DATA = 16,
    VISUALIZATION_LOUDNESS = 16,
    VISUALIZATION_BEAT = 17,
    VISUALIZATION_F_PEAK = 18,
    VISUALIZATION_SPECTRUM = 19,
    VISUALIZATION_PEAK = 20,
    VISUALIZATION_PITCH = 21
}
export declare enum RepeatMode {
    OFF = "off",
    ONE = "one",
    ALL = "all"
}
export declare enum ClientStateType {
    SYNCHRONIZED = "synchronized",
    ERROR = "error",
    EXTERNAL_SOURCE = "external_source"
}
export declare enum SourceStateType {
    IDLE = "idle",
    STREAMING = "streaming",
    ERROR = "error"
}
export declare enum SourceSignalType {
    UNKNOWN = "unknown",
    PRESENT = "present",
    ABSENT = "absent"
}
export declare enum PlaybackStateType {
    PLAYING = "playing",
    PAUSED = "paused",
    STOPPED = "stopped"
}
export declare enum AudioCodec {
    OPUS = "opus",
    FLAC = "flac",
    PCM = "pcm"
}
export declare enum PlayerCommand {
    VOLUME = "volume",
    MUTE = "mute",
    /** @deprecated Pre-rc1 name of {@link SET_OUTPUT_DELAY}; still accepted from callers and sent to legacy peers. */
    SET_STATIC_DELAY = "set_static_delay",
    /** Set the player's output delay (1.0.0-rc1, #164); carries `output_delay_ms`. */
    SET_OUTPUT_DELAY = "set_output_delay"
}
export declare enum MediaCommand {
    PLAY = "play",
    PAUSE = "pause",
    STOP = "stop",
    NEXT = "next",
    PREVIOUS = "previous",
    VOLUME = "volume",
    MUTE = "mute",
    REPEAT_OFF = "repeat_off",
    REPEAT_ONE = "repeat_one",
    REPEAT_ALL = "repeat_all",
    SHUFFLE = "shuffle",
    UNSHUFFLE = "unshuffle",
    SWITCH = "switch",
    /** Absolute seek. Carries `position_ms`; only offered when `seek_max_ms` is set. */
    SEEK = "seek",
    /** Relative seek. Carries a signed `offset_ms`. */
    SEEK_RELATIVE = "seek_relative"
}
export declare enum SourceCommand {
    START = "start",
    STOP = "stop"
}
export declare enum SourceControl {
    PLAY = "play",
    PAUSE = "pause",
    NEXT = "next",
    PREVIOUS = "previous",
    ACTIVATE = "activate",
    DEACTIVATE = "deactivate"
}
export declare enum SourceClientCommand {
    STARTED = "started",
    STOPPED = "stopped"
}
export declare enum PictureFormat {
    /** @deprecated Removed in 1.0.0-rc1 (#168); only a legacy (hello-declared) artwork peer may use it. */
    BMP = "bmp",
    JPEG = "jpeg",
    PNG = "png"
}
export declare enum ArtworkSource {
    ALBUM = "album",
    ARTIST = "artist",
    NONE = "none"
}
export declare enum ConnectionReason {
    DISCOVERY = "discovery",
    PLAYBACK = "playback"
}
export declare enum GoodbyeReason {
    ANOTHER_SERVER = "another_server",
    SHUTDOWN = "shutdown",
    RESTART = "restart",
    USER_REQUEST = "user_request",
    /** The server asked for an activity this client's trust level does not permit. */
    UNAUTHORIZED = "unauthorized",
    /** The server asked for playback, but this client requires pairing first. */
    PAIRING_REQUIRED = "pairing_required",
    /** Rejected because another connection is already admitted. */
    CONCURRENT_ATTEMPT = "concurrent_attempt",
    /** The client processed `server/unpair` from this server. */
    UNPAIRED = "unpaired"
}
/**
 * Reasons a reconnect is pointless: the client is telling us it will not accept
 * this server as it stands, so retrying just produces the same refusal. `RESTART`
 * is deliberately absent — a restarting client is expected back.
 */
export declare const TERMINAL_GOODBYE_REASONS: readonly GoodbyeReason[];
/**
 * Trust a client extends to this server, as declared in `client/hello`. It is the
 * client's judgement of us, not ours of it, and governs which management
 * operations we may ask for. `none` is the honest answer on any unpaired
 * connection, which is every connection until a pairing exchange has happened.
 */
export declare enum TrustLevel {
    NONE = "none",
    USER = "user"
}
export type UndefinedField = typeof UNDEFINED_FIELD;
export declare const UNDEFINED_FIELD: unique symbol;
export declare const undefinedField: () => UndefinedField;
export declare const isUndefinedField: (value: unknown) => value is UndefinedField;
export interface DeviceInfo {
    product_name?: string | null;
    manufacturer?: string | null;
    software_version?: string | null;
}
export interface SupportedAudioFormat {
    codec: AudioCodec;
    channels: number;
    sample_rate: number;
    bit_depth: number;
}
export interface ClientHelloPlayerSupport {
    supported_formats: SupportedAudioFormat[];
    buffer_capacity: number;
    supported_commands: PlayerCommand[];
}
export interface SourceFormat {
    codec: AudioCodec;
    channels: number;
    sample_rate: number;
    bit_depth: number;
}
export interface SourceFeatures {
    level?: boolean;
    line_sense?: boolean;
}
/**
 * `source@v1_support` from client/hello.
 *
 * The spec object is `features` alone — the stream format is announced per stream
 * with `client_stream/start`, not up front. `supported_formats` and `controls` are
 * vendor additions this server still accepts (and the line-in path still uses when
 * a client offers them), so they are optional: a spec-conformant source sends
 * neither and must not be rejected for it.
 */
export interface ClientHelloSourceSupport {
    supported_formats?: SourceFormat[];
    controls?: SourceControl[];
    features?: SourceFeatures;
}
export interface SourceVadSettings {
    threshold_db?: number;
    hold_ms?: number;
}
export interface SourceCommandPayload {
    command?: SourceCommand;
    control?: SourceControl;
    vad?: SourceVadSettings;
}
export interface SourceClientCommandPayload {
    command: SourceClientCommand;
}
/** `source` object in `client_stream/start`: the format the source is about to send. */
export interface ClientStreamStartSource {
    codec: AudioCodec;
    channels: number;
    sample_rate: number;
    bit_depth: number;
    /** Standard Base64 codec header, when the codec needs one. */
    codec_header?: string | null;
}
export interface ClientStreamStartPayload {
    source: ClientStreamStartSource;
}
/** Client -> Server: a source client announces its active input stream format. */
export interface ClientStreamStartMessage {
    /** `client-stream/start` since 1.0.0-rc1 (#163); the underscore spelling is what older sources send. */
    type: 'client-stream/start' | 'client_stream/start';
    payload: ClientStreamStartPayload;
}
/** Client -> Server: a source client ends its input stream. Payload-less per spec. */
export interface ClientStreamEndMessage {
    /** `client-stream/end` since 1.0.0-rc1 (#163); the underscore spelling is what older sources send. */
    type: 'client-stream/end' | 'client_stream/end';
    payload?: Record<string, never>;
}
export interface ArtworkChannel {
    source: ArtworkSource;
    format: PictureFormat;
    media_width: number;
    media_height: number;
}
export interface ClientHelloArtworkSupport {
    channels: ArtworkChannel[];
}
export interface ClientHelloVisualizerSupport {
    buffer_capacity: number;
}
export interface StreamArtworkChannelConfig {
    source: ArtworkSource;
    format: PictureFormat;
    width: number;
    height: number;
}
export interface StreamStartArtwork {
    channels: StreamArtworkChannelConfig[];
}
export interface StreamRequestFormatArtwork {
    channel: number;
    source?: ArtworkSource;
    format?: PictureFormat;
    media_width?: number;
    media_height?: number;
}
export interface StreamStartVisualizer {
}
export interface Progress {
    track_progress: number;
    track_duration: number;
    playback_speed: number;
}
export interface SessionUpdateMetadata {
    timestamp: number;
    title?: string | null | UndefinedField;
    artist?: string | null | UndefinedField;
    album_artist?: string | null | UndefinedField;
    album?: string | null | UndefinedField;
    artwork_url?: string | null | UndefinedField;
    year?: number | null | UndefinedField;
    track?: number | null | UndefinedField;
    progress?: Progress | null | UndefinedField;
    repeat?: RepeatMode | null | UndefinedField;
    shuffle?: boolean | null | UndefinedField;
}
export interface ControllerCommandPayload {
    command: MediaCommand;
    volume?: number;
    mute?: boolean;
    /** Absolute position in ms. Set only when `command` is `seek`. */
    position_ms?: number;
    /** Signed offset in ms from the current position. Set only when `command` is `seek_relative`. */
    offset_ms?: number;
}
export interface ControllerStatePayload {
    supported_commands: MediaCommand[];
    volume: number;
    muted: boolean;
    /**
     * Repeat mode of the group. Required by the spec since it moved out of the
     * metadata object; a client that has to guess it renders a stale button.
     */
    repeat: RepeatMode;
    /** Shuffle state of the group. Required alongside {@link repeat}. */
    shuffle: boolean;
    /**
     * Highest absolute position (ms) a `seek` may target. Set only when `seek` is in
     * `supported_commands`, and omitted for a stream with no seekable extent.
     */
    seek_max_ms?: number;
    sources?: Array<{
        id: string;
        name: string;
        state: SourceStateType;
        signal?: SourceSignalType | null;
        selected?: boolean | null;
        last_event?: SourceClientCommand | null;
        last_event_ts_us?: number | null;
    }>;
}
/** A pairing method a client offers in `client/hello`. */
export interface PairMethodDescriptor {
    method: string;
    channels?: string[];
    min_pin_length?: number;
    locations?: string[];
}
/**
 * `supported_pair_methods` as 1.0.0-rc1 has it (#179): an object keyed by method,
 * each value a descriptor. Every rc1 client offers at least `pairing_psk`.
 */
export interface SupportedPairMethods {
    pairing_psk?: PairMethodDescriptorObject;
    static_pairing_code?: PairMethodDescriptorObject;
    dynamic_pairing_code?: PairMethodDescriptorObject & {
        out_channels?: string[];
        formats?: string[];
    };
    [method: string]: PairMethodDescriptorObject | undefined;
}
/** A pair-method descriptor in the rc1 object form; `{}` says nothing beyond the offer. */
export interface PairMethodDescriptorObject {
    locations?: string[];
    [key: string]: unknown;
}
export interface UnpairedAccess {
    enabled: boolean;
}
export interface ClientHelloPayload {
    client_id: string;
    name: string;
    version: number;
    supported_roles: RoleName[];
    device_info?: DeviceInfo;
    /** The client's own trust judgement of this server. Defaults to `none` when absent. */
    trust_level?: TrustLevel;
    /**
     * Pairing methods the client offers: the rc1 object keyed by method, or the
     * superseded list a pre-rc1 client sends.
     */
    supported_pair_methods?: SupportedPairMethods | PairMethodDescriptor[];
    /** Whether the client currently admits playback without pairing. */
    unpaired_access?: UnpairedAccess;
    ['player@v1_support']?: ClientHelloPlayerSupport;
    ['artwork@v1_support']?: ClientHelloArtworkSupport;
    /** Support object for the current `visualizer@v1` role. */
    ['visualizer@v1_support']?: ClientHelloVisualizerSupport;
    /** Support object for the legacy `visualizer@_draft_r1` wire. */
    ['visualizer@_draft_r1_support']?: ClientHelloVisualizerSupport;
    ['source@v1_support']?: ClientHelloSourceSupport;
}
export interface ClientHelloMessage {
    type: 'client/hello';
    payload: ClientHelloPayload;
}
export interface ClientTimePayload {
    client_transmitted: number;
}
export interface ClientTimeMessage {
    type: 'client/time';
    payload: ClientTimePayload;
}
export interface PlayerStatePayload {
    state?: ClientStateType;
    volume?: number;
    muted?: boolean;
    /**
     * Static delay in milliseconds (0-5000). REQUIRED for players in the initial state message.
     *
     * The delay the client's own chain adds *after* its audio port — an amplifier, an active speaker.
     * The client subtracts it from every timestamp, so a server must add it to how far ahead it sends
     * or the setting is paid for out of the buffer instead (spec: "Servers factor in each client's
     * static_delay_ms when calculating how far ahead to send audio, keeping effective buffer headroom
     * constant"). The client owns and persists this value; `set_static_delay` only asks.
     */
    static_delay_ms?: number;
    /**
     * Minimum startup lead time in milliseconds (0-30000). REQUIRED for players initially.
     *
     * Codec init, decode warmup, backend buffering, DAC latency — measured from the server transmit
     * time of the start trigger to the playback timestamp of the first chunk that can play in full.
     * A hint: the server MAY give less. Excludes `static_delay_ms`.
     */
    required_lead_time_ms?: number;
    /**
     * Requested minimum ongoing buffer during playback, in milliseconds (0-30000). REQUIRED initially.
     *
     * Absorbs network jitter and decode variance, mainly for live streams. Excludes
     * `static_delay_ms`.
     */
    min_buffer_ms?: number;
    /**
     * Output delay in milliseconds (0-5000), 1.0.0-rc1's name for {@link static_delay_ms} (#164).
     * Required in every rc1 player object. The server reads it in preference to the old key.
     */
    output_delay_ms?: number;
    /**
     * Which player commands the server may send (#177: moved here from the hello). rc1 lists
     * 'volume', 'mute' and 'set_output_delay'; an empty list means none.
     */
    supported_commands?: PlayerCommand[];
    /** The format the player currently prefers, one of its `supported_formats` (1.0.0-rc1, #195). */
    format?: SupportedAudioFormat;
}
export interface SourceStatePayload {
    /** Pre-rc1 only: rc1 sources report just `signal` (and spec main #335 makes it required). */
    state?: SourceStateType;
    level?: number;
    signal?: SourceSignalType;
}
export interface ClientStatePayload {
    /**
     * Whether the client is available to take part in playback.
     *
     * `false` says its output is in use by something else — an HDMI input, a local
     * app — so no audio should be scheduled there. Supersedes {@link state}, which
     * could only express the same thing and nothing more. Prefer this field; fall
     * back to `state !== 'external_source'` for a client that only sends the enum.
     */
    available?: boolean;
    /** @deprecated Superseded by {@link available}. Still read as a fallback. */
    state?: ClientStateType;
    player?: PlayerStatePayload;
    source?: SourceStatePayload;
    /** The artwork channels the client wants (1.0.0-rc1, #195); replaces the hello support object. */
    artwork?: ClientStateArtwork;
    /** The visualization the client wants (1.0.0-rc1, #195); replaces the hello's types/rate_max/spectrum. */
    visualizer?: ClientStateVisualizer;
}
/** `client/state` visualizer object. `spectrum` is required when `types` includes `spectrum`. */
export interface ClientStateVisualizer {
    types: VisualizerType[];
    /** Positive: frames per second per periodic type. */
    rate_max: number;
    spectrum?: VisualizerSpectrumConfig;
}
/** One channel of a `client/state` artwork object. `format`/`width`/`height` are required unless `source` is `none`. */
export interface ClientStateArtworkChannel {
    source: ArtworkSource | 'album' | 'artist' | 'none';
    format?: 'jpeg' | 'png';
    width?: number;
    height?: number;
}
/** `client/state` artwork object: 1-4 channels, positional; an uncovered index is `source: none`. */
export interface ClientStateArtwork {
    channels: ClientStateArtworkChannel[];
}
export interface ClientStateMessage {
    type: 'client/state';
    payload: ClientStatePayload;
}
export interface ClientCommandPayload {
    controller?: ControllerCommandPayload;
    source?: SourceClientCommandPayload;
}
export interface ClientCommandMessage {
    type: 'client/command';
    payload: ClientCommandPayload;
}
/** Client -> Server (1.0.0-rc1, #209): leave the current group. No payload fields. */
export interface ClientLeaveMessage {
    type: 'client/leave';
    payload: Record<string, never>;
}
export interface ClientGoodbyePayload {
    reason: GoodbyeReason;
}
export interface ClientGoodbyeMessage {
    type: 'client/goodbye';
    payload: ClientGoodbyePayload;
}
export interface StreamRequestFormatPayload {
    player?: StreamRequestFormatPlayer;
    artwork?: StreamRequestFormatArtwork;
    visualizer?: StreamRequestFormatVisualizer;
}
/**
 * Visualizer renegotiation. Every field is optional and an omitted one keeps its
 * current value, so a request that only lowers `buffer_capacity` leaves the
 * negotiated types and rate alone.
 */
export interface StreamRequestFormatVisualizer {
    types?: VisualizerType[];
    rate_max?: number;
    /** New ceiling on buffered visualizer bytes — the one setting a client may need to lower mid-stream. */
    buffer_capacity?: number;
    spectrum?: VisualizerSpectrumConfig;
}
export interface StreamRequestFormatMessage {
    type: 'stream/request-format';
    payload: StreamRequestFormatPayload;
}
export interface StreamRequestFormatPlayer {
    codec?: AudioCodec;
    sample_rate?: number;
    channels?: number;
    bit_depth?: number;
}
export interface ServerHelloPayload {
    server_id: string;
    name: string;
    version: number;
    active_roles: RoleName[];
    connection_reason: ConnectionReason;
}
export interface ServerHelloMessage {
    type: 'server/hello';
    payload: ServerHelloPayload;
}
/** An activity a server declares in `server/activate`. */
export type Activity = 'playback' | 'pairing';
/**
 * `server/activate` (1.0.0-rc1): the server's current purpose on an encrypted
 * connection. `active_roles` is required on the first one and persists across
 * later ones that omit it.
 */
export interface ServerActivatePayload {
    activities: Array<Activity | string>;
    active_roles?: RoleName[];
    pairing?: {
        method: string;
        format?: string;
    };
}
export interface ServerActivateMessage {
    type: 'server/activate';
    payload: ServerActivatePayload;
}
export interface ServerTimePayload {
    client_transmitted: number;
    server_received: number;
    server_transmitted: number;
}
export interface ServerTimeMessage {
    type: 'server/time';
    payload: ServerTimePayload;
}
export type VisualizerType = 'loudness' | 'f_peak' | 'spectrum' | 'beat' | 'peak' | 'pitch';
export type SpectrumScale = 'lin' | 'log' | 'mel';
/** Spectrum configuration shared by client/hello support and stream/start. */
export interface VisualizerSpectrumConfig {
    n_disp_bins: number;
    scale: SpectrumScale;
    f_min: number;
    f_max: number;
}
/** Parsed visualizer@v1 support object from client/hello. */
export interface VisualizerSupport {
    buffer_capacity: number;
    rate_max: number;
    types: VisualizerType[];
    spectrum?: VisualizerSpectrumConfig;
}
/** Negotiated visualizer config echoed back in stream/start. */
export interface VisualizerStreamConfig {
    types: VisualizerType[];
    rate_max: number;
    spectrum?: VisualizerSpectrumConfig;
    tracks_downbeats?: boolean;
}
/** An sRGB color as `[R, G, B]`, each component 0-255. */
export type Rgb = [number, number, number];
/**
 * Color object in a `server/state` message (color@v1). Each field is an
 * `[R, G, B]` tuple, `null` to explicitly clear it, or omitted to leave it
 * unchanged. The spec mandates WCAG >=4.5:1 contrast for the background/on
 * pairs; the caller is responsible for honoring that when building the value.
 */
export interface SessionUpdateColor {
    timestamp: number;
    background_dark?: Rgb | null | UndefinedField;
    background_light?: Rgb | null | UndefinedField;
    primary?: Rgb | null | UndefinedField;
    accent?: Rgb | null | UndefinedField;
    on_dark?: Rgb | null | UndefinedField;
    on_light?: Rgb | null | UndefinedField;
}
export interface ServerStatePayload {
    metadata?: SessionUpdateMetadata;
    controller?: ControllerStatePayload;
    color?: SessionUpdateColor;
}
export interface ServerStateMessage {
    type: 'server/state';
    payload: ServerStatePayload;
}
export interface GroupUpdateServerPayload {
    playback_state?: PlaybackStateType;
    group_id?: string;
    group_name?: string;
}
export interface GroupUpdateServerMessage {
    type: 'group/update';
    payload: GroupUpdateServerPayload;
}
export interface StreamStartPlayer {
    codec: AudioCodec;
    sample_rate: number;
    channels: number;
    bit_depth: number;
    codec_header?: string | null;
}
/**
 * When the server put a stream trigger on the wire, in its own clock, microseconds.
 *
 * This is the start of the window a player's `required_lead_time_ms` is measured
 * over: the spec counts the lead from here to the playback timestamp of the first
 * chunk that can play in full. Without it a client can state a lead requirement but
 * never tell whether it was honoured. Stamped at send on `stream/start`,
 * `stream/clear` and `stream/end`.
 */
export interface StreamTriggerTimestamp {
    server_transmitted: number;
}
export interface StreamStartPayload extends StreamTriggerTimestamp {
    player?: StreamStartPlayer;
    artwork?: StreamStartArtwork;
    visualizer?: StreamStartVisualizer;
}
export interface StreamStartMessage {
    type: 'stream/start';
    payload: StreamStartPayload;
}
export interface StreamClearPayload extends StreamTriggerTimestamp {
    roles?: RoleName[];
}
export interface StreamClearMessage {
    type: 'stream/clear';
    payload: StreamClearPayload;
}
export interface StreamEndPayload extends StreamTriggerTimestamp {
    roles?: RoleName[];
}
export interface StreamEndMessage {
    type: 'stream/end';
    payload: StreamEndPayload;
}
export interface PlayerCommandPayload {
    command: PlayerCommand;
    volume?: number;
    mute?: boolean;
    /** Static playback delay in milliseconds (0-5000), only valid when command is `set_static_delay`. */
    static_delay_ms?: number;
    /** Output delay in milliseconds (0-5000), only valid when command is `set_output_delay`. */
    output_delay_ms?: number;
}
export interface ServerCommandPayload {
    player?: PlayerCommandPayload;
    source?: SourceCommandPayload;
}
export interface ServerCommandMessage {
    type: 'server/command';
    payload: ServerCommandPayload;
}
/** Role families that maintain a client-side buffer, so `stream/clear` applies to them. */
export declare const STREAM_CLEAR_ROLE_FAMILIES: readonly string[];
/** Role families that receive a stream, so `stream/end` applies to them. */
export declare const STREAM_END_ROLE_FAMILIES: readonly string[];
export type ClientOutboundMessage = ClientHelloMessage | ClientLeaveMessage | ClientTimeMessage | ClientStateMessage | ClientCommandMessage | ClientGoodbyeMessage | ClientStreamStartMessage | ClientStreamEndMessage | StreamRequestFormatMessage;
export type ServerInboundMessage = ServerHelloMessage | ServerActivateMessage | ServerTimeMessage | ServerStateMessage | GroupUpdateServerMessage | StreamStartMessage | StreamClearMessage | StreamEndMessage | ServerCommandMessage;
export type ServerOutboundMessage = ServerHelloMessage | ServerTimeMessage | ServerStateMessage | GroupUpdateServerMessage | StreamStartMessage | StreamClearMessage | StreamEndMessage | ServerCommandMessage;
export type ClientInboundMessage = ClientHelloMessage | ClientTimeMessage | ClientStateMessage | ClientCommandMessage | ClientGoodbyeMessage | ClientStreamStartMessage | ClientStreamEndMessage | StreamRequestFormatMessage;
//# sourceMappingURL=types.d.ts.map