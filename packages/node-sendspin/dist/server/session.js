import WebSocket from 'ws';
import { BINARY_HEADER_SIZE, LEGACY_PLAYER_AUDIO_HEADER_SIZE, PLAYER_AUDIO_HEADER_SIZE, packArtworkAnnounce, packArtworkCancel, packArtworkParts, packBinaryHeaderRaw, packPlayerAudioHeader, stampSendAhead, unpackBinaryHeader, } from '../binary.js';
import { AudioCodec, BinaryMessageType, ClientStateType, ConnectionReason, MediaCommand, PlaybackStateType, PlayerCommand, Roles, SourceCommand, STREAM_CLEAR_ROLE_FAMILIES, STREAM_END_ROLE_FAMILIES, TrustLevel, isUndefinedField, } from '../types.js';
import { serverNowUs } from './clock.js';
import { PlayerBufferTracker } from './buffer-tracker.js';
import { unnameableMediaCommands } from './peer-compat.js';
import { beginServerHandshake, HandshakeAbortedError, InitRejectedError, isClientInit, serverErrorFrame, PskCategory, } from '../noise/handshake.js';
/** Client-to-server types this session acts on; one of these without a payload object is malformed. */
const KNOWN_CLIENT_MESSAGE_TYPES = new Set([
    'client/hello',
    'client/time',
    'client/state',
    'client/command',
    'client/goodbye',
    'client-stream/start',
    'client_stream/start',
    'stream/request-format',
    'client/leave',
]);
const DEFAULT_SERVER_INFO = { serverId: 'server', name: 'Sendspin Server' };
const clampU16 = (v) => Math.max(0, Math.min(65535, Math.round(v)));
const clampU8 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const clampInt = (v, min, max) => Math.max(min, Math.min(max, Math.round(v)));
/** `text` cut to at most `maxBytes` of UTF-8, never splitting a character. */
function truncateUtf8(text, maxBytes) {
    if (Buffer.byteLength(text, 'utf8') <= maxBytes)
        return text;
    let out = '';
    let used = 0;
    for (const ch of text) {
        const size = Buffer.byteLength(ch, 'utf8');
        if (used + size > maxBytes)
            break;
        out += ch;
        used += size;
    }
    return out;
}
const samePlayerFormat = (a, b) => a.codec === b.codec && a.sampleRate === b.sampleRate && a.channels === b.channels && a.bitDepth === b.bitDepth;
/** Metadata keys only a legacy peer reads there; rc1 carries them in the controller object (#81). */
const METADATA_LEGACY_ONLY_KEYS = ['repeat', 'shuffle'];
/**
 * Fold a partial role-state update into the full state kept for an rc1 peer.
 *
 * `undefined` (and the {@link UNDEFINED_FIELD} marker) leaves a field as it was,
 * `null` clears it, anything else replaces it. Keys in `skip` are never kept.
 */
function mergeRoleState(state, update, skip) {
    for (const [key, value] of Object.entries(update)) {
        if (skip.includes(key) || value === undefined || isUndefinedField(value))
            continue;
        if (value === null) {
            delete state[key];
        }
        else {
            state[key] = structuredClone(value);
        }
    }
}
/** Spec main (#344) caps on a client/hello. */
const CLIENT_HELLO_MAX_BYTES = 16384;
const CLIENT_HELLO_MAX_DEPTH = 10;
/** Nesting depth of a JSON value: an object or array is one level plus its deepest member. */
function jsonDepth(value, limit = 64) {
    if (!value || typeof value !== 'object')
        return 0;
    if (limit <= 0)
        return Infinity;
    let deepest = 0;
    for (const member of Object.values(value)) {
        deepest = Math.max(deepest, jsonDepth(member, limit - 1));
        if (deepest === Infinity)
            break;
    }
    return 1 + deepest;
}
/** Visualizer types rc1 defines; `pitch` (type 21) is reserved there (#195). */
const RC1_VISUALIZER_TYPES = ['loudness', 'f_peak', 'spectrum', 'beat', 'peak'];
/** Below this many bytes queued on the socket, the next artwork part may go out. */
const ARTWORK_DRAIN_BYTES = 64 * 1024;
/**
 * Per-connection Sendspin session. Handles handshake, time sync, player/controller state,
 * and sending stream/metadata/commands to the client.
 */
