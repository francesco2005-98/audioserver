/**
 * Core Sendspin protocol enums and message payload types.
 * These mirror the reference `aiosendspin` Python library but are expressed
 * as TypeScript interfaces so they can be used directly with JSON.
 */
export var Roles;
(function (Roles) {
    Roles["PLAYER"] = "player@v1";
    Roles["CONTROLLER"] = "controller@v1";
    Roles["METADATA"] = "metadata@v1";
    Roles["ARTWORK"] = "artwork@v1";
    /**
     * Current spec revision of the visualizer role. Per-type binary frames
     * (loudness/f_peak/spectrum/beat/peak/pitch, message types 16-21), and the
     * only visualizer wire a current client advertises.
     */
    Roles["VISUALIZER"] = "visualizer@v1";
    /** @deprecated Alias of {@link Roles.VISUALIZER}, kept for callers on the old name. */
    Roles["VISUALIZER_V1"] = "visualizer@v1";
    /**
     * Legacy visualizer wire: one batched DATA blob per frame at message type 16,
     * and `batch_max` where v1 has `rate_max`. The reference server excludes it
     * from negotiation in strict mode; kept here for esphome.
     */
    Roles["VISUALIZER_DRAFT_R1"] = "visualizer@_draft_r1";
    /**
     * Outbound-only role: the server pushes a color palette derived from the
     * current artwork via `server/state`. No client/hello support object is
     * required — clients simply list `color@v1` in `supported_roles`.
     */
    Roles["COLOR"] = "color@v1";
    /**
     * Captures audio from a local input and streams it to the server, which does
     * the resampling and distribution. Spec since aiosendspin 8.0.0; the format is
     * announced with `client_stream/start`, not in the hello support object.
     */
    Roles["SOURCE"] = "source@v1";
})(Roles || (Roles = {}));
export var BinaryMessageType;
(function (BinaryMessageType) {
    BinaryMessageType[BinaryMessageType["AUDIO_CHUNK"] = 4] = "AUDIO_CHUNK";
    BinaryMessageType[BinaryMessageType["ARTWORK_CHANNEL_0"] = 8] = "ARTWORK_CHANNEL_0";
    BinaryMessageType[BinaryMessageType["ARTWORK_CHANNEL_1"] = 9] = "ARTWORK_CHANNEL_1";
    BinaryMessageType[BinaryMessageType["ARTWORK_CHANNEL_2"] = 10] = "ARTWORK_CHANNEL_2";
    BinaryMessageType[BinaryMessageType["ARTWORK_CHANNEL_3"] = 11] = "ARTWORK_CHANNEL_3";
    /** One encoded audio frame captured by a source client (Source role, slot 0). */
    BinaryMessageType[BinaryMessageType["SOURCE_AUDIO_CHUNK"] = 12] = "SOURCE_AUDIO_CHUNK";
    /**
     * Slot 16 is shared: the legacy `visualizer@_draft_r1` wire sends a batched
     * DATA blob here, while `visualizer@v1` sends a single loudness frame. The
     * negotiated role selects the framing, so both names map to byte 16.
     */
    BinaryMessageType[BinaryMessageType["VISUALIZATION_DATA"] = 16] = "VISUALIZATION_DATA";
    BinaryMessageType[BinaryMessageType["VISUALIZATION_LOUDNESS"] = 16] = "VISUALIZATION_LOUDNESS";
    BinaryMessageType[BinaryMessageType["VISUALIZATION_BEAT"] = 17] = "VISUALIZATION_BEAT";
    BinaryMessageType[BinaryMessageType["VISUALIZATION_F_PEAK"] = 18] = "VISUALIZATION_F_PEAK";
    BinaryMessageType[BinaryMessageType["VISUALIZATION_SPECTRUM"] = 19] = "VISUALIZATION_SPECTRUM";
    BinaryMessageType[BinaryMessageType["VISUALIZATION_PEAK"] = 20] = "VISUALIZATION_PEAK";
    BinaryMessageType[BinaryMessageType["VISUALIZATION_PITCH"] = 21] = "VISUALIZATION_PITCH";
})(BinaryMessageType || (BinaryMessageType = {}));
export var RepeatMode;
(function (RepeatMode) {
    RepeatMode["OFF"] = "off";
    RepeatMode["ONE"] = "one";
    RepeatMode["ALL"] = "all";
})(RepeatMode || (RepeatMode = {}));
export var ClientStateType;
(function (ClientStateType) {
    ClientStateType["SYNCHRONIZED"] = "synchronized";
    ClientStateType["ERROR"] = "error";
    ClientStateType["EXTERNAL_SOURCE"] = "external_source";
})(ClientStateType || (ClientStateType = {}));
export var SourceStateType;
(function (SourceStateType) {
    SourceStateType["IDLE"] = "idle";
    SourceStateType["STREAMING"] = "streaming";
    SourceStateType["ERROR"] = "error";
})(SourceStateType || (SourceStateType = {}));
export var SourceSignalType;
(function (SourceSignalType) {
    SourceSignalType["UNKNOWN"] = "unknown";
    SourceSignalType["PRESENT"] = "present";
    SourceSignalType["ABSENT"] = "absent";
})(SourceSignalType || (SourceSignalType = {}));
export var PlaybackStateType;
(function (PlaybackStateType) {
    PlaybackStateType["PLAYING"] = "playing";
    PlaybackStateType["PAUSED"] = "paused";
    PlaybackStateType["STOPPED"] = "stopped";
})(PlaybackStateType || (PlaybackStateType = {}));
export var AudioCodec;
(function (AudioCodec) {
    AudioCodec["OPUS"] = "opus";
    AudioCodec["FLAC"] = "flac";
    AudioCodec["PCM"] = "pcm";
})(AudioCodec || (AudioCodec = {}));
export var PlayerCommand;
(function (PlayerCommand) {
    PlayerCommand["VOLUME"] = "volume";
    PlayerCommand["MUTE"] = "mute";
    /** @deprecated Pre-rc1 name of {@link SET_OUTPUT_DELAY}; still accepted from callers and sent to legacy peers. */
    PlayerCommand["SET_STATIC_DELAY"] = "set_static_delay";
    /** Set the player's output delay (1.0.0-rc1, #164); carries `output_delay_ms`. */
    PlayerCommand["SET_OUTPUT_DELAY"] = "set_output_delay";
})(PlayerCommand || (PlayerCommand = {}));
export var MediaCommand;
(function (MediaCommand) {
    MediaCommand["PLAY"] = "play";
    MediaCommand["PAUSE"] = "pause";
    MediaCommand["STOP"] = "stop";
    MediaCommand["NEXT"] = "next";
    MediaCommand["PREVIOUS"] = "previous";
    MediaCommand["VOLUME"] = "volume";
    MediaCommand["MUTE"] = "mute";
    MediaCommand["REPEAT_OFF"] = "repeat_off";
    MediaCommand["REPEAT_ONE"] = "repeat_one";
    MediaCommand["REPEAT_ALL"] = "repeat_all";
    MediaCommand["SHUFFLE"] = "shuffle";
    MediaCommand["UNSHUFFLE"] = "unshuffle";
    MediaCommand["SWITCH"] = "switch";
    /** Absolute seek. Carries `position_ms`; only offered when `seek_max_ms` is set. */
    MediaCommand["SEEK"] = "seek";
    /** Relative seek. Carries a signed `offset_ms`. */
    MediaCommand["SEEK_RELATIVE"] = "seek_relative";
})(MediaCommand || (MediaCommand = {}));
export var SourceCommand;
(function (SourceCommand) {
    SourceCommand["START"] = "start";
    SourceCommand["STOP"] = "stop";
})(SourceCommand || (SourceCommand = {}));
export var SourceControl;
(function (SourceControl) {
    SourceControl["PLAY"] = "play";
    SourceControl["PAUSE"] = "pause";
    SourceControl["NEXT"] = "next";
    SourceControl["PREVIOUS"] = "previous";
    SourceControl["ACTIVATE"] = "activate";
    SourceControl["DEACTIVATE"] = "deactivate";
})(SourceControl || (SourceControl = {}));
export var SourceClientCommand;
(function (SourceClientCommand) {
    SourceClientCommand["STARTED"] = "started";
    SourceClientCommand["STOPPED"] = "stopped";
})(SourceClientCommand || (SourceClientCommand = {}));
export var PictureFormat;
(function (PictureFormat) {
    /** @deprecated Removed in 1.0.0-rc1 (#168); only a legacy (hello-declared) artwork peer may use it. */
    PictureFormat["BMP"] = "bmp";
    PictureFormat["JPEG"] = "jpeg";
    PictureFormat["PNG"] = "png";
})(PictureFormat || (PictureFormat = {}));
export var ArtworkSource;
(function (ArtworkSource) {
    ArtworkSource["ALBUM"] = "album";
    ArtworkSource["ARTIST"] = "artist";
    ArtworkSource["NONE"] = "none";
})(ArtworkSource || (ArtworkSource = {}));
export var ConnectionReason;
(function (ConnectionReason) {
    ConnectionReason["DISCOVERY"] = "discovery";
    ConnectionReason["PLAYBACK"] = "playback";
})(ConnectionReason || (ConnectionReason = {}));
export var GoodbyeReason;
(function (GoodbyeReason) {
    GoodbyeReason["ANOTHER_SERVER"] = "another_server";
    GoodbyeReason["SHUTDOWN"] = "shutdown";
    GoodbyeReason["RESTART"] = "restart";
    GoodbyeReason["USER_REQUEST"] = "user_request";
    /** The server asked for an activity this client's trust level does not permit. */
    GoodbyeReason["UNAUTHORIZED"] = "unauthorized";
    /** The server asked for playback, but this client requires pairing first. */
    GoodbyeReason["PAIRING_REQUIRED"] = "pairing_required";
    /** Rejected because another connection is already admitted. */
    GoodbyeReason["CONCURRENT_ATTEMPT"] = "concurrent_attempt";
    /** The client processed `server/unpair` from this server. */
    GoodbyeReason["UNPAIRED"] = "unpaired";
})(GoodbyeReason || (GoodbyeReason = {}));
/**
 * Reasons a reconnect is pointless: the client is telling us it will not accept
 * this server as it stands, so retrying just produces the same refusal. `RESTART`
 * is deliberately absent — a restarting client is expected back.
 */