export class SendspinSession {
    get activeStream() {
        return this.activeStreams.has('player');
    }
    constructor(ws, req, connectionReason = ConnectionReason.DISCOVERY, connectionMeta = {}, hooks = {}, security = null, serverInfo = DEFAULT_SERVER_INFO) {
        this.ws = ws;
        this.req = req;
        this.connectionReason = connectionReason;
        this.connectionMeta = connectionMeta;
        this.ready = false;
        this.clientId = null;
        this.clientName = null;
        this.roles = [];
        this.playerSupport = null;
        /** `device_info` from the hello, kept for peer-compatibility decisions. */
        this.deviceInfo = null;
        /** Media commands this peer's library is too old to name; see peer-compat. */
        this.blindMediaCommands = new Set();
        this.sourceSupport = null;
        this.artworkChannels = [];
        /**
         * How this peer speaks, decided once at hello time as the reference does.
         *
         * A legacy peer predates 1.0.0-rc1: it connected unencrypted, or its hello still
         * carried `trust_level` (#158) or `player@v1_support.supported_commands` (#177).
         * Every wire difference with no role-local marker of its own switches on this:
         * the 9-byte audio header, the 2/3 fragment framing, and so on.
         */
        this.legacyWire = false;
        /** The hello declared `artwork@v1_support` (pre-#195), so artwork uses the single-message wire (pre-#188). */
        this.legacyArtwork = false;
        /** The hello carried visualizer stream config (`types`/`rate_max`/`spectrum`), pre-#195. */
        this.legacyVisualizer = false;
        /** An rc1 artwork peer's channels arrived in `client/state`; until then no artwork may be sent. */
        this.artworkStateReceived = false;
        /** An artwork `stream/start` was asked for before the channels were known. */
        this.artworkStartPending = false;
        /** The rc1 artwork stream is active; carries the 4-channel config it was started with. */
        this.artworkStreamConfigs = null;
        /** Images waiting to be transferred, latest per channel, in arrival order. */
        this.artworkQueue = new Map();
        /** The one transfer allowed in flight across all channels. */
        this.artworkInFlight = null;
        this.artworkPumping = false;
        /** Images sent while the artwork `stream/start` was held, sent once it goes out. */
        this.artworkHeld = new Map();
        this.visualizerSupport = null;
        /** The visualizer config the host last asked to stream, before fitting it to the client. */
        this.visualizerHostConfig = null;
        /** An rc1 visualizer's stream config arrived in `client/state` (#195). */
        this.visualizerStateReceived = false;
        /** Last visualizer@v1 config we announced, so a renegotiation can patch it. */
        this.visualizerStreamConfig = null;
        this.expectVolume = false;
        this.expectMute = false;
        /** Player commands a legacy hello listed in `player@v1_support.supported_commands` (pre-#177). */
        this.helloPlayerCommands = [];
        /** `supported_commands` from the latest `client/state` player object (#177), null until one arrives. */
        this.statePlayerCommands = null;
        /** A `client/state` carrying the player object has arrived; no player command may precede it. */
        this.playerStateReceived = false;
        /** What the player holds against its `buffer_capacity`, counted as rc1 defines it (#288). */
        this.playerBuffer = new PlayerBufferTracker();
        /** Stream starts asked for while rc1 forbade them, flushed once a client/state allows them. */
        this.pendingStarts = new Set();
        /** The visualizer config of a pending visualizer start. */
        this.pendingVisualizerConfig = null;
        /** The group id and name last sent an rc1 peer, to fill an update that omits them. */
        this.lastGroup = null;
        /** The format the player's latest `client/state` prefers (#195), or null for no preference. */
        this.playerPreferredFormat = null;
        /** Controller commands as last offered in `sendControllerState`, after per-peer filtering. */
        this.offeredControllerCommands = null;
        this.warnedMissingVolume = false;
        this.warnedMissingMute = false;
        this.initialStateReceived = false;
        this.initialStateTimer = null;
        this.initialStateRequired = false;
        this.identified = false;
        this.playbackState = PlaybackStateType.STOPPED;
        this.lastStateSignature = null;
        this.sourceState = null;
        this.sourceSignal = null;
        /** Format from the source's last `client_stream/start`, cleared on `client_stream/end`. */
        this.sourceStreamFormat = null;
        this.trustLevel = TrustLevel.NONE;
        this.unpairedAccess = false;
        /** Deviations already reported, so a chatty client is flagged once per reason. */
        this.flaggedNoncompliance = new Set();
        /**
         * Where this connection is in the Noise bring-up.
         *
         * `plaintext` covers both "nothing decided yet" and a transition-mode client that
         * opened with `client/hello`; the two are distinguished by `ready`.
         */
        this.noisePhase = 'plaintext';
        this.handshake = null;
        this.transport = null;
        this.security = null;
        this.authenticatedClientId = null;
        this.pskCategory = null;
        /** The handshake only verified against the Sentinel after naming another PSK (Sentinel Fallback). */
        this.credentialMismatch = false;
        /** Why this session is held idle, or null when it may play. */
        this.pairingRequired = null;
        /** The roles negotiated from the hello, whether or not they could be activated. */
        this.negotiatedRoles = [];
        /** Activities declared in the last `server/activate`. */
        this.declaredActivities = [];
        /** A source `start` asked for before rc1 allowed it, sent once a `client/state` does. */
        this.pendingSourceStart = null;
        /** The source object of a `client/state` has arrived; no `start` may precede it. */
        this.sourceStateReceived = false;
        this.hooks = {};
        this.hooksAttached = false;
        /**
         * Server-to-client streams currently open on this connection, by role family.
         *
         * rc1 forbids a `stream/clear` or `stream/end` naming a role with no active
         * stream, or sent when none is (messaging.md), so both are filtered against it.
         */
        this.activeStreams = new Set();
        this.streamFormat = {
            codec: AudioCodec.PCM,
            sampleRate: 48000,
            channels: 2,
            bitDepth: 16,
        };
        this.lastGoodbyeReason = null;
        /** Full metadata@v1 state as last sent to an rc1 peer (see {@link sendMetadata}). */
        this.metadataState = {};
        /** Full color@v1 state as last sent to an rc1 peer (see {@link sendColor}). */
        this.colorState = {};
        this.maxBufferedSend = 1024 * 512; // ~512KB backpressure guard
        // Bumped on stream/clear and stream/end so an audio frame deferred under
        // backpressure can be dropped if the stream it belonged to was meanwhile
        // cleared (seek) or ended — mirrors the reference server's epoch invalidation.
        this.streamGeneration = 0;
        this.backpressureDrops = 0;
        this.lastBackpressureBytes = 0;
        this.lastBackpressureTs = 0;
        this.backpressureEvents = [];
        this.hooks = hooks;
        this.security = security;
        this.serverName = serverInfo.name;
        this.sourceCodecs = serverInfo.sourceCodecs
            ? [...new Set([AudioCodec.PCM, AudioCodec.FLAC, ...serverInfo.sourceCodecs])]
            : null;
        // Under encryption the identity's public key *is* the server_id, so prefer it
        // over anything configured — the two must not be able to disagree.
        this.serverId = security ? security.identity.peerId : serverInfo.serverId;
    }
    /** Whether this connection is carrying its application messages under Noise. */
    isEncrypted() {
        return this.noisePhase === 'encrypted';
    }
    /**
     * Whether this peer predates 1.0.0-rc1 and gets the pre-rc1 wire.
     *
     * Decided at hello time: an unencrypted connection, or a hello carrying
     * `trust_level` or `player@v1_support.supported_commands`. False before the hello.
     */
    isLegacyWire() {
        return this.legacyWire;
    }
    /** Whether artwork goes out as one `[type][timestamp][image]` message (hello-declared artwork). */
    usesLegacyArtworkWire() {
        return this.legacyArtwork;
    }
    /** Whether the visualizer stream config came from the hello rather than `client/state`. */
    usesLegacyVisualizerConfig() {
        return this.legacyVisualizer;
    }
    /**
     * Bytes of header in front of each player audio chunk on this connection: 13 for
     * an rc1 peer (with `send_ahead`), 9 for a legacy one. A capacity count against
     * the player's `buffer_capacity` has to include it.
     */
    getAudioHeaderSize() {
        return this.legacyWire ? LEGACY_PLAYER_AUDIO_HEADER_SIZE : PLAYER_AUDIO_HEADER_SIZE;
    }
    /**
     * How this connection was admitted, or null when it is unencrypted.
     *
     * `SENTINEL` means the published constant PSK admitted it: encrypted against a
     * passive listener, but authenticating nothing. Do not treat it as paired.
     */
    getPskCategory() {
        return this.pskCategory;
    }
    setHooks(hooks, context) {
        this.hooks = hooks;
        this.hooksAttached = true;
        if (context)
            Object.assign(this.connectionMeta, context);
        this.maybeNotifyIdentified();
    }
    hasHooksAttached() {
        return this.hooksAttached;
    }
    getClientId() {
        return this.clientId;
    }
    /**
     * The player's timing declarations, or undefined for each the client has not reported.
     *
     * Read this at stream start: `staticDelayMs` must be added to the send-ahead, and the two lead
     * hints shape the first chunk's timestamp. Waiting for the next `client/state` would mean a stream
     * that begins before one arrives is scheduled as if the client had declared nothing.
     */
    getPlayerTiming() {
        return {
            staticDelayMs: this.staticDelayMs,
            outputDelayMs: this.staticDelayMs,
            requiredLeadTimeMs: this.requiredLeadTimeMs,
            minBufferMs: this.minBufferMs,
        };
    }
    getClientName() {
        return this.clientName;
    }
    getRoles() {
        return this.roles;
    }
    getInfo() {
        return {
            id: this.clientId,
            roles: [...this.roles],
            playbackState: this.playbackState,
        };
    }
    getDescriptor() {
        return {
            clientId: this.clientId,
            roles: [...this.roles],
            playbackState: this.playbackState,
            remote: this.getRemoteAddress(),
        };
    }
    getConnectionReason() {
        return this.connectionReason;
    }
    getLastGoodbyeReason() {
        return this.lastGoodbyeReason;
    }
    getRemoteAddress() {
        return this.connectionMeta.remote ?? this.req?.socket?.remoteAddress ?? null;
    }
    getStreamFormat() {
        return { ...this.streamFormat };
    }
    getSourceStatus() {
        return { state: this.sourceState, signal: this.sourceSignal };
    }
    /**
     * Whether the client last reported itself available for playback, or undefined
     * if it has said nothing either way. Resolved across `available` and the legacy
     * `state` enum.
     */
    isAvailable() {
        return this.available;
    }
    /** The format the source announced with `client_stream/start`, or null when no stream is up. */
    getSourceStreamFormat() {
        return this.sourceStreamFormat ? { ...this.sourceStreamFormat } : null;
    }
    /** `device_info` as reported in the hello, or null when the client sent none. */
    getDeviceInfo() {
        return this.deviceInfo ? { ...this.deviceInfo } : null;
    }
    /** What the client said in its hello about trust and unpaired access. */
    getTrust() {
        return { trustLevel: this.trustLevel, unpairedAccess: this.unpairedAccess };
    }
    getSourceSupport() {
        if (!this.sourceSupport) {
            return null;
        }
        return {
            ...this.sourceSupport,
            supported_formats: Array.isArray(this.sourceSupport.supported_formats)
                ? this.sourceSupport.supported_formats.map((fmt) => ({ ...fmt }))
                : this.sourceSupport.supported_formats,
            features: this.sourceSupport.features ? { ...this.sourceSupport.features } : this.sourceSupport.features,
            controls: Array.isArray(this.sourceSupport.controls)
                ? [...this.sourceSupport.controls]
                : this.sourceSupport.controls,
        };
    }
    getBackpressureStats() {
        const cutoff = Date.now() - 5 * 60 * 1000;
        this.backpressureEvents = this.backpressureEvents.filter((ts) => ts >= cutoff);
        return {
            drops: this.backpressureDrops,
            lastBytes: this.lastBackpressureBytes,
            lastDropTs: this.lastBackpressureTs || null,
            recentDrops: this.backpressureEvents.length,
        };
    }
    getPlayerBufferCapacity() {
        const cap = this.playerSupport?.buffer_capacity;
        return typeof cap === 'number' && cap > 0 ? cap : 0;
    }
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
    getPlayerSupportedFormats() {
        const formats = this.playerSupport?.supported_formats;
        if (!Array.isArray(formats)) {
            return [];
        }
        return formats
            .filter((fmt) => Boolean(fmt))
            .map((fmt) => ({ ...fmt }));
    }
    /**
     * Player commands this client accepts: those listed in its latest `client/state`
     * player object (#177), plus any a legacy hello listed. Empty until either says.
     */
    getPlayerSupportedCommands() {
        return [...new Set([...this.helloPlayerCommands, ...(this.statePlayerCommands ?? [])])];
    }
    getArtworkChannels() {
        return this.artworkChannels.map((channel) => ({ ...channel }));
    }
    destroy() {
        if (this.initialStateTimer) {
            clearTimeout(this.initialStateTimer);
            this.initialStateTimer = null;
        }
        if (this.hooks.onDisconnected) {
            this.hooks.onDisconnected(this);
        }
    }
    /**
     * A cleartext frame from the socket.
     *
     * Only the Noise bring-up and transition-mode clients arrive here; once
     * encryption is up every application message is a binary frame and reaches
     * {@link dispatchText} through the transport instead.
     */
    handleText(text) {
        if (this.noisePhase === 'awaiting-message2') {
            this.completeHandshake(text);
            return;
        }
        if (this.noisePhase === 'encrypted') {
            // Post-handshake cleartext is not part of the protocol and must not be
            // treated as application input — that would undo the encryption.
            this.closeWith(1008, 'cleartext frame after the Noise handshake');
            return;
        }
        if (!this.ready && isClientInit(text)) {
            void this.startHandshake(text);
            return;
        }
        if (!this.ready && this.security && !this.isTransitionOpening(text)) {
            // Not client/init, nor a transition-mode client/hello: a malformed init.
            this.rejectInit('malformed', 'first frame is neither client/init nor client/hello');
            return;
        }
        this.dispatchText(text);
    }
    /** Whether a pre-hello cleartext frame belongs to a transition-mode (unencrypted) client. */
    isTransitionOpening(text) {
        try {
            const type = JSON.parse(text)?.type;
            return type === 'client/hello' || type === 'client/goodbye';
        }
        catch {
            return false;
        }
    }
    /** Answer an unacceptable `client/init` with `server/error`, then close. */
    rejectInit(reason, detail) {
        this.flagNoncompliance(`client/init rejected (${reason}): ${detail}`);
        this.sendRawText(serverErrorFrame(reason));
        this.closeWith(1008, reason);
    }
    /**
     * Parse and route one JSON message, never letting a bad one escape.
     *
     * A peer controls every byte here, so nothing it sends may throw out of the
     * socket handler: in Audioserver an uncaught exception shuts the whole server
     * down. rc1 lets a receiver ignore an unknown `type` only when the message is a
     * JSON object with a `type` string and a `payload` object (#289); anything else
     * is not a Sendspin message at all.
     */
    dispatchText(text) {
        let msg;
        try {
            msg = JSON.parse(text);
        }
        catch {
            this.rejectMalformed('sent a message that is not valid JSON');
            return;
        }
        if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') {
            this.rejectMalformed('sent a message that is not a valid message envelope');
            return;
        }
        const type = msg.type;
        let payload = msg.payload;
        if (type === 'client/hello' && !this.ready) {
            /*
             * Spec main (#344): a client/hello MUST NOT exceed 16384 bytes of UTF-8 JSON or
             * nest deeper than 10 levels; servers MUST accept one within those limits and
             * MAY close beyond them. Depth is counted from the payload object, the more
             * lenient reading of "the root object is level 1".
             */
            if (Buffer.byteLength(text, 'utf8') > CLIENT_HELLO_MAX_BYTES) {
                this.flagNoncompliance('client/hello exceeds 16384 bytes');
                this.closeWith(1008, 'client/hello too large');
                return;
            }
            if (jsonDepth(payload) > CLIENT_HELLO_MAX_DEPTH) {
                this.flagNoncompliance('client/hello nests deeper than 10 levels');
                this.closeWith(1008, 'client/hello nested too deeply');
                return;
            }
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            if (payload === undefined && (type === 'client_stream/end' || type === 'client-stream/end' || type === 'client/leave')) {
                // Older sources send this one without a payload; the reference tolerates it.
                this.flagNoncompliance(`sent ${type} without a payload object`);
                payload = {};
            }
            else if (!this.ready || KNOWN_CLIENT_MESSAGE_TYPES.has(type)) {
                this.rejectMalformed(`sent ${type} without a payload object`);
                return;
            }
            else {
                this.flagNoncompliance(`sent ${type} without a payload object`);
                return;
            }
        }
        try {
            this.routeMessage(type, payload);
        }
        catch (error) {
            // A field of the wrong shape deeper inside a known message. Skip it rather
            // than take the process down; the peer is told nothing, as for any ignore.
            this.flagNoncompliance(`sent a malformed ${type}: ${error?.message ?? String(error)}`);
        }
    }
    /**
     * Answer a message that is not a Sendspin message.
     *
     * rc1 peers are closed, as the spec has it (a type-0 body that is not a JSON
     * object with a `type` string and a `payload` object is a protocol error). A
     * legacy, plaintext peer keeps today's treatment, which is to skip it.
     */
    rejectMalformed(reason) {
        this.flagNoncompliance(reason);
        if (this.noisePhase === 'encrypted' && !this.legacyWire) {
            this.closeWith(1002, 'malformed message');
        }
    }
    routeMessage(type, payload) {
        if (!this.ready) {
            if (type === 'client/goodbye') {
                this.handleClientGoodbye(payload);
                return;
            }
            if (type !== 'client/hello') {
                this.closeWith(1008, 'expected client/hello first');
                return;
            }
            this.handleHello(payload);
            return;
        }
        switch (type) {
            case 'client/hello':
                break;
            case 'client/time':
                this.handleClientTime(payload);
                break;
            case 'client/state':
                this.handleClientState(payload);
                break;
            case 'client/command':
                this.handleClientCommand(payload);
                break;
            case 'client/goodbye':
                this.handleClientGoodbye(payload);
                break;
            case 'client-stream/start':
                this.handleClientStreamStart(payload);
                break;
            case 'client_stream/start':
                if (!this.legacyWire) {
                    this.flagNoncompliance('sent client_stream/start, superseded by client-stream/start');
                }
                this.handleClientStreamStart(payload);
                break;
            case 'client-stream/end':
                this.handleClientStreamEnd(payload);
                break;
            case 'client_stream/end':
                if (!this.legacyWire) {
                    this.flagNoncompliance('sent client_stream/end, superseded by client-stream/end');
                }
                this.handleClientStreamEnd(payload);
                break;
            case 'stream/request-format':
                this.handleStreamRequestFormat(payload);
                break;
            case 'client/leave':
                this.handleClientLeave();
                break;
            default:
                break;
        }
    }
    /** Run the cleartext init exchange and put Noise message 1 on the wire. */
    async startHandshake(clientInitText) {
        if (!this.security) {
            // Refusing loudly beats falling back to plaintext: a client that asked for
            // encryption should not silently get a connection without it.
            this.closeWith(1008, 'encryption not configured on this server');
            return;
        }
        try {
            this.handshake = await beginServerHandshake({
                clientInitText,
                identity: this.security.identity,
                pskProvider: this.security.pskProvider,
            });
        }
        catch (error) {
            if (error instanceof InitRejectedError) {
                // A client/init we cannot accept is answered with server/error in place
                // of server/init (connection.md "Failure Handling", #265), then closed.
                this.rejectInit(error.reason, error.message);
                return;
            }
            // Anything later is a silent failure: closed without a word.
            this.closeWith(1008, error instanceof HandshakeAbortedError ? error.message : 'handshake failed');
            return;
        }
        this.noisePhase = 'awaiting-message2';
        for (const frame of this.handshake.send) {
            this.sendRawText(frame);
        }
    }
    /** Consume Noise message 2 and switch the connection to transport mode. */
    completeHandshake(message2Text) {
        const pending = this.handshake;
        if (!pending) {
            this.closeWith(1008, 'no handshake in progress');
            return;
        }
        let result;
        try {
            result = pending.finish(message2Text);
        }
        catch (error) {
            this.closeWith(1008, error instanceof HandshakeAbortedError ? error.message : 'handshake failed');
            return;
        }
        this.handshake = null;
        this.transport = result.transport;
        this.noisePhase = 'encrypted';
        // The client_id is now the client's authenticated static key rather than a
        // string it asked us to believe, so the hello must not be allowed to change it.
        this.authenticatedClientId = result.clientId;
        this.pskCategory = result.psk.category;
        this.credentialMismatch = result.credentialMismatch === true;
        this.clientId = result.clientId;
        /*
         * Encryption reverses the hello order: the server greets first, unprompted.
         *
         * The client waits for `server/hello` before sending its own, so a server that
         * waits for the hello deadlocks both sides. It works out this way because the
         * identity question is already settled — `server/init` carried the key the
         * handshake then proved — so there is nothing left for the server to learn
         * before it can name itself.
         */
        /*
         * rc1's source role has the server name the codecs it accepts here, when the
         * host configured them. It goes out before the client says what it is; a
         * client without the role ignores it, as it does any support object it does
         * not use.
         */
        this.sendJson({
            type: 'server/hello',
            payload: {
                name: this.serverName,
                ...(this.sourceCodecs ? { 'source@v1_support': { supported_codecs: this.sourceCodecs } } : {}),
            },
        });
    }
    handleBinary(data) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (this.noisePhase === 'encrypted') {
            this.handleEncryptedFrame(buf);
            return;
        }
        if (this.noisePhase === 'plaintext' && !this.ready && this.security) {
            // client/init is a TEXT frame; a BINARY first frame is a malformed init.
            this.rejectInit('malformed', 'first frame is BINARY');
            return;
        }
        this.handleAppBinary(buf);
    }
    /** Decrypt one transport frame and route its contents as if it arrived in the clear. */
    handleEncryptedFrame(frame) {
        if (!this.transport)
            return;
        let decoded;
        try {
            decoded = this.transport.decode(frame);
        }
        catch (error) {
            // A failed tag or a malformed fragment sequence: both are protocol errors.
            const reason = error instanceof Error ? error.message : 'Noise transport frame failed';
            this.flagNoncompliance(reason);
            this.closeWith(1002, reason.slice(0, 120));
            return;
        }
        if (!decoded)
            return; // A fragment; the message is still being assembled.
        if (decoded.kind === 'text') {
            this.dispatchText(decoded.data);
            return;
        }
        this.handleAppBinary(decoded.data);
    }
    handleAppBinary(buf) {
        let header = null;
        try {
            header = unpackBinaryHeader(buf);
        }
        catch {
            return;
        }
        if (!header)
            return;
        if (header.messageType === BinaryMessageType.SOURCE_AUDIO_CHUNK) {
            if (!this.roles.includes(Roles.SOURCE)) {
                return;
            }
            const chunk = buf.subarray(BINARY_HEADER_SIZE);
            if (this.hooks.onSourceAudio) {
                this.hooks.onSourceAudio(this, { timestampUs: header.timestampUs, data: chunk });
            }
        }
    }
    handleHello(payload) {
        const encrypted = this.noisePhase === 'encrypted';
        /*
         * Under encryption `client_id` and `version` belong to `client/init` and are
         * omitted here, so only a transition-mode hello has to carry them.
         */
        const version = typeof payload?.version === 'number' ? payload.version : null;
        if (!encrypted && version !== 1) {
            this.closeWith(1008, 'invalid protocol version');
            return;
        }
        const rawClientId = typeof payload?.client_id === 'string' ? payload.client_id.trim() : '';
        if (encrypted) {
            // The authenticated static key wins. A hello that claims a different id is
            // trying to be someone else, which is exactly what encryption should stop.
            if (rawClientId && rawClientId !== this.authenticatedClientId) {
                this.closeWith(1008, 'client_id does not match the authenticated identity');
                return;
            }
            this.clientId = this.authenticatedClientId;
        }
        else {
            if (!rawClientId) {
                this.closeWith(1008, 'missing client_id');
                return;
            }
            this.clientId = rawClientId;
        }
        this.clientName = typeof payload?.name === 'string' ? payload.name.trim() : null;
        const supportedRoles = Array.isArray(payload.supported_roles) ? payload.supported_roles : [];
        // An empty list is legal under encryption: the client is answered with an
        // activation that names no roles. Only a transition-mode hello must have one.
        if (!supportedRoles.length && !encrypted) {
            try {
                this.ws.close(1008, 'missing supported_roles');
            }
            catch {
                /* ignore */
            }
            return;
        }
        const { activeRoles, unsupportedRoles } = this.resolveActiveRoles(supportedRoles);
        this.roles = activeRoles;
        const playerSupport = payload['player@v1_support'] ?? payload.player_support ?? null;
        const artworkSupport = payload['artwork@v1_support'] ?? payload.artwork_support ?? null;
        /*
         * Sort the peer once, here, the way the reference does
         * (aiosendspin `_note_client_hello_wire`): unencrypted, or a hello still
         * carrying fields rc1 removed, means a pre-rc1 peer that must keep getting
         * the wire it was built against.
         */
        this.legacyWire =
            !encrypted
                || (payload && typeof payload === 'object' && 'trust_level' in payload)
                || Array.isArray(playerSupport?.supported_commands);
        this.legacyArtwork = Boolean(artworkSupport && typeof artworkSupport === 'object');
        if (this.transport) {
            this.transport.legacyFragmentFraming = this.legacyWire;
            this.transport.onLegacyFragment = () => this.flagNoncompliance('fragment used the pre-rc1 binary message IDs 2/3');
        }
        /*
         * Read the support object that belongs to the visualizer role we actually
         * activated, not whichever key happens to be present.
         *
         * A client may advertise both wires — that is what the draft compat path
         * exists for — and the two support objects have different shapes (v1 has
         * `types`/`rate_max`, the draft has `batch_max` and puts the rate inside
         * `spectrum`). Reading the draft object for a negotiated v1 role yielded
         * `types: []`, so nothing was negotiated at all.
         */
        const activatedDraftVisualizer = this.roles.includes(Roles.VISUALIZER_DRAFT_R1);
        const visualizerSupport = (activatedDraftVisualizer
            ? payload['visualizer@_draft_r1_support']
            : payload['visualizer@v1_support']) ??
            payload.visualizer_support ??
            null;
        const sourceSupport = payload['source@v1_support'] ?? payload.source_support ?? null;
        /*
         * A role whose required support object is missing is not activated.
         *
         * rc1 has the server skip such a role rather than drop the client, so an
         * encrypted peer keeps its other roles. A transition-mode peer keeps the
         * close it always got. `artwork@v1_support` is no longer required at all
         * (#195 moved the channels into `client/state`), and neither is
         * `source@v1_support` (#335 removed it; an absent one reads as `{}`).
         */
        const missingSupport = [];
        if (this.roles.includes(Roles.PLAYER) && !playerSupport) {
            missingSupport.push([Roles.PLAYER, 'missing player support']);
        }
        if ((this.roles.includes(Roles.VISUALIZER) || activatedDraftVisualizer) &&
            !visualizerSupport) {
            missingSupport.push([
                activatedDraftVisualizer ? Roles.VISUALIZER_DRAFT_R1 : Roles.VISUALIZER,
                'missing visualizer support',
            ]);
        }
        if (missingSupport.length) {
            if (!encrypted) {
                this.closeWith(1008, missingSupport[0][1]);
                return;
            }
            for (const [role, reason] of missingSupport) {
                this.flagNoncompliance(`${reason}: did not activate ${role}`);
            }
            const dropped = new Set(missingSupport.map(([role]) => role));
            this.roles = this.roles.filter((role) => !dropped.has(role));
        }
        if (this.roles.includes(Roles.ARTWORK) && !artworkSupport && !encrypted) {
            this.flagNoncompliance('transition-mode hello activated artwork without artwork@v1_support');
        }
        if (this.roles.includes(Roles.SOURCE) && !sourceSupport && this.legacyWire) {
            this.flagNoncompliance('legacy hello activated source without source@v1_support');
        }
        this.playerSupport = playerSupport || {};
        this.sourceSupport = this.roles.includes(Roles.SOURCE)
            ? (this.normalizeSourceSupport(sourceSupport) ?? {})
            : this.normalizeSourceSupport(sourceSupport);
        this.deviceInfo = payload?.device_info && typeof payload.device_info === 'object'
            ? payload.device_info
            : null;
        this.blindMediaCommands = unnameableMediaCommands(this.deviceInfo);
        this.trustLevel = payload?.trust_level === TrustLevel.USER ? TrustLevel.USER : TrustLevel.NONE;
        this.unpairedAccess = payload?.unpaired_access?.enabled === true;
        this.helloPlayerCommands = Array.isArray(this.playerSupport?.supported_commands)
            ? this.playerSupport.supported_commands.filter((c) => typeof c === 'string')
            : [];
        this.expectVolume = (this.playerSupport?.supported_commands ?? []).includes(PlayerCommand.VOLUME);
        this.expectMute = (this.playerSupport?.supported_commands ?? []).includes(PlayerCommand.MUTE);
        const artworkChannels = Array.isArray(artworkSupport?.channels) ? artworkSupport.channels : [];
        if (artworkChannels.length) {
            this.artworkChannels = artworkChannels.map((c) => ({
                source: c?.source === 'artist' ? 'artist' : c?.source === 'none' ? 'none' : 'album',
                format: c?.format === 'png' ? 'png' : c?.format === 'bmp' ? 'bmp' : 'jpeg',
                // The rc1 names (#168) win over the pre-rename ones when both are present.
                width: typeof c?.width === 'number' ? c.width : typeof c?.media_width === 'number' ? c.media_width : 800,
                height: typeof c?.height === 'number' ? c.height : typeof c?.media_height === 'number' ? c.media_height : 800,
            }));
        }
        if (this.roles.includes(Roles.VISUALIZER) && visualizerSupport) {
            this.legacyVisualizer = ['types', 'rate_max', 'spectrum'].some((key) => key in visualizerSupport);
            this.visualizerSupport = this.parseVisualizerSupport(visualizerSupport);
        }
        this.negotiatedRoles = [...this.roles];
        if (encrypted) {
            this.pairingRequired = this.pairingRequirement(payload?.unpaired_access);
            if (this.pairingRequired) {
                // pairing.md: no roles and no 'playback' on such a session. It stays open
                // and idle, as aiosendspin's does, so the device can be paired on it.
                this.roles = [];
            }
        }
        /*
         * Hold `onIdentified` for the initial `client/state`.
         *
         * Every rc1 client with active roles sends one, and it carries the role
         * objects (an artwork client's channels among them) a consumer needs before it
         * can stream anything. A legacy peer only owed it with the player role.
         */
        this.initialStateRequired =
            this.roles.includes(Roles.PLAYER) || (!this.legacyWire && this.roles.length > 0);
        this.applyPreferredStreamFormat();
        this.ready = true;
        this.sendServerHello();
        if (this.pairingRequired) {
            this.hooks.onPairingRequired?.(this, this.pairingRequired);
        }
        this.startInitialStateTimeout();
        const defaultGroup = this.getDefaultGroupInfo();
        this.sendGroupUpdate(PlaybackStateType.STOPPED, defaultGroup.groupId, defaultGroup.groupName);
        if (unsupportedRoles.length && this.hooks.onUnsupportedRoles) {
            this.hooks.onUnsupportedRoles(this, unsupportedRoles);
        }
        this.maybeNotifyIdentified();
    }
    handleClientTime(payload) {
        const nowUs = serverNowUs();
        const message = {
            type: 'server/time',
            payload: {
                client_transmitted: payload.client_transmitted,
                server_received: nowUs,
                server_transmitted: serverNowUs(),
            },
        };
        this.sendJson(message);
    }
    handleClientState(payload) {
        // Before the identification below, so a consumer reacting to it already sees the channels.
        if (payload.artwork !== undefined) {
            if (!this.handleArtworkState(payload.artwork))
                return;
        }
        if (payload.visualizer !== undefined) {
            if (!this.handleVisualizerState(payload.visualizer))
                return;
        }
        const roles = [...this.roles];
        const state = typeof payload.state === 'string'
            ? payload.state
            : typeof payload.player?.state === 'string'
                ? payload.player.state
                : undefined;
        /*
         * Resolve availability across both spellings, preferring the boolean.
         *
         * `available` replaced the `state` enum, which could only ever say "busy
         * elsewhere" and nothing else. Current clients send both during the
         * transition, older ones only the enum, and a spec-conformant one will
         * eventually send only the boolean — reading just one field means a client
         * that reports being busy is heard by nobody.
         */
        const wasAvailable = this.available;
        if (typeof payload.available !== 'boolean' && !this.legacyWire) {
            this.flagNoncompliance('client/state did not carry available');
        }
        if (typeof payload.available === 'boolean') {
            this.available = payload.available;
        }
        else if (state !== undefined) {
            this.available = state !== ClientStateType.EXTERNAL_SOURCE;
        }
        if (!this.legacyWire && wasAvailable === true && this.available === false) {
            // rc1: when a client becomes unavailable the server MUST end its active streams.
            this.sendStreamEnd();
        }
        /*
         * Remember the timing fields rather than passing this message's copy through.
         *
         * They are REQUIRED in a player's initial state and omitted from later updates when unchanged,
         * so reading them off each message alone means a volume change silently reports "no static
         * delay". They were dropped entirely before this: a server had no way to learn a value the spec
         * requires it to account for, and the one thing that made it visible was audio arriving early.
         */
        this.readPlayerTiming(payload.player);
        if (payload.player && typeof payload.player === 'object' && this.roles.includes(Roles.PLAYER)) {
            this.playerStateReceived = true;
            const commands = payload.player.supported_commands;
            if (Array.isArray(commands)) {
                this.statePlayerCommands = commands.filter((c) => typeof c === 'string');
            }
            else if (!this.legacyWire) {
                this.flagNoncompliance('client/state player object has no supported_commands');
            }
            this.applyPlayerFormatPreference(payload.player.format);
        }
        // After the role objects are read, so a consumer reacting to identification
        // already sees the player's timing and the commands it accepts.
        if (!this.initialStateReceived) {
            this.initialStateReceived = true;
            if (this.initialStateTimer) {
                clearTimeout(this.initialStateTimer);
                this.initialStateTimer = null;
            }
            this.maybeNotifyIdentified();
        }
        this.flushPendingStarts();
        const update = {
            clientId: this.clientId,
            roles,
            available: this.available,
            /*
             * rc1 clients send only `available`; hosts written against the old enum
             * (Audioserver among them) react to `state`, so derive it rather than leave
             * them deaf to a client that went busy elsewhere.
             */
            state: state ?? (this.legacyWire || this.available === undefined
                ? undefined
                : this.available ? ClientStateType.SYNCHRONIZED : ClientStateType.EXTERNAL_SOURCE),
            volume: payload.player?.volume,
            muted: payload.player?.muted,
            staticDelayMs: this.staticDelayMs,
            outputDelayMs: this.staticDelayMs,
            requiredLeadTimeMs: this.requiredLeadTimeMs,
            minBufferMs: this.minBufferMs,
        };
        if (this.expectVolume && update.volume === undefined && !this.warnedMissingVolume) {
            this.warnedMissingVolume = true;
        }
        if (this.expectMute && update.muted === undefined && !this.warnedMissingMute) {
            this.warnedMissingMute = true;
        }
        if (this.hooks.onPlayerState) {
            this.hooks.onPlayerState(this, update);
        }
        if (payload.source && typeof payload.source === 'object' && this.roles.includes(Roles.SOURCE)) {
            this.sourceStateReceived = true;
            const previousSignal = this.sourceSignal;
            this.sourceState = payload.source.state ?? null;
            this.sourceSignal = payload.source.signal ?? null;
            this.hooks.onSourceState?.(this, {
                clientId: this.clientId,
                roles,
                state: payload.source.state,
                level: payload.source.level,
                signal: payload.source.signal,
            });
            /*
             * rc1 drops the source `state` and leaves `signal` as the source's own say on
             * whether it has audio to offer; a change to `present` or `absent` is the
             * server's cue to send `start` or `stop`. The first signal after the role
             * came up, or after the client is available again, counts as a change.
             */
            const fresh = previousSignal !== this.sourceSignal || (wasAvailable !== true && this.available === true);
            if (this.sourceSignal && fresh) {
                this.hooks.onSourceSignalChanged?.(this, this.sourceSignal);
            }
        }
        else if (payload.source) {
            this.sourceState = payload.source.state ?? null;
            this.sourceSignal = payload.source.signal ?? null;
        }
        this.flushPendingSourceStart();
    }
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
    applyPlayerFormatPreference(raw) {
        if (raw === undefined || raw === null) {
            this.playerPreferredFormat = null;
            return;
        }
        const fmt = raw;
        const codec = this.normalizeCodec(fmt.codec);
        const preferred = codec
            && typeof fmt.sample_rate === 'number' && fmt.sample_rate > 0
            && typeof fmt.channels === 'number' && fmt.channels > 0
            && typeof fmt.bit_depth === 'number' && fmt.bit_depth > 0
            ? { codec, sampleRate: fmt.sample_rate, channels: fmt.channels, bitDepth: fmt.bit_depth }
            : null;
        if (!preferred || !this.isDeclaredFormat(preferred)) {
            this.flagNoncompliance("client/state player format is not one of the client's supported_formats");
            return;
        }
        const previous = this.playerPreferredFormat;
        this.playerPreferredFormat = preferred;
        if (previous && samePlayerFormat(previous, preferred))
            return;
        const current = this.streamFormat;
        if (samePlayerFormat(current, preferred))
            return;
        this.streamFormat = preferred;
        if (this.activeStream) {
            this.sendStreamFormat();
            this.hooks.onFormatChanged?.(this, { ...this.streamFormat });
        }
    }
    /**
     * The format the player's latest `client/state` says it prefers, or null when it
     * expressed none. Per rc1 the server SHOULD stream it whenever it can produce it.
     */
    getPlayerPreferredFormat() {
        return this.playerPreferredFormat ? { ...this.playerPreferredFormat } : null;
    }
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
    readPlayerTiming(player) {
        if (!player || typeof player !== 'object')
            return;
        const delay = typeof player.output_delay_ms === 'number'
            ? player.output_delay_ms
            : typeof player.static_delay_ms === 'number'
                ? player.static_delay_ms
                : undefined;
        if (typeof player.output_delay_ms !== 'number' && typeof player.static_delay_ms === 'number' && !this.legacyWire) {
            this.flagNoncompliance('client/state player used static_delay_ms, renamed output_delay_ms');
        }
        if (delay !== undefined && Number.isFinite(delay)) {
            this.staticDelayMs = clampInt(delay, 0, 5000);
            this.playerBuffer.outputDelayUs = this.staticDelayMs * 1000;
        }
        if (typeof player.required_lead_time_ms === 'number' && Number.isFinite(player.required_lead_time_ms)) {
            this.requiredLeadTimeMs = clampInt(player.required_lead_time_ms, 0, 30000);
        }
        if (typeof player.min_buffer_ms === 'number' && Number.isFinite(player.min_buffer_ms)) {
            this.minBufferMs = clampInt(player.min_buffer_ms, 0, 30000);
        }
    }
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
    handleVisualizerState(raw) {
        if (!this.roles.includes(Roles.VISUALIZER)) {
            this.flagNoncompliance('client/state carried a visualizer object without the visualizer@v1 role');
            return true;
        }
        if (this.legacyVisualizer) {
            this.flagNoncompliance('client/state carried a visualizer object after a hello that declared its config');
            return true;
        }
        const obj = raw;
        if (!obj || typeof obj !== 'object' || !Array.isArray(obj.types)
            || typeof obj.rate_max !== 'number' || !(obj.rate_max > 0)) {
            this.flagNoncompliance('client/state visualizer object needs types and a positive rate_max');
            return true;
        }
        const requested = obj.types;
        if (requested.includes('spectrum') && (!obj.spectrum || typeof obj.spectrum !== 'object')) {
            this.closeWith(1002, 'visualizer requests spectrum without a spectrum config');
            return false;
        }
        const parsed = this.parseVisualizerSupport({
            buffer_capacity: this.visualizerSupport?.buffer_capacity ?? 0,
            types: requested.filter((t) => RC1_VISUALIZER_TYPES.includes(t)),
            rate_max: Math.floor(obj.rate_max),
            ...(requested.includes('spectrum') ? { spectrum: obj.spectrum } : {}),
        });
        this.visualizerSupport = parsed;
        this.visualizerStateReceived = true;
        if (this.pendingVisualizerConfig) {
            this.pendingVisualizerConfig = this.fitVisualizerConfig(this.visualizerHostConfig ?? this.pendingVisualizerConfig);
        }
        const active = this.activeStreams.has('visualizer') ? this.visualizerStreamConfig : null;
        if (active) {
            // Re-derived from what the host asked to stream, so a type the client drops
            // and later asks for again comes back.
            const next = this.fitVisualizerConfig(this.visualizerHostConfig ?? active);
            if (JSON.stringify(next) !== JSON.stringify(this.fitVisualizerConfig(active, false))) {
                this.openVisualizerStream(next);
                this.hooks.onVisualizerFormatChanged?.(this, { ...next });
            }
        }
        return true;
    }
    /**
     * A visualizer stream config cut down to what an rc1 client currently asks for.
     *
     * rc1: `types` MUST be a subset of the requested ones, `rate_max` MUST NOT exceed
     * the requested rate, `spectrum` MUST match the requested config, and
     * `tracks_downbeats` is required with `beat` and absent without it. With `fit`
     * false only the shape rules are applied, to compare against what was sent.
     */
    fitVisualizerConfig(config, fit = true) {
        const support = this.visualizerSupport;
        let types = config.types.filter((t) => t !== 'pitch');
        let rateMax = config.rate_max;
        let spectrum = config.spectrum;
        if (fit && support && this.visualizerStateReceived) {
            types = types.filter((t) => support.types.includes(t));
            rateMax = Math.min(rateMax, support.rate_max);
            spectrum = support.spectrum;
        }
        const out = { types, rate_max: rateMax };
        if (types.includes('spectrum') && spectrum)
            out.spectrum = { ...spectrum };
        if (types.includes('beat'))
            out.tracks_downbeats = config.tracks_downbeats ?? false;
        return out;
    }
    /**
     * Take an rc1 artwork client's channels from its `client/state` (#195).
     *
     * Returns false when the message must go no further (the connection is closing).
     * A hello-declared (pre-#195) artwork peer keeps the channels it declared there.
     */
    handleArtworkState(raw) {
        if (!this.roles.includes(Roles.ARTWORK)) {
            this.flagNoncompliance('client/state carried an artwork object without the artwork role');
            return true;
        }
        if (this.legacyArtwork) {
            this.flagNoncompliance('client/state carried an artwork object after a hello that declared artwork');
            return true;
        }
        const list = raw?.channels;
        if (!Array.isArray(list) || list.length < 1) {
            this.flagNoncompliance('client/state artwork object has no channels');
            return true;
        }
        if (list.length > 4) {
            this.closeWith(1002, 'artwork declares more than 4 channels');
            return false;
        }
        const channels = [];
        for (const entry of list) {
            const source = entry?.source;
            if (source === 'none') {
                channels.push({ source: 'none', format: 'jpeg', width: 0, height: 0 });
                continue;
            }
            if (source !== 'album' && source !== 'artist') {
                this.flagNoncompliance(`client/state artwork channel has an unknown source ${String(source)}`);
                return true;
            }
            if ('media_width' in (entry ?? {}) || 'media_height' in (entry ?? {})) {
                this.flagNoncompliance('client/state artwork used pre-rename dimension keys media_width/media_height');
            }
            const width = typeof entry.width === 'number' ? entry.width : entry.media_width;
            const height = typeof entry.height === 'number' ? entry.height : entry.media_height;
            const format = entry.format;
            if (format === 'bmp') {
                this.flagNoncompliance("client/state artwork declared the removed 'bmp' format");
            }
            if ((format !== 'jpeg' && format !== 'png' && format !== 'bmp')
                || !Number.isInteger(width) || width <= 0
                || !Number.isInteger(height) || height <= 0) {
                this.flagNoncompliance('client/state artwork channel needs a format and a positive width and height');
                return true;
            }
            channels.push({ source, format, width, height });
        }
        const changed = JSON.stringify(channels) !== JSON.stringify(this.artworkChannels);
        this.artworkChannels = channels;
        this.artworkStateReceived = true;
        if (this.artworkStreamConfigs) {
            if (changed) {
                this.startArtworkStream();
                this.hooks.onArtworkChannelsChanged?.(this, this.getArtworkChannels());
            }
        }
        else if (this.artworkStartPending) {
            this.startArtworkStream();
        }
        return true;
    }
    handleClientCommand(payload) {
        const roles = [...this.roles];
        const controller = payload.controller;
        if (controller) {
            /*
             * A role object only counts when that role is active.
             *
             * The reference dispatches client/command to the active roles alone, so a
             * controller object from a client that never negotiated the controller role
             * reaches nobody. We forwarded it regardless, which let a player-only client
             * drive the group's transport and volume.
             */
            if (!this.roles.includes(Roles.CONTROLLER)) {
                this.flagNoncompliance('client/command carried a controller object without the controller role');
            }
            else if (!this.legacyWire && !this.offeredControllerCommands?.has(controller.command)) {
                // rc1 (#268): a command absent from the current supported_commands is ignored.
                this.flagNoncompliance(`client/command sent controller command ${String(controller.command)} that was not offered`);
            }
            else {
                const cmd = {
                    clientId: this.clientId,
                    roles,
                    command: controller.command,
                    volume: controller.volume,
                    mute: controller.mute,
                    ...(typeof controller.position_ms === 'number' ? { positionMs: controller.position_ms } : {}),
                    ...(typeof controller.offset_ms === 'number' ? { offsetMs: controller.offset_ms } : {}),
                };
                this.hooks.onGroupCommand?.(this, cmd);
            }
        }
        const source = payload.source;
        if (source && !this.roles.includes(Roles.SOURCE)) {
            this.flagNoncompliance('client/command carried a source object without the source role');
        }
        else if (source && this.hooks.onSourceCommand) {
            this.hooks.onSourceCommand(this, {
                clientId: this.clientId,
                roles,
                command: source.command,
            });
        }
    }
    /**
     * Record a client deviating from the spec, once per distinct reason.
     *
     * The reference funnels every backwards-compatibility tolerance through one place
     * so a deviation is visible rather than silently absorbed. This is that place: we
     * stay lenient on the wire, but the host gets told what was tolerated.
     */
    flagNoncompliance(reason) {
        if (this.flaggedNoncompliance.has(reason))
            return;
        this.flaggedNoncompliance.add(reason);
        this.hooks.onNoncompliance?.(this, reason);
    }
    handleClientGoodbye(payload) {
        const reason = payload?.reason;
        if (reason) {
            this.lastGoodbyeReason = reason;
            this.hooks.onGoodbye?.(this, reason);
        }
        try {
            this.ws.close();
        }
        catch {
            /* ignore */
        }
    }
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
    handleClientLeave() {
        if (this.hooks.onLeave) {
            this.hooks.onLeave(this);
            return;
        }
        const base = {
            clientId: this.clientId,
            roles: [...this.roles],
            staticDelayMs: this.staticDelayMs,
            outputDelayMs: this.staticDelayMs,
            requiredLeadTimeMs: this.requiredLeadTimeMs,
            minBufferMs: this.minBufferMs,
        };
        this.hooks.onPlayerState?.(this, { ...base, available: false, state: ClientStateType.EXTERNAL_SOURCE });
        this.hooks.onPlayerState?.(this, { ...base, available: true, state: ClientStateType.SYNCHRONIZED });
    }
    /**
     * A source client announced the format of the input stream it is about to send.
     *
     * The spec puts the source format here rather than in the hello support object, so
     * this is the only place a conformant source states it — and it may restate a new
     * one mid-session, which is why the format is replaced rather than merged.
     */
    handleClientStreamStart(payload) {
        if (!this.roles.includes(Roles.SOURCE))
            return;
        const source = payload?.source;
        const codec = this.normalizeCodec(source?.codec);
        if (!source
            || !codec
            || typeof source.sample_rate !== 'number' || source.sample_rate <= 0
            || typeof source.channels !== 'number' || source.channels <= 0
            || typeof source.bit_depth !== 'number' || source.bit_depth <= 0) {
            return;
        }
        const format = {
            codec,
            sampleRate: source.sample_rate,
            channels: source.channels,
            bitDepth: source.bit_depth,
            ...(typeof source.codec_header === 'string' ? { codecHeader: source.codec_header } : {}),
        };
        this.sourceStreamFormat = format;
        this.hooks.onSourceStreamStart?.(this, format);
    }
    handleClientStreamEnd(payload) {
        if (!this.roles.includes(Roles.SOURCE))
            return;
        // Spec main (#337): an end naming roles ends only those; omitted, it ends them all.
        if (Array.isArray(payload?.roles) && !payload.roles.some((r) => String(r).split('@')[0] === 'source'))
            return;
        this.sourceStreamFormat = null;
        this.hooks.onSourceStreamEnd?.(this);
    }
    /*
     * Answer only the roles the client actually asked about.
     *
     * This used to re-send the player stream/start for every request-format,
     * whichever sub-object it carried, so an artwork- or visualizer-only request
     * produced an unrequested player stream/start — a restart trigger the client
     * never asked for.
     */
    handleStreamRequestFormat(payload) {
        if (!this.legacyWire) {
            // rc1 (#195) folded this into client/state; still honoured, as aiosendspin does.
            this.flagNoncompliance('sent stream/request-format, superseded by client/state');
        }
        if (payload.player && this.roles.includes(Roles.PLAYER)) {
            this.applyPlayerFormatRequest(payload.player);
            this.hooks.onFormatChanged?.(this, this.streamFormat);
            this.sendStreamFormat();
        }
        if (payload.artwork && this.roles.includes(Roles.ARTWORK)) {
            this.applyArtworkFormatRequest(payload.artwork);
        }
        if (payload.visualizer && this.roles.includes(Roles.VISUALIZER)) {
            this.applyVisualizerFormatRequest(payload.visualizer);
        }
    }
    /**
     * Answer the client's hello, in whichever shape this connection uses.
     *
     * Encrypted connections were already greeted right after the handshake, so what
     * is owed here is `server/activate` — which is where everything the legacy hello
     * used to carry now lives. The wider legacy shape
     * (`server_id`/`version`/`active_roles`/`connection_reason`) is transition-mode
     * only; the reference calls it `LegacyServerHelloMessage` and still accepts it.
     */
    sendServerHello() {
        /*
         * An encrypted client waits for `server/activate` before it may send anything,
         * so it is owed one even when no role resolved — `active_roles: []` — or it
         * sits on a provisional connection until it gives up (rc1 messaging.md,
         * `server/activate`; aiosendspin always sends it).
         */
        if (this.noisePhase === 'encrypted') {
            this.sendServerActivate();
            return;
        }
        if (!this.roles.length)
            return;
        const payload = {
            server_id: this.serverId,
            name: this.serverName,
            version: 1,
            active_roles: this.roles.map((r) => r),
            connection_reason: this.connectionReason,
        };
        const message = { type: 'server/hello', payload };
        this.sendJson(message);
    }
    /**
     * Declare what this connection is currently for.
     *
     * Encrypted connections learn their roles here rather than from the hello.
     * `playback` is the only activity we ever claim: pairing and management are not
     * implemented, so admission rests entirely on the Sentinel PSK.
     */
    sendServerActivate() {
        /*
         * rc1: declare 'playback' only while it is wanted, since activities decide which
         * of several servers a client admits (connection.md "Multiple servers"). Like
         * aiosendspin's `_initial_activities`, a playback dial starts with it and any
         * other connection without; the first player or visualizer stream/start, or
         * source start, raises it (see raisePlayback), and setPlaybackActive(false)
         * drops it. A legacy peer keeps the 'playback' it always got.
         */
        this.declaredActivities =
            this.pairingRequired ? []
                : this.legacyWire || this.connectionReason === ConnectionReason.PLAYBACK ? ['playback'] : [];
        this.sendJson({
            type: 'server/activate',
            payload: {
                activities: this.declaredActivities,
                active_roles: this.roles.map((r) => r),
            },
        });
    }
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
    setPlaybackActive(active) {
        if (!this.ready || this.noisePhase !== 'encrypted' || this.legacyWire || this.pairingRequired)
            return;
        const declared = this.declaredActivities.includes('playback');
        if (active === declared)
            return;
        if (!active) {
            this.sendStreamEnd(['player', 'visualizer']);
            this.pendingStarts.delete('player');
            this.pendingStarts.delete('visualizer');
            this.pendingSourceStart = null;
        }
        this.declaredActivities = active ? ['playback'] : [];
        this.sendJson({ type: 'server/activate', payload: { activities: this.declaredActivities } });
    }
    /** Declare `'playback'` ahead of something that needs it (no-op when declared or not allowed). */
    raisePlayback() {
        this.setPlaybackActive(true);
    }
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
    pairingRequirement(unpairedAccess) {
        const declared = !!unpairedAccess && typeof unpairedAccess === 'object'
            && typeof unpairedAccess.enabled === 'boolean';
        if (!declared) {
            this.flagNoncompliance('client/hello unpaired_access is missing or has no enabled flag');
        }
        if (this.credentialMismatch)
            return 'credential_mismatch';
        if (this.pskCategory === PskCategory.LONG_TERM)
            return null;
        if (!(this.unpairedAccess || (!declared && this.legacyWire)))
            return 'unpaired_access_disabled';
        const approved = this.clientId ? (this.security?.isApprovedUnpaired?.(this.clientId) ?? true) : true;
        return approved ? null : 'not_approved';
    }
    /**
     * Why this encrypted session is held idle (no roles, no `'playback'`), or null
     * when it may play. A host shows it as "pairing required" or "enable unpaired
     * access on the device"; the roles the client offered are in
     * {@link getNegotiatedRoles}.
     */
    getPairingRequired() {
        return this.pairingRequired;
    }
    /** Whether the handshake fell back to the Sentinel: the client lost the credential we hold. */
    isCredentialMismatch() {
        return this.credentialMismatch;
    }
    /** The roles negotiated from the hello, including those held back on an idle session. */
    getNegotiatedRoles() {
        return [...this.negotiatedRoles];
    }
    /** The activities declared in the last `server/activate`; empty when not encrypted. */
    getActivities() {
        return [...this.declaredActivities];
    }
    sendStreamStart(format) {
        if (!this.ready)
            return;
        const merged = {
            ...this.streamFormat,
            ...format,
        };
        this.streamFormat = merged;
        if (this.holdStreamStart('player'))
            return;
        const player = {
            codec: merged.codec,
            sample_rate: merged.sampleRate,
            channels: merged.channels,
            bit_depth: merged.bitDepth,
            codec_header: merged.codecHeader,
        };
        const payload = { server_transmitted: serverNowUs(), player };
        const message = { type: 'stream/start', payload };
        this.activeStreams.add('player');
        this.sendJson(message);
    }
    sendStreamFormat() {
        if (!this.ready)
            return;
        if (this.holdStreamStart('player'))
            return;
        const merged = this.streamFormat;
        const player = {
            codec: merged.codec,
            sample_rate: merged.sampleRate,
            channels: merged.channels,
            bit_depth: merged.bitDepth,
            codec_header: merged.codecHeader,
        };
        const payload = { server_transmitted: serverNowUs(), player };
        const message = { type: 'stream/start', payload };
        this.activeStreams.add('player');
        this.sendJson(message);
    }
    /**
     * Clear buffered data on the client's streams (a seek, a track jump).
     *
     * An rc1 peer is sent it only for roles whose stream is active (rc1: "The server
     * MUST NOT send this message when no targeted streams are active ... Every listed
     * role MUST have an active stream"), with role names reduced to their families,
     * and not at all when nothing is left. So Audioserver's usual `stream/end` followed
     * by `stream/clear` costs nothing on the wire. A legacy peer gets it as before.
     */
    sendStreamClear(roles) {
        if (!this.ready)
            return;
        if (this.legacyWire) {
            const payload = {
                server_transmitted: serverNowUs(),
                roles: this.filterStreamRoles(roles, STREAM_CLEAR_ROLE_FAMILIES),
            };
            const message = { type: 'stream/clear', payload };
            this.streamGeneration += 1;
            if (!roles || roles.some((role) => String(role).split('@')[0] === 'player'))
                this.playerBuffer.reset();
            this.sendJson(message);
            return;
        }
        const targets = this.activeTargets(roles, STREAM_CLEAR_ROLE_FAMILIES);
        if (!targets.length)
            return;
        if (targets.includes('player')) {
            this.streamGeneration += 1;
            this.playerBuffer.reset();
        }
        this.sendJson({
            type: 'stream/clear',
            payload: { server_transmitted: serverNowUs(), ...(roles ? { roles: targets } : {}) },
        });
    }
    /**
     * End the client's streams: the given roles, or all of them when omitted.
     *
     * For an rc1 peer only roles with an active stream are ended, and nothing is
     * sent when none is (rc1 stream/end rules). Note that a role-less end also ends
     * the artwork stream, which clears the device's image; to pause, end only
     * `['player', 'visualizer']` (spec main #346), as {@link endPlaybackStreams} does.
     */
    sendStreamEnd(roles) {
        if (!this.ready)
            return;
        if (this.legacyWire) {
            if (!roles || roles.some((role) => String(role).split('@')[0] === 'artwork')) {
                this.endArtworkStream();
            }
            const payload = {
                server_transmitted: serverNowUs(),
                roles: this.filterStreamRoles(roles, STREAM_END_ROLE_FAMILIES),
            };
            const message = { type: 'stream/end', payload };
            this.activeStreams.clear();
            this.streamGeneration += 1;
            this.playerBuffer.reset();
            this.sendJson(message);
            return;
        }
        const wanted = roles ? roles.map((role) => String(role).split('@')[0]) : STREAM_END_ROLE_FAMILIES;
        for (const family of [...this.pendingStarts]) {
            if (wanted.includes(family))
                this.pendingStarts.delete(family);
        }
        if (wanted.includes('artwork')) {
            this.artworkStartPending = false;
            this.artworkHeld.clear();
        }
        const targets = this.activeTargets(roles, STREAM_END_ROLE_FAMILIES);
        if (!targets.length)
            return;
        if (targets.includes('artwork')) {
            // rc1: a transfer in flight is cancelled before the artwork stream/end.
            this.endArtworkStream();
        }
        for (const family of targets)
            this.activeStreams.delete(family);
        if (targets.includes('visualizer')) {
            // A later renegotiation must not re-open a stream the server ended.
            this.visualizerStreamConfig = null;
        }
        if (targets.includes('player')) {
            this.streamGeneration += 1;
            this.playerBuffer.reset();
        }
        // rc1 removed `server_transmitted` from stream/end (#167).
        this.sendJson({ type: 'stream/end', payload: roles ? { roles: targets } : {} });
    }
    /**
     * End the `player` and `visualizer` streams and leave `artwork` alone.
     *
     * This is what a pause is (spec main #346: "When a group pauses, the server MUST
     * end the active player and visualizer streams, but not the artwork stream"), so
     * the device keeps showing the cover. Resume with a fresh `stream/start`.
     */
    endPlaybackStreams() {
        this.sendStreamEnd(['player', 'visualizer']);
    }
    /** Role families with a server-to-client stream open on this connection. */
    getActiveStreams() {
        return [...this.activeStreams];
    }
    /** The active stream families a stream/clear or stream/end for `roles` reaches. */
    activeTargets(roles, families) {
        const wanted = roles
            ? roles.map((role) => (typeof role === 'string' ? role : '').split('@')[0])
            : families;
        return [...this.activeStreams].filter((family) => families.includes(family) && wanted.includes(family));
    }
    /**
     * Keep only the roles the given stream message applies to.
     *
     * `stream/clear` reaches roles that hold a buffer, `stream/end` roles that
     * receive a stream; naming any other role makes the payload invalid, so drop
     * the strays rather than have the client reject the whole message. An omitted
     * list means "all applicable roles" and is passed through untouched.
     */
    filterStreamRoles(roles, families) {
        if (!roles)
            return undefined;
        return roles.filter((role) => families.includes((typeof role === 'string' ? role : '').split('@')[0]));
    }
    /**
     * Send one player audio chunk.
     *
     * An rc1 peer reads a 13-byte header whose `send_ahead` (#167) is the time from
     * transmit to `timestamp`, so it is written in {@link sendBinary}, immediately
     * before encryption — on the deferred path too, where stamping at build time
     * would overstate it by the wait. A legacy peer gets the 9-byte header it reads.
     */
    sendPcmAudioFrame(frame) {
        if (this.ws.readyState !== WebSocket.OPEN)
            return;
        this.ensureStreamStarted();
        // rc1: "Servers MUST NOT send audio messages outside an active player stream."
        if (!this.legacyWire && !this.activeStream)
            return;
        const durationUs = frame.durationUs ?? this.pcmDurationUs(frame.data.length);
        let builtTs = 0;
        const build = () => {
            const ts = frame.timestampUs ?? serverNowUs();
            builtTs = ts;
            const header = this.legacyWire
                ? packBinaryHeaderRaw(BinaryMessageType.AUDIO_CHUNK, ts)
                : packPlayerAudioHeader(ts);
            return Buffer.concat([header, frame.data]);
        };
        const options = { stampSendAhead: !this.legacyWire };
        const transmit = () => {
            const message = build();
            this.sendBinary(message, options);
            if (durationUs !== undefined) {
                // Counted from transmission, the whole message (header included).
                this.playerBuffer.register(builtTs, durationUs, message.length);
            }
        };
        const buffered = this.ws.bufferedAmount;
        if (buffered > this.maxBufferedSend) {
            const generation = this.streamGeneration;
            setTimeout(() => {
                // Skip if the socket closed or the stream was cleared/ended while this
                // frame waited — otherwise a stale pre-seek frame would jump the queue.
                if (this.ws.readyState !== WebSocket.OPEN || this.streamGeneration !== generation)
                    return;
                transmit();
            }, 5);
            return;
        }
        transmit();
    }
    /** Playing time of `bytes` of PCM in the current stream format, or undefined for another codec. */
    pcmDurationUs(bytes) {
        const { codec, sampleRate, channels, bitDepth } = this.streamFormat;
        if (codec !== AudioCodec.PCM || !sampleRate || !channels || !bitDepth)
            return undefined;
        const frameBytes = channels * Math.ceil(bitDepth / 8);
        return Math.round((bytes / frameBytes / sampleRate) * 1_000_000);
    }
    /**
     * Bytes of audio the player holds against its `buffer_capacity` right now, under
     * rc1's accounting (#288): each chunk's header and payload, from transmission
     * until its end time minus the output delay, emptied by a player `stream/clear`
     * or `stream/end`. Chunks of a codec other than PCM count only when the caller
     * gave their `durationUs`.
     */
    getPlayerBufferedBytes() {
        return this.playerBuffer.bufferedBytes(serverNowUs());
    }
    /**
     * Microseconds until `bytes` more audio fit in the player's buffer: 0 when they
     * fit now, Infinity when they never can, and 0 when the player declared no
     * capacity. A server MUST NOT send a chunk that does not fit (rc1, #288).
     */
    timeUntilPlayerCapacityUs(bytes) {
        const capacity = this.getPlayerBufferCapacity();
        if (!capacity)
            return 0;
        return this.playerBuffer.timeUntilFreeUs(bytes, capacity, serverNowUs());
    }
    sendServerCommand(payloadOrCommand, payload) {
        if (!this.ready)
            return;
        const commandPayload = typeof payloadOrCommand === 'string'
            ? {
                player: {
                    command: payloadOrCommand,
                    volume: payload?.volume,
                    mute: payload?.mute,
                    static_delay_ms: payload?.static_delay_ms,
                },
            }
            : payloadOrCommand;
        if (this.legacyWire) {
            const wantsPlayer = !!commandPayload.player;
            const wantsSource = !!commandPayload.source;
            const canSendPlayer = wantsPlayer && this.roles.includes(Roles.PLAYER);
            const canSendSource = wantsSource && this.roles.includes(Roles.SOURCE);
            if (!canSendPlayer && !canSendSource) {
                return;
            }
            let outgoing = commandPayload;
            if (commandPayload.player?.command === PlayerCommand.SET_OUTPUT_DELAY) {
                // A legacy peer knows the command by its pre-#164 name only.
                const { output_delay_ms, ...rest } = commandPayload.player;
                outgoing = {
                    ...commandPayload,
                    player: {
                        ...rest,
                        command: PlayerCommand.SET_STATIC_DELAY,
                        static_delay_ms: rest.static_delay_ms ?? output_delay_ms,
                    },
                };
            }
            const message = { type: 'server/command', payload: outgoing };
            this.sendJson(message);
            return;
        }
        const player = commandPayload.player ? this.playerCommandForPeer(commandPayload.player) : undefined;
        const source = commandPayload.source ? this.sourceCommandForPeer(commandPayload.source) : undefined;
        if (!player && !source)
            return;
        const message = {
            type: 'server/command',
            payload: { ...(player ? { player } : {}), ...(source ? { source } : {}) },
        };
        this.sendJson(message);
    }
    /**
     * The source command an rc1 peer may be sent now, or undefined.
     *
     * rc1: the server MUST NOT send `start` unless the source role is active,
     * `'playback'` is declared, the source object of the client's `client/state`
     * has arrived and the latest state reports `available: true`. A `start` asked
     * for earlier is held and sent from {@link flushPendingSourceStart}; a `stop`
     * withdraws a held one.
     */
    sourceCommandForPeer(request) {
        if (!this.roles.includes(Roles.SOURCE))
            return undefined;
        if (request.command === SourceCommand.STOP)
            this.pendingSourceStart = null;
        if (request.command !== SourceCommand.START)
            return request;
        if (this.sourceStartAllowed()) {
            this.raisePlayback();
            return request;
        }
        this.pendingSourceStart = { ...request };
        return undefined;
    }
    sourceStartAllowed() {
        return this.sourceStateReceived && this.initialStateReceived && this.available !== false;
    }
    /** Send a held source `start` once the client's state allows it. */
    flushPendingSourceStart() {
        if (!this.pendingSourceStart || !this.sourceStartAllowed())
            return;
        const source = this.pendingSourceStart;
        this.pendingSourceStart = null;
        this.raisePlayback();
        this.sendJson({ type: 'server/command', payload: { source } });
    }
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
    playerCommandForPeer(request) {
        if (!this.roles.includes(Roles.PLAYER) || !this.playerStateReceived)
            return undefined;
        const offered = new Set(this.getPlayerSupportedCommands());
        switch (request.command) {
            case PlayerCommand.VOLUME:
                if (!offered.has(PlayerCommand.VOLUME) || typeof request.volume !== 'number')
                    return undefined;
                return { command: PlayerCommand.VOLUME, volume: clampInt(request.volume, 0, 100) };
            case PlayerCommand.MUTE:
                if (!offered.has(PlayerCommand.MUTE) || typeof request.mute !== 'boolean')
                    return undefined;
                return { command: PlayerCommand.MUTE, mute: request.mute };
            case PlayerCommand.SET_OUTPUT_DELAY:
            case PlayerCommand.SET_STATIC_DELAY: {
                const delay = request.output_delay_ms ?? request.static_delay_ms;
                if (typeof delay !== 'number' || !Number.isFinite(delay))
                    return undefined;
                const ms = clampInt(delay, 0, 5000);
                if (offered.has(PlayerCommand.SET_OUTPUT_DELAY)) {
                    return { command: PlayerCommand.SET_OUTPUT_DELAY, output_delay_ms: ms };
                }
                if (offered.has(PlayerCommand.SET_STATIC_DELAY)) {
                    return { command: PlayerCommand.SET_STATIC_DELAY, static_delay_ms: ms };
                }
                return undefined;
            }
            default:
                return undefined;
        }
    }
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
    sendGroupUpdate(playbackState, groupId, groupName) {
        if (!this.ready)
            return;
        this.playbackState = playbackState;
        if (this.legacyWire) {
            const message = {
                type: 'group/update',
                payload: {
                    playback_state: playbackState,
                    group_id: groupId,
                    group_name: groupName,
                },
            };
            this.sendJson(message);
            return;
        }
        const fallback = this.lastGroup ?? this.getDefaultGroupInfo();
        const group = {
            groupId: groupId ?? fallback.groupId,
            groupName: truncateUtf8(groupName ?? fallback.groupName, 64),
        };
        this.lastGroup = group;
        this.sendJson({
            type: 'group/update',
            payload: {
                playback_state: playbackState === PlaybackStateType.PLAYING ? 'playing' : 'stopped',
                group_id: group.groupId,
                group_name: group.groupName,
            },
        });
    }
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
    sendMetadata(metadata) {
        if (!this.ready)
            return;
        if (!this.roles.includes(Roles.METADATA))
            return;
        if (this.legacyWire) {
            const message = {
                type: 'server/state',
                payload: {
                    metadata: {
                        timestamp: serverNowUs(),
                        ...metadata,
                    },
                },
            };
            this.sendJson(message);
            return;
        }
        mergeRoleState(this.metadataState, metadata, METADATA_LEGACY_ONLY_KEYS);
        this.sendJson({
            type: 'server/state',
            payload: { metadata: { timestamp: serverNowUs(), ...this.metadataState } },
        });
    }
    /** The metadata the session last sent an rc1 peer, merged across partial updates. */
    getMetadataState() {
        return structuredClone(this.metadataState);
    }
    sendControllerState(controller) {
        if (!this.ready)
            return;
        if (!this.roles.includes(Roles.CONTROLLER))
            return;
        const offered = this.withoutBlindCommands(controller);
        this.offeredControllerCommands = new Set(offered.supported_commands ?? []);
        const message = {
            type: 'server/state',
            payload: { controller: offered },
        };
        this.sendJson(message);
    }
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
    withoutBlindCommands(controller) {
        if (!this.blindMediaCommands.size)
            return controller;
        const commands = (controller.supported_commands ?? []).filter((command) => !this.blindMediaCommands.has(command));
        if (commands.length === (controller.supported_commands ?? []).length)
            return controller;
        this.flagNoncompliance(`client library is behind the command set (${this.deviceInfo?.software_version ?? 'unknown'}); ` +
            `withheld ${[...this.blindMediaCommands].join(', ')} from supported_commands`);
        const filtered = { ...controller, supported_commands: commands };
        if (!commands.includes(MediaCommand.SEEK)) {
            delete filtered.seek_max_ms;
        }
        return filtered;
    }
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
    sendColor(color) {
        if (!this.ready)
            return;
        if (!this.roles.includes(Roles.COLOR))
            return;
        if (this.legacyWire) {
            const message = {
                type: 'server/state',
                payload: {
                    color: {
                        timestamp: serverNowUs(),
                        ...color,
                    },
                },
            };
            this.sendJson(message);
            return;
        }
        const { timestamp, ...fields } = color;
        mergeRoleState(this.colorState, fields, []);
        this.sendJson({
            type: 'server/state',
            payload: { color: { timestamp: timestamp ?? serverNowUs(), ...this.colorState } },
        });
    }
    /**
     * Start (or re-start) the artwork stream.
     *
     * For a hello-declared (pre-rc1) artwork peer `channels` is sent as given, in
     * full, as it always was. For an rc1 peer each channel of `stream/start` MUST
     * match the client's own `client/state` declaration, so `channels` is not used:
     * the session streams what the client declared, waits for that declaration if
     * it has not arrived yet, and skips a `stream/start` that would change nothing.
     */
    sendArtworkStreamStart(channels) {
        if (!this.ready)
            return;
        if (!this.roles.includes(Roles.ARTWORK))
            return;
        if (!this.legacyArtwork) {
            this.startArtworkStream();
            return;
        }
        this.artworkChannels = channels;
        this.activeStreams.add('artwork');
        const message = {
            type: 'stream/start',
            payload: {
                server_transmitted: serverNowUs(),
                artwork: {
                    channels: channels.map((c) => ({
                        source: c.source,
                        format: c.format,
                        width: c.width,
                        height: c.height,
                    })),
                },
            },
        };
        this.sendJson(message);
    }
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
    sendArtwork(channel, imageData) {
        if (!this.ready)
            return;
        if (this.legacyArtwork) {
            const header = packBinaryHeaderRaw(BinaryMessageType.ARTWORK_CHANNEL_0 + channel, serverNowUs());
            const payload = imageData ? Buffer.concat([header, imageData]) : header;
            this.sendBinary(payload);
            return;
        }
        if (!this.roles.includes(Roles.ARTWORK))
            return;
        const configs = this.artworkStreamConfigs;
        if (!configs && (this.artworkStartPending || this.pendingStarts.has('artwork'))) {
            // The stream/start is waiting for the client's state; the image goes out after it.
            this.artworkHeld.set(channel, imageData ?? Buffer.alloc(0));
            return;
        }
        if (!configs || configs[channel]?.source === 'none' || configs[channel] === undefined)
            return;
        if (this.artworkInFlight?.channel === channel) {
            this.cancelArtworkInFlight();
        }
        this.artworkQueue.delete(channel);
        this.artworkQueue.set(channel, imageData ?? Buffer.alloc(0));
        void this.pumpArtwork();
    }
    /** The 4-channel stream configuration an rc1 client's declaration implies. */
    artworkStreamConfigsFor(channels) {
        const configs = [];
        for (let i = 0; i < 4; i += 1) {
            const c = channels[i];
            configs.push(!c || c.source === 'none'
                ? { source: 'none' }
                : { source: c.source, format: c.format, width: c.width, height: c.height });
        }
        return configs;
    }
    /** Send an rc1 artwork `stream/start` for the declared channels, if it would change anything. */
    startArtworkStream() {
        if (!this.artworkStateReceived) {
            this.artworkStartPending = true;
            return;
        }
        this.artworkStartPending = false;
        if (this.holdStreamStart('artwork'))
            return;
        const next = this.artworkStreamConfigsFor(this.artworkChannels);
        const previous = this.artworkStreamConfigs;
        if (previous && JSON.stringify(previous) === JSON.stringify(next))
            return;
        if (previous) {
            // Queued images may be encoded for the old configuration.
            this.cancelArtworkInFlight();
            this.artworkQueue.clear();
            // A channel must be cleared, now, before the stream/start that stops streaming it.
            const now = serverNowUs();
            next.forEach((config, channel) => {
                if (config.source === 'none' && previous[channel].source !== 'none') {
                    this.sendBinary(packArtworkAnnounce(channel, now, 0));
                }
            });
        }
        const streamed = next.map((c, i) => (c.source === 'none' ? -1 : i)).filter((i) => i >= 0);
        // Truncated after the last streamed channel; with none streamed the stream
        // still starts, so a later client/state can switch a channel on.
        const channels = streamed.length ? next.slice(0, streamed[streamed.length - 1] + 1) : [];
        this.artworkStreamConfigs = next;
        this.activeStreams.add('artwork');
        this.sendJson({
            type: 'stream/start',
            payload: { server_transmitted: serverNowUs(), artwork: { channels } },
        });
        if (this.artworkHeld.size) {
            for (const [channel, image] of this.artworkHeld) {
                if (next[channel].source !== 'none')
                    this.artworkQueue.set(channel, image);
            }
            this.artworkHeld.clear();
            void this.pumpArtwork();
        }
    }
    /** Cancel the transfer in flight, if any, so the next announce is legal. */
    cancelArtworkInFlight() {
        const inFlight = this.artworkInFlight;
        if (!inFlight)
            return;
        inFlight.cancelled = true;
        this.artworkInFlight = null;
        this.sendBinary(packArtworkCancel(inFlight.channel));
    }
    /** Before an artwork `stream/end`: no transfer may be left in flight, nothing more may follow. */
    endArtworkStream() {
        if (this.legacyArtwork || !this.artworkStreamConfigs)
            return;
        this.cancelArtworkInFlight();
        this.artworkQueue.clear();
        this.artworkStreamConfigs = null;
    }
    /** Run queued artwork transfers one at a time until the queue is empty. */
    async pumpArtwork() {
        if (this.artworkPumping)
            return;
        this.artworkPumping = true;
        try {
            while (this.artworkQueue.size && this.artworkStreamConfigs && this.ws.readyState === WebSocket.OPEN) {
                const [channel, image] = this.artworkQueue.entries().next().value;
                this.artworkQueue.delete(channel);
                this.sendBinary(packArtworkAnnounce(channel, serverNowUs(), image.length));
                if (!image.length)
                    continue; // A clear completes with its announce.
                const transfer = { channel, cancelled: false };
                this.artworkInFlight = transfer;
                for (const part of packArtworkParts(channel, image)) {
                    // Pace the parts behind whatever else the socket carries (audio first).
                    await this.waitForArtworkDrain();
                    if (transfer.cancelled || this.ws.readyState !== WebSocket.OPEN)
                        break;
                    this.sendBinary(part);
                }
                if (this.artworkInFlight === transfer)
                    this.artworkInFlight = null;
            }
        }
        finally {
            this.artworkPumping = false;
        }
    }
    async waitForArtworkDrain() {
        await new Promise((resolve) => setImmediate(resolve));
        while (this.ws.readyState === WebSocket.OPEN && this.ws.bufferedAmount > ARTWORK_DRAIN_BYTES) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
    }
    /** Announce a legacy `visualizer@_draft_r1` stream (batched DATA blob wire). */
    sendVisualizerStreamStart(config = {}) {
        if (!this.ready)
            return;
        if (!this.roles.includes(Roles.VISUALIZER_DRAFT_R1))
            return;
        this.activeStreams.add('visualizer');
        const message = {
            type: 'stream/start',
            payload: { server_transmitted: serverNowUs(), visualizer: { ...config } },
        };
        this.sendJson(message);
    }
    /** Send one batched `visualizer@_draft_r1` DATA blob. */
    sendVisualizerFrame(data, timestampUs) {
        if (!this.ready)
            return;
        if (!this.roles.includes(Roles.VISUALIZER_DRAFT_R1))
            return;
        const ts = timestampUs ?? serverNowUs();
        const header = packBinaryHeaderRaw(BinaryMessageType.VISUALIZATION_DATA, ts);
        this.sendBinary(Buffer.concat([header, data]));
    }
    /** Normalize a client/hello visualizer@v1 support object. */
    parseVisualizerSupport(raw) {
        const allowed = ['loudness', 'f_peak', 'spectrum', 'beat', 'peak', 'pitch'];
        const types = Array.isArray(raw?.types)
            ? raw.types.filter((t) => allowed.includes(t))
            : [];
        const support = {
            buffer_capacity: typeof raw?.buffer_capacity === 'number' ? raw.buffer_capacity : 0,
            rate_max: typeof raw?.rate_max === 'number' ? raw.rate_max : 30,
            types,
        };
        const spectrum = raw?.spectrum;
        if (spectrum && typeof spectrum === 'object') {
            support.spectrum = {
                n_disp_bins: typeof spectrum.n_disp_bins === 'number' ? spectrum.n_disp_bins : 0,
                scale: spectrum.scale === 'log' || spectrum.scale === 'mel' ? spectrum.scale : 'lin',
                f_min: typeof spectrum.f_min === 'number' ? spectrum.f_min : 0,
                f_max: typeof spectrum.f_max === 'number' ? spectrum.f_max : 0,
            };
        }
        return support;
    }
    /** Visualizer@v1 capabilities the client advertised, or null when not negotiated. */
    getVisualizerSupport() {
        return this.roles.includes(Roles.VISUALIZER) ? this.visualizerSupport : null;
    }
    /**
     * Announce a visualizer@v1 stream. `types` must be a subset of what the
     * client advertised; the spectrum config is echoed from the client's support.
     */
    sendVisualizerStreamStartV1(config) {
        if (!this.ready)
            return;
        if (!this.roles.includes(Roles.VISUALIZER))
            return;
        this.visualizerHostConfig = { ...config };
        this.openVisualizerStream(config);
    }
    openVisualizerStream(config) {
        if (!this.legacyVisualizer && !this.legacyWire) {
            config = this.fitVisualizerConfig(config);
        }
        if (this.holdStreamStart('visualizer')) {
            this.pendingVisualizerConfig = { ...config };
            return;
        }
        const visualizer = {
            types: config.types,
            rate_max: config.rate_max,
        };
        if (config.spectrum)
            visualizer.spectrum = config.spectrum;
        if (config.tracks_downbeats !== undefined)
            visualizer.tracks_downbeats = config.tracks_downbeats;
        // Kept so a later stream/request-format can be applied as the partial update it
        // is, instead of having to rebuild a config the session never saw.
        this.visualizerStreamConfig = { ...config };
        this.activeStreams.add('visualizer');
        this.sendJson({
            type: 'stream/start',
            payload: { server_transmitted: serverNowUs(), visualizer },
        });
    }
    /** Send one visualizer@v1 binary frame: `[type:1][ts:8][payload]`. */
    sendVisualizerV1(type, payload, timestampUs) {
        if (!this.ready)
            return;
        if (!this.roles.includes(Roles.VISUALIZER))
            return;
        // rc1: no visualizer data outside an active visualizer stream.
        if (!this.legacyWire && !this.activeStreams.has('visualizer'))
            return;
        const ts = timestampUs ?? serverNowUs();
        this.sendBinary(Buffer.concat([packBinaryHeaderRaw(type, ts), payload]), { allowDrop: true });
    }
    /** Loudness frame (0-65535). */
    sendVisualizerLoudness(loudness, timestampUs) {
        const payload = Buffer.alloc(2);
        payload.writeUInt16BE(clampU16(loudness), 0);
        this.sendVisualizerV1(BinaryMessageType.VISUALIZATION_LOUDNESS, payload, timestampUs);
    }
    /** Display-binned spectrum frame: one big-endian u16 per bin. */
    sendVisualizerSpectrum(bins, timestampUs) {
        const payload = Buffer.alloc(bins.length * 2);
        for (let i = 0; i < bins.length; i += 1) {
            payload.writeUInt16BE(clampU16(bins[i]), i * 2);
        }
        this.sendVisualizerV1(BinaryMessageType.VISUALIZATION_SPECTRUM, payload, timestampUs);
    }
    /** Dominant frequency (Hz) + amplitude (0-65535). */
    sendVisualizerFpeak(freqHz, amplitude, timestampUs) {
        const payload = Buffer.alloc(4);
        payload.writeUInt16BE(clampU16(freqHz), 0);
        payload.writeUInt16BE(clampU16(amplitude), 2);
        this.sendVisualizerV1(BinaryMessageType.VISUALIZATION_F_PEAK, payload, timestampUs);
    }
    /** Energy onset event with strength (0-255). */
    sendVisualizerPeak(strength, timestampUs) {
        this.sendVisualizerV1(BinaryMessageType.VISUALIZATION_PEAK, Buffer.from([clampU8(strength)]), timestampUs);
    }
    /** Perceived pitch as MIDI 8.8 fixed-point + confidence (0-255). */
    sendVisualizerPitch(midiQ88, confidence, timestampUs) {
        // Type 21 is reserved in rc1 ("MUST NOT be used"); only a hello-configured
        // (pre-#195) visualizer@v1 peer, which may have asked for pitch, gets it.
        if (!this.legacyVisualizer)
            return;
        const payload = Buffer.alloc(3);
        payload.writeUInt16BE(clampU16(midiQ88), 0);
        payload.writeUInt8(clampU8(confidence), 2);
        this.sendVisualizerV1(BinaryMessageType.VISUALIZATION_PITCH, payload, timestampUs);
    }
    /** Musical beat event. `downbeat` sets the low flag bit. */
    sendVisualizerBeat(downbeat = false, timestampUs) {
        this.sendVisualizerV1(BinaryMessageType.VISUALIZATION_BEAT, Buffer.from([downbeat ? 0b1 : 0b0]), timestampUs);
    }
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
    applyPlayerFormatRequest(request) {
        if (!request)
            return;
        const codec = this.normalizeCodec(request.codec);
        const merged = {
            ...this.streamFormat,
            ...(codec ? { codec } : {}),
            ...(typeof request.sample_rate === 'number' ? { sampleRate: request.sample_rate } : {}),
            ...(typeof request.channels === 'number' ? { channels: request.channels } : {}),
            ...(typeof request.bit_depth === 'number' ? { bitDepth: request.bit_depth } : {}),
        };
        if (!this.isDeclaredFormat(merged)) {
            this.flagNoncompliance('stream/request-format requested a format not in the client\'s declared supported_formats');
            return;
        }
        this.streamFormat = merged;
    }
    /** Whether a fully-resolved format appears in the client's declared `supported_formats`. */
    isDeclaredFormat(format) {
        const declared = this.getPlayerSupportedFormats();
        // A client that declared nothing is already non-conformant; don't compound it by
        // second-guessing the request on top.
        if (!declared.length)
            return true;
        return declared.some((fmt) => this.normalizeCodec(fmt.codec) === format.codec
            && fmt.sample_rate === format.sampleRate
            && fmt.channels === format.channels
            && fmt.bit_depth === format.bitDepth);
    }
    /**
     * Apply a visualizer renegotiation and echo the result back.
     *
     * A partial update: omitted fields keep their current value. Requested types are
     * intersected with what the client declared in its hello, since a renegotiation
     * narrows the wire rather than widening what the client can decode.
     */
    applyVisualizerFormatRequest(request) {
        const support = this.visualizerSupport;
        const active = this.visualizerStreamConfig;
        if (!support || !active)
            return;
        if (Array.isArray(request.types)) {
            const allowed = new Set(support.types);
            const types = request.types.filter((type) => allowed.has(type));
            if (types.length) {
                active.types = types;
            }
        }
        if (typeof request.rate_max === 'number' && request.rate_max > 0) {
            active.rate_max = request.rate_max;
            support.rate_max = request.rate_max;
        }
        if (typeof request.buffer_capacity === 'number' && request.buffer_capacity > 0) {
            support.buffer_capacity = request.buffer_capacity;
        }
        if (request.spectrum) {
            const spectrum = { ...request.spectrum };
            active.spectrum = spectrum;
            support.spectrum = spectrum;
        }
        this.sendVisualizerStreamStartV1(active);
        this.hooks.onVisualizerFormatChanged?.(this, { ...active });
    }
    applyArtworkFormatRequest(request) {
        if (!request || typeof request.channel !== 'number')
            return;
        const idx = Math.max(0, Math.min(3, Math.floor(request.channel)));
        if (idx < 0 || idx >= this.artworkChannels.length) {
            return;
        }
        const current = this.artworkChannels[idx] ?? {
            source: 'album',
            format: 'jpeg',
            width: 800,
            height: 800,
        };
        const next = {
            source: request.source ?? current.source,
            format: request.format ?? current.format,
            width: typeof request.media_width === 'number' ? request.media_width : current.width,
            height: typeof request.media_height === 'number' ? request.media_height : current.height,
        };
        this.artworkChannels[idx] = next;
        this.sendArtworkStreamStart(this.artworkChannels);
    }
    applyPreferredStreamFormat() {
        const supportedFormats = Array.isArray(this.playerSupport?.supported_formats)
            ? this.playerSupport.supported_formats
            : [];
        if (!supportedFormats.length)
            return;
        const isSupported = (fmt) => fmt?.codec === 'opus' || fmt?.codec === 'flac' || fmt?.codec === 'pcm';
        const hasValidNumbers = (fmt) => typeof fmt.sample_rate === 'number' && fmt.sample_rate > 0
            && typeof fmt.channels === 'number' && fmt.channels > 0
            && typeof fmt.bit_depth === 'number' && fmt.bit_depth > 0;
        const preferred = supportedFormats.find((fmt) => isSupported(fmt) && hasValidNumbers(fmt));
        if (!preferred)
            return;
        const codec = preferred.codec === 'opus' ? AudioCodec.OPUS : preferred.codec === 'flac' ? AudioCodec.FLAC : AudioCodec.PCM;
        this.streamFormat = {
            codec,
            sampleRate: preferred.sample_rate,
            channels: preferred.channels,
            bitDepth: preferred.bit_depth,
        };
    }
    normalizeCodec(codec) {
        if (!codec)
            return undefined;
        if (codec === AudioCodec.OPUS || codec === 'opus')
            return AudioCodec.OPUS;
        if (codec === AudioCodec.FLAC || codec === 'flac')
            return AudioCodec.FLAC;
        if (codec === AudioCodec.PCM || codec === 'pcm')
            return AudioCodec.PCM;
        return undefined;
    }
    /**
     * Normalize a `source@v1_support` object.
     *
     * The spec object carries `features` alone; a source announces its format per
     * stream with `client_stream/start`. `supported_formats` and `controls` are vendor
     * additions, so both are optional and an object without them is valid — rejecting
     * a source for omitting `supported_formats` locked out every conformant client.
     */
    normalizeSourceSupport(raw) {
        if (!raw || typeof raw !== 'object') {
            return null;
        }
        const sourceSupport = raw;
        const supportedFormats = Array.isArray(sourceSupport.supported_formats)
            ? sourceSupport.supported_formats.filter((fmt) => Boolean(fmt))
            : [];
        return {
            ...(supportedFormats.length ? { supported_formats: supportedFormats } : {}),
            ...(Array.isArray(sourceSupport.controls) ? { controls: [...sourceSupport.controls] } : {}),
            ...(sourceSupport.features && typeof sourceSupport.features === 'object'
                ? { features: { ...sourceSupport.features } }
                : {}),
        };
    }
    resolveActiveRoles(supportedRoles) {
        const serverSupported = new Set([
            Roles.PLAYER,
            Roles.CONTROLLER,
            Roles.METADATA,
            Roles.ARTWORK,
            Roles.VISUALIZER,
            Roles.VISUALIZER_DRAFT_R1,
            Roles.COLOR,
            Roles.SOURCE,
        ]);
        /*
         * Prefer the spec wire when a client offers both visualizer revisions.
         *
         * Activation is first-in-client-order per family, so a client listing the draft
         * first would otherwise pin us to the legacy batched wire even though it also
         * speaks v1. The reference server solves this by skipping legacy role IDs.
         */
        const legacyRolesToSkip = new Set(supportedRoles.includes(Roles.VISUALIZER) ? [Roles.VISUALIZER_DRAFT_R1] : []);
        const activeRoles = [];
        const unsupportedRoles = [];
        const seenFamilies = new Set();
        for (const role of supportedRoles) {
            if (typeof role !== 'string')
                continue;
            if (legacyRolesToSkip.has(role))
                continue;
            const family = role.split('@')[0];
            if (serverSupported.has(role)) {
                if (!seenFamilies.has(family)) {
                    activeRoles.push(role);
                    seenFamilies.add(family);
                }
                continue;
            }
            if (!role.startsWith('_')) {
                unsupportedRoles.push(role);
            }
        }
        return { activeRoles, unsupportedRoles };
    }
    ensureStreamStarted() {
        if (this.activeStream)
            return;
        if (this.ws.readyState !== WebSocket.OPEN)
            return;
        this.sendStreamFormat();
    }
    /**
     * Whether an rc1 `stream/start` for `family` must wait, recording it as pending if so.
     *
     * rc1 messaging.md: the server MUST NOT send `stream/start` unless the latest
     * `client/state` reports `available: true`, and after activating a role it
     * MUST wait for that role's `client/state` object before starting its stream.
     * A held start is sent from {@link flushPendingStarts} once both hold; a role
     * that is not active is simply refused. A legacy peer is never held.
     */
    holdStreamStart(family) {
        if (this.legacyWire)
            return false;
        if (!this.roles.some((role) => role.split('@')[0] === family))
            return true;
        const stateReceived = family === 'player' ? this.playerStateReceived
            : family === 'artwork' ? this.artworkStateReceived || this.legacyArtwork
                : this.visualizerStateReceived || this.legacyVisualizer || !this.roles.includes(Roles.VISUALIZER);
        // A client that never reported `available` (flagged when its state arrives) is
        // taken as available rather than held forever.
        if (this.initialStateReceived && this.available !== false && stateReceived) {
            // Without 'playback' the client ignores player and visualizer streams (#314).
            if (family !== 'artwork')
                this.raisePlayback();
            return false;
        }
        this.pendingStarts.add(family);
        return true;
    }
    /** Send the stream starts a `client/state` has just allowed. */
    flushPendingStarts() {
        if (!this.pendingStarts.size)
            return;
        for (const family of [...this.pendingStarts]) {
            this.pendingStarts.delete(family);
            if (family === 'player') {
                this.sendStreamFormat();
            }
            else if (family === 'artwork') {
                this.startArtworkStream();
            }
            else if (family === 'visualizer' && this.pendingVisualizerConfig) {
                const config = this.pendingVisualizerConfig;
                this.pendingVisualizerConfig = null;
                this.openVisualizerStream(config);
            }
        }
    }
    /**
     * Flag a client whose initial `client/state` is late, without dropping it.
     *
     * rc1 sets no deadline, and spec main (#349) has a player or source hold that
     * state until its clock has converged, so a slow first state is legitimate. The
     * reference flags it and lets the client in; closing here turned a slow Wi-Fi
     * sync into a reconnect loop. The state still counts whenever it arrives.
     */
    startInitialStateTimeout() {
        if (!this.initialStateRequired) {
            return;
        }
        if (this.initialStateReceived || this.initialStateTimer) {
            return;
        }
        this.initialStateTimer = setTimeout(() => {
            this.initialStateTimer = null;
            if (this.initialStateReceived) {
                return;
            }
            this.flagNoncompliance('did not send the required initial client/state in time');
            this.initialStateRequired = false;
            this.maybeNotifyIdentified();
        }, 5000);
    }
    maybeNotifyIdentified() {
        if (this.identified) {
            return;
        }
        if (!this.ready || !this.hooks.onIdentified) {
            return;
        }
        if (this.initialStateRequired && !this.initialStateReceived) {
            return;
        }
        this.hooks.onIdentified(this, this.req);
        this.identified = true;
    }
    getDefaultGroupInfo() {
        if (this.connectionMeta.playerId) {
            return {
                groupId: this.connectionMeta.playerId,
                groupName: this.connectionMeta.playerId,
            };
        }
        if (typeof this.connectionMeta.zoneId === 'number') {
            const id = `zone-${this.connectionMeta.zoneId}`;
            return { groupId: id, groupName: id };
        }
        const fallback = this.clientId ?? 'sendspin';
        return { groupId: fallback, groupName: fallback };
    }
    sendBinary(buf, options = {}) {
        if (this.ws.readyState !== WebSocket.OPEN)
            return;
        const buffered = this.ws.bufferedAmount;
        if (options.allowDrop === true && buffered > this.maxBufferedSend) {
            this.backpressureDrops += 1;
            this.lastBackpressureBytes = buffered;
            this.lastBackpressureTs = Date.now();
            this.backpressureEvents.push(this.lastBackpressureTs);
            return;
        }
        if (options.stampSendAhead) {
            // As late as we can take it: nothing but encryption stands between this and the wire.
            stampSendAhead(buf, serverNowUs());
        }
        if (this.transport) {
            // The role type byte is already the first byte of `buf`, which is exactly the
            // transport's type-byte convention — no extra wrapping needed.
            for (const frame of this.transport.encodeBinary(buf)) {
                this.ws.send(frame);
            }
            return;
        }
        this.ws.send(buf);
    }
    sendJson(message) {
        if (this.ws.readyState !== WebSocket.OPEN)
            return;
        const text = JSON.stringify(message);
        if (this.transport) {
            for (const frame of this.transport.encodeText(text)) {
                this.ws.send(frame);
            }
            return;
        }
        this.ws.send(text);
    }
    /** A cleartext TEXT frame, used only by the Noise bring-up. */
    sendRawText(text) {
        if (this.ws.readyState !== WebSocket.OPEN)
            return;
        this.ws.send(text);
    }
    closeWith(code, reason) {
        try {
            this.ws.close(code, reason);
        }
        catch {
            /* ignore */
        }
    }
}