export const TERMINAL_GOODBYE_REASONS = [
    GoodbyeReason.ANOTHER_SERVER,
    GoodbyeReason.SHUTDOWN,
    GoodbyeReason.USER_REQUEST,
    GoodbyeReason.UNAUTHORIZED,
    GoodbyeReason.PAIRING_REQUIRED,
    GoodbyeReason.UNPAIRED,
];
/**
 * Trust a client extends to this server, as declared in `client/hello`. It is the
 * client's judgement of us, not ours of it, and governs which management
 * operations we may ask for. `none` is the honest answer on any unpaired
 * connection, which is every connection until a pairing exchange has happened.
 */
export var TrustLevel;
(function (TrustLevel) {
    TrustLevel["NONE"] = "none";
    TrustLevel["USER"] = "user";
})(TrustLevel || (TrustLevel = {}));
export const UNDEFINED_FIELD = Symbol('sendspin/undefined');
export const undefinedField = () => UNDEFINED_FIELD;
export const isUndefinedField = (value) => value === UNDEFINED_FIELD;
/** Role families that maintain a client-side buffer, so `stream/clear` applies to them. */
export const STREAM_CLEAR_ROLE_FAMILIES = ['player', 'visualizer'];
/** Role families that receive a stream, so `stream/end` applies to them. */
export const STREAM_END_ROLE_FAMILIES = ['player', 'artwork', 'visualizer'];
