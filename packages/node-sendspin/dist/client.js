import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import { ArtworkSource, BinaryMessageType, ClientStateType, GoodbyeReason, PictureFormat, PlayerCommand, Roles, SourceSignalType, STREAM_CLEAR_ROLE_FAMILIES, STREAM_END_ROLE_FAMILIES, } from './types.js';
import { ARTWORK_ANNOUNCE_SIZE, ARTWORK_FLAG_ANNOUNCE, ARTWORK_FLAG_CANCEL, ARTWORK_MAX_MESSAGE_SIZE, ARTWORK_RESERVED_FLAGS, BINARY_HEADER_SIZE, PLAYER_AUDIO_HEADER_SIZE, packBinaryHeaderRaw, unpackBinaryHeader, unpackPlayerAudioHeader, } from './binary.js';
import { SendspinTimeFilter } from './time-filter.js';
import { beginClientHandshake, PskCategory, } from './noise/handshake.js';
/** Why `payload` is a malformed rc1 artwork message, or null when it is well formed. */
function malformedArtworkMessage(payload) {
    const length = payload.length;
    if (length < 2 || length > ARTWORK_MAX_MESSAGE_SIZE)
        return `length ${length} outside 2-${ARTWORK_MAX_MESSAGE_SIZE}`;
    const flags = payload[1];
    if (flags & ARTWORK_RESERVED_FLAGS)
        return `flags 0x${flags.toString(16)} set reserved bits`;
    if (flags & ARTWORK_FLAG_ANNOUNCE && flags & ARTWORK_FLAG_CANCEL)
        return 'announce and cancel flags both set';
    if (flags & ARTWORK_FLAG_ANNOUNCE && length !== ARTWORK_ANNOUNCE_SIZE)
        return `announce of ${length} bytes`;
    if (flags & ARTWORK_FLAG_CANCEL && length !== 2)
        return `cancel of ${length} bytes`;
    return null;
}
/** The visualizer config a caller put on the (pre-rc1 shaped) hello support object, if any. */
function visualizerStateFrom(support) {
    const legacy = support;
    if (!legacy || !Array.isArray(legacy.types))
        return undefined;
    return {
        types: legacy.types,
        rate_max: typeof legacy.rate_max === 'number' && legacy.rate_max > 0 ? legacy.rate_max : 30,
        ...(legacy.spectrum ? { spectrum: legacy.spectrum } : {}),
    };
}
/** A pre-rc1 hello artwork channel as an rc1 `client/state` channel. */
function artworkStateChannel(channel) {
    if (channel.source === ArtworkSource.NONE)
        return { source: 'none' };
    return {
        source: channel.source,
        // bmp was removed in rc1 (#168); png is the lossless format left.
        format: channel.format === PictureFormat.JPEG ? 'jpeg' : 'png',
        width: channel.media_width,
        height: channel.media_height,
    };
}
/** Messages per time-sync burst: the spec's minimum. */
const TIME_BURST_SIZE = 8;
/** How long a burst waits for one `server/time` before giving up on the burst. */
const TIME_REPLY_TIMEOUT_MS = 1000;
/** Round and clamp a reported duration to 0..max ms. */
function clampMs(value, max) {
    return Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : 0;
}
export class PCMFormat {
    constructor(sampleRate, channels, bitDepth) {
        this.sampleRate = sampleRate;
        this.channels = channels;
        this.bitDepth = bitDepth;
        if (sampleRate <= 0)
            throw new Error('sampleRate must be positive');
        if (channels < 1 || channels > 2)
            throw new Error('channels must be 1 or 2');
        if (![16, 24, 32].includes(bitDepth))
            throw new Error('bitDepth must be 16, 24, or 32');
    }
    get frameSize() {
        return this.channels * (this.bitDepth / 8);
    }
}
export class AudioFormat {
    constructor(codec, pcm, codecHeader) {
        this.codec = codec;
        this.pcm = pcm;
        this.codecHeader = codecHeader;
    }
}
/**
 * The role family of a role named in `stream/clear` or `stream/end`.
 *
 * Those lists carry family names (`'player'`), not the versioned ids of
 * `supported_roles` (`'player@v1'`); a versioned one is read by its family too.
 */
function roleFamily(role) {
    return role.split('@')[0];
}
export class SendspinClient {
    constructor(clientId, clientName, roles, options = {}) {
        /** The artwork channels this client wants, as rc1 `client/state` carries them. */
        this.artworkChannels = [];
        this.artworkStreamActive = false;
        /** Images being received, by channel (rc1 announce/part transfers). */
        this.artworkPending = new Map();
        /** The channel whose transfer is in flight; only one may be, across channels. */
        this.artworkInFlight = null;
        /** Channels currently showing an image, which a stream end clears. */
        this.artworkShown = new Set();
        this.artworkCallbacks = new Set();
        this.visualizerStreamActive = false;
        /** The source object rc1 `client/state` carries while the source role is active. */
        this.sourceState = { signal: SourceSignalType.ABSENT };
        this.sourceStreamActive = false;
        this.connected = false;
        /** Noise transport once the handshake is up; null on an unencrypted connection. */
        this.transport = null;
        /**
         * The server speaks the wire from before 1.0.0-rc1. Always so on an unencrypted
         * (transition-mode) connection, which every server answers as a legacy peer;
         * under encryption, decided by the handshake (see {@link serverPredatesRc1}).
         */
        this.legacyWire = true;
        /** Roles the server activated: `active_roles` of `server/activate`, or of the legacy `server/hello`. */
        this.activeRoles = [];
        /** Activities of the latest `server/activate`; empty before one, and on a legacy connection. */
        this.activities = [];
        /** The first activation arrived, so role messages may go out. */
        this.activated = false;
        /** The initial `client/state` went out, so later activations re-send it in full. */
        this.initialStateSent = false;
        this.timeFilter = new SendspinTimeFilter();
        this.streamActive = false;
        this.outputDelayUs = 0;
        /** Whether this client is available for playback (`client/state.available`). */
        this.available = true;
        /** The player commands of the latest `client/state` sent; a server may send only these (rc1). */
        this.reportedPlayerCommands = [];
        this.readerClosed = false;
        this.timeSyncTimer = null;
        /** The `client/time` exchange awaiting its reply; one at a time, as bursts send them. */
        this.pendingTimeExchange = null;
        this.metadataCallbacks = new Set();
        this.groupCallbacks = new Set();
        this.controllerCallbacks = new Set();
        this.streamStartCallbacks = new Set();
        this.streamEndCallbacks = new Set();
        this.streamClearCallbacks = new Set();
        this.audioChunkCallbacks = new Set();
        this.disconnectCallbacks = new Set();
        this.serverCommandCallbacks = new Set();
        this.sourceCommandCallbacks = new Set();
        this.outputDelayCallbacks = new Set();
        if (roles.includes(Roles.PLAYER) && !options.playerSupport) {
            throw new Error('playerSupport is required when PLAYER role is specified');
        }
        if (roles.includes(Roles.ARTWORK) && !options.artworkSupport && !options.artworkState) {
            throw new Error('artworkSupport or artworkState is required when ARTWORK role is specified');
        }
        if (roles.includes(Roles.SOURCE) && !options.sourceSupport) {
            throw new Error('sourceSupport is required when SOURCE role is specified');
        }
        this.clientId = clientId;
        this.clientName = clientName;
        this.roles = [...roles];
        this.deviceInfo = options.deviceInfo;
        this.playerSupport = options.playerSupport;
        this.artworkSupport = options.artworkSupport;
        this.artworkChannels = options.artworkState?.channels.map((channel) => ({ ...channel }))
            ?? (options.artworkSupport?.channels ?? []).map(artworkStateChannel);
        this.visualizerSupport = options.visualizerSupport;
        this.visualizerState = options.visualizerState ?? visualizerStateFrom(options.visualizerSupport);
        this.sourceSupport = options.sourceSupport;
        this.initialVolume = options.initialVolume ?? 100;
        this.initialMuted = options.initialMuted ?? false;
        this.playerState = { volume: this.initialVolume, muted: this.initialMuted };
        this.requiredLeadTimeMs = clampMs(options.requiredLeadTimeMs ?? 250, 30000);
        this.minBufferMs = clampMs(options.minBufferMs ?? 250, 5000);
        // DEPRECATED(spec-pr-177): commands declared on the hello object are offered in client/state.
        const commands = [...(options.playerSupport?.supported_commands ?? []), ...(options.stateSupportedCommands ?? [])].map((command) => (command === PlayerCommand.SET_STATIC_DELAY ? PlayerCommand.SET_OUTPUT_DELAY : command));
        this.stateSupportedCommands = [...new Set(commands)];
        this.preferredFormat = options.preferredFormat;
        this.encryption = options.encryption;
        this.setOutputDelayMs(options.outputDelayMs ?? options.staticDelayMs ?? 0);
    }
    get info() {
        return this.serverInfo;
    }
    get isConnected() {
        return this.connected && !!this.ws && this.ws.readyState === WebSocket.OPEN;
    }
    /** @deprecated Pre-rc1 name of {@link outputDelayMs}. */
    get staticDelayMs() {
        return this.outputDelayMs;
    }
    /** @deprecated Pre-rc1 name of {@link setOutputDelayMs}. */
    setStaticDelayMs(delayMs) {
        this.setOutputDelayMs(delayMs);
    }
    /** The output delay, in ms: delay after the audio port that playback is moved earlier by. */
    get outputDelayMs() {
        return this.outputDelayUs / 1000;
    }
    /**
     * Set the output delay, clamped to 0-5000 ms as the spec requires. Takes effect
     * for scheduling at once; report it with {@link sendPlayerState} (a server's
     * `set_output_delay` is applied and reported by the client itself).
     */
    setOutputDelayMs(delayMs) {
        const clamped = Number.isFinite(delayMs) ? Math.max(0, Math.min(5000, delayMs)) : 0;
        const delayUs = Math.round(clamped * 1000);
        if (delayUs === this.outputDelayUs)
            return;
        this.outputDelayUs = delayUs;
        for (const cb of [...this.outputDelayCallbacks]) {
            try {
                cb(this.outputDelayMs);
            }
            catch {
                // ignore
            }
        }
    }
    /** Called whenever the output delay changes, including by a server's `set_output_delay`; persist it. */
    addOutputDelayListener(callback) {
        this.outputDelayCallbacks.add(callback);
        return () => this.outputDelayCallbacks.delete(callback);
    }
    async connect(url, { timeoutMs = 10000 } = {}) {
        if (this.isConnected)
            return;
        this.readerClosed = false;
        this.ws = new WebSocket(url);
        this.connected = true;
        const openPromise = new Promise((resolve, reject) => {
            const handleError = (err) => {
                this.ws?.off('open', handleOpen);
                reject(err);
            };
            const handleOpen = () => {
                this.ws?.off('error', handleError);
                resolve();
            };
            this.ws?.once('open', handleOpen);
            this.ws?.once('error', handleError);
        });
        this.ws.on('message', (data, isBinary) => this.handleWsMessage(data, isBinary));
        this.ws.on('close', () => this.disconnect());
        this.ws.on('error', () => this.disconnect());
        const timer = setTimeout(() => {
            this.disconnect();
        }, timeoutMs);
        await openPromise.finally(() => clearTimeout(timer));
        if (this.encryption) {
            /*
             * Encryption reverses the hello order.
             *
             * The server greets first, unprompted, because the identity question is
             * already settled by the handshake — `server/init` carried the key it then
             * proved. Sending our hello first would leave both sides waiting.
             */
            try {
                await this.runNoiseHandshake(timeoutMs);
            }
            catch (err) {
                // A refused or failed handshake leaves nothing to say: close and report it
                // (an `InitRejectedError` carries the server's `server/error` reason).
                await this.disconnect();
                throw err;
            }
            await this.waitForServerHello(timeoutMs);
            await this.sendClientHello();
            /*
             * Nothing else may go out before the first `server/activate` (rc1
             * messaging.md "Communication"); it also says which roles we got. A
             * pre-rc1 server may never send one when it activated nothing, so it gets
             * a short wait and then everything we offered, as before.
             */
            const activated = await this.waitForActivation(this.legacyWire ? Math.min(timeoutMs, 2000) : timeoutMs);
            if (!activated) {
                if (!this.legacyWire) {
                    await this.disconnect();
                    throw new Error('Timed out waiting for server/activate');
                }
                this.activeRoles = [...this.roles];
                this.activated = true;
            }
            if (!this.isConnected)
                throw new Error('Connection closed before activation');
        }
        else {
            await this.sendClientHello();
            await this.waitForServerHello(timeoutMs);
            this.activated = true;
        }
        if (this.legacyWire) {
            await this.sendInitialState();
            this.scheduleTimeSync(0);
            return;
        }
        /*
         * A client with an active player or source MUST NOT send its initial
         * `client/state` until its time filter has converged (spec main #349), so the
         * first state the server sees already reflects a usable clock.
         */
        this.scheduleTimeSync(0);
        if (this.isRoleActive('player') || this.isRoleActive('source')) {
            if (!(await this.waitForTimeSync(timeoutMs))) {
                await this.disconnect();
                throw new Error('Timed out waiting for clock synchronisation');
            }
        }
        await this.sendInitialState();
    }
    /**
     * Say goodbye and close. `reason` tells the server whether to come back:
     * `another_server`, `shutdown` and `user_request` say not to, `restart` to
     * expect us again.
     */
    async goodbye(reason) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            const message = { type: 'client/goodbye', payload: { reason } };
            await this.sendMessage(message).catch(() => { });
        }
        await this.disconnect();
    }
    /** Roles the server activated on this connection (versioned ids). */
    getActiveRoles() {
        return [...this.activeRoles];
    }
    /** Activities the server declared in its latest `server/activate`. */
    getActivities() {
        return [...this.activities];
    }
    /** Whether the server activated any version of role `family` (`'player'`, `'artwork'`…). */
    isRoleActive(family) {
        return this.activeRoles.some((role) => roleFamily(role) === family);
    }
    async disconnect() {
        if (!this.connected && this.ws?.readyState !== WebSocket.OPEN) {
            this.cleanup();
            return;
        }
        this.connected = false;
        this.stopTimeSync();
        if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.readerClosed) {
            this.readerClosed = true;
            await new Promise((resolve) => {
                this.ws?.once('close', resolve);
                this.ws?.close();
                setTimeout(resolve, 100);
            });
        }
        this.cleanup();
    }
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
    async sendInitialState() {
        if (this.legacyWire) {
            if (this.isRoleActive('player')) {
                await this.sendLegacyPlayerState({
                    state: ClientStateType.SYNCHRONIZED,
                    volume: this.playerState.volume,
                    muted: this.playerState.muted,
                    static_delay_ms: Math.round(this.outputDelayUs / 1000),
                    required_lead_time_ms: Math.round(this.requiredLeadTimeMs),
                    min_buffer_ms: Math.round(this.minBufferMs),
                    supported_commands: this.legacyStateCommands(),
                });
            }
        }
        else if (this.activeRoles.length) {
            await this.sendFullState();
        }
        this.initialStateSent = true;
    }
    /**
     * Report player state.
     *
     * The fields given are merged into what this client reports: `volume`, `muted`,
     * `output_delay_ms` (or the old `static_delay_ms`), `required_lead_time_ms`,
     * `min_buffer_ms`, `supported_commands`, `format`, and the old `state` enum as
     * availability. An rc1 server then gets the full player object, as #175
     * requires of every message; a pre-rc1 one gets the fields given, as before.
     */
    async sendPlayerState(state) {
        if (!this.isConnected)
            throw new Error('Client is not connected');
        if (state.volume !== undefined)
            this.playerState.volume = state.volume;
        if (state.muted !== undefined)
            this.playerState.muted = state.muted;
        const delay = state.output_delay_ms ?? state.static_delay_ms;
        if (delay !== undefined)
            this.setOutputDelayMs(delay);
        if (state.required_lead_time_ms !== undefined)
            this.requiredLeadTimeMs = clampMs(state.required_lead_time_ms, 30000);
        if (state.min_buffer_ms !== undefined)
            this.minBufferMs = clampMs(state.min_buffer_ms, 5000);
        if (state.supported_commands !== undefined)
            this.stateSupportedCommands = [...new Set(state.supported_commands)];
        if (state.format !== undefined)
            this.preferredFormat = state.format;
        if (state.state !== undefined)
            this.available = state.state !== ClientStateType.EXTERNAL_SOURCE;
        if (this.legacyWire) {
            await this.sendLegacyPlayerState(state);
            return;
        }
        // Held until the initial state, which then carries it.
        if (!this.initialStateSent)
            return;
        await this.sendFullState();
    }
    /**
     * Change the artwork channels this client wants (rc1 `client/state`, #195). The
     * server answers with a new artwork `stream/start` when its configuration
     * changes. A pre-rc1 server cannot be told after the hello.
     */
    async setArtworkChannels(channels) {
        this.artworkChannels = channels.map((channel) => ({ ...channel }));
        if (this.legacyWire || !this.initialStateSent || !this.isConnected)
            return;
        await this.sendFullState();
    }
    /**
     * Change the visualization wanted (rc1 `client/state`, #195). The server
     * answers with a new visualizer `stream/start` when the stream configuration
     * changes. A pre-rc1 server cannot be told after the hello.
     */
    async setVisualizerState(state) {
        if (state.types.includes('spectrum') && !state.spectrum) {
            throw new Error('a visualizer state requesting spectrum needs a spectrum config');
        }
        this.visualizerState = { ...state };
        if (this.legacyWire || !this.initialStateSent || !this.isConnected)
            return;
        await this.sendFullState();
    }
    /** Report availability: `false` while something else uses the output (an HDMI input, local playback). */
    async sendAvailable(available) {
        if (!this.isConnected)
            throw new Error('Client is not connected');
        // A source going unavailable closes its stream first (roles/source/v1.md).
        if (!available)
            await this.sendClientStreamEnd();
        this.available = available;
        if (this.legacyWire) {
            await this.sendLegacyPlayerState({
                state: available ? ClientStateType.SYNCHRONIZED : ClientStateType.EXTERNAL_SOURCE,
            });
            return;
        }
        if (!this.initialStateSent)
            return;
        await this.sendFullState();
    }
    /** The rc1 player object: every field, every time. */
    fullPlayerState() {
        return {
            volume: this.playerState.volume,
            muted: this.playerState.muted,
            output_delay_ms: Math.round(this.outputDelayUs / 1000),
            required_lead_time_ms: Math.round(this.requiredLeadTimeMs),
            min_buffer_ms: Math.round(this.minBufferMs),
            supported_commands: [...this.stateSupportedCommands],
            ...(this.preferredFormat ? { format: this.preferredFormat } : {}),
        };
    }
    /** An rc1 `client/state`: availability and the full object of each active role that has one. */
    buildFullState() {
        const payload = { available: this.available };
        if (this.isRoleActive('player'))
            payload.player = this.fullPlayerState();
        if (this.isRoleActive('artwork'))
            payload.artwork = { channels: this.artworkChannels.map((c) => ({ ...c })) };
        if (this.isRoleActive('source'))
            payload.source = { ...this.sourceState };
        // Only visualizer@v1 has the object; the draft wire is configured in its hello.
        if (this.activeRoles.includes(Roles.VISUALIZER)) {
            payload.visualizer = this.visualizerState ?? { types: [], rate_max: 30 };
        }
        return payload;
    }
    async sendFullState() {
        const payload = this.buildFullState();
        await this.sendMessage({ type: 'client/state', payload });
        if (payload.player)
            this.reportedPlayerCommands = payload.player.supported_commands ?? [];
    }
    /**
     * The state-level player commands of the pre-rc1 wire: `set_static_delay`, if
     * the delay command is offered. Pre-rc1 servers refuse a state naming any other
     * (aiosendspin 9 validates the list), and take volume and mute from the hello.
     */
    legacyStateCommands() {
        return this.stateSupportedCommands.includes(PlayerCommand.SET_OUTPUT_DELAY) ? [PlayerCommand.SET_STATIC_DELAY] : [];
    }
    /** A pre-rc1 `client/state`, exactly as this client always sent it. */
    async sendLegacyPlayerState(state) {
        const { state: clientState, ...playerState } = state;
        /*
         * Report availability in both spellings while the transition lasts.
         *
         * `available` superseded the `state` enum, which could only ever say "busy
         * elsewhere". A server reading only the boolean would otherwise never hear a
         * client that reports being busy, and one reading only the enum would miss it
         * the other way round — so send both, as the reference clients do.
         */
        const message = {
            type: 'client/state',
            payload: {
                ...(clientState
                    ? { available: clientState !== ClientStateType.EXTERNAL_SOURCE, state: clientState }
                    : {}),
                ...(Object.keys(playerState).length ? { player: playerState } : {}),
            },
        };
        await this.sendMessage(message);
    }
    /**
     * Report source state.
     *
     * On an rc1 connection the source object is `{signal, level?}` (the old `state`
     * is dropped), held and carried in every `client/state` while the source role
     * is active, with `available`; the server may take a change of `signal` as its
     * cue to send `start` or `stop`. A pre-rc1 server gets the object as given.
     */
    async sendSourceState(state) {
        if (!this.isConnected)
            throw new Error('Client is not connected');
        if (this.legacyWire) {
            const message = {
                type: 'client/state',
                payload: {
                    source: state,
                },
            };
            await this.sendMessage(message);
            return;
        }
        this.sourceState = {
            signal: state.signal ?? this.sourceState.signal,
            ...(state.level !== undefined ? { level: state.level } : {}),
        };
        if (!this.initialStateSent)
            return;
        await this.sendFullState();
    }
    /**
     * Open the source stream: announce the format of the source audio about to be
     * sent with {@link sendSourceAudioChunk}. Send it after the server's source
     * `start` command (rc1 roles/source/v1.md). `client-stream/start` since rc1
     * (#163); a pre-rc1 server gets `client_stream/start`.
     */
    async sendClientStreamStart(source) {
        if (!this.isConnected)
            throw new Error('Client is not connected');
        const message = {
            type: this.legacyWire ? 'client_stream/start' : 'client-stream/start',
            payload: { source },
        };
        await this.sendMessage(message);
        this.sourceStreamActive = true;
    }
    /** Close the source stream (`client-stream/end`; `client_stream/end` to a pre-rc1 server). */
    async sendClientStreamEnd() {
        if (!this.isConnected || !this.sourceStreamActive)
            return;
        this.sourceStreamActive = false;
        const message = {
            type: this.legacyWire ? 'client_stream/end' : 'client-stream/end',
            payload: {},
        };
        await this.sendMessage(message);
    }
    /**
     * Leave the current group, e.g. for interruptible local playback, staying
     * available (`client/leave`, rc1 #209). The server moves this client to a solo,
     * stopped group, back only through a `switch`. A pre-rc1 server has no such
     * message; it gets the availability flap that meant the same thing there.
     */
    async sendLeave() {
        if (!this.isConnected)
            throw new Error('Client is not connected');
        if (this.legacyWire) {
            await this.sendLegacyPlayerState({ state: ClientStateType.EXTERNAL_SOURCE });
            await this.sendLegacyPlayerState({ state: ClientStateType.SYNCHRONIZED });
            return;
        }
        await this.sendMessage({ type: 'client/leave', payload: {} });
    }
    /** Whether a source stream is open (between client-stream start and end). */
    get isSourceStreamActive() {
        return this.sourceStreamActive;
    }
    async sendGroupCommand(command, opts = {}) {
        if (!this.isConnected)
            throw new Error('Client is not connected');
        const controllerPayload = { command, volume: opts.volume, mute: opts.mute };
        const payload = { controller: controllerPayload };
        const message = { type: 'client/command', payload };
        await this.sendMessage(message);
    }
    async sendSourceCommand(command) {
        if (!this.isConnected)
            throw new Error('Client is not connected');
        const payload = { source: { command } };
        const message = { type: 'client/command', payload };
        await this.sendMessage(message);
    }
    async sendSourceAudioChunk(audioData, opts = {}) {
        if (!this.isConnected)
            throw new Error('Client is not connected');
        const { captureTimestampUs, serverTimestampUs } = opts;
        let timestampUs = serverTimestampUs;
        if (timestampUs == null) {
            if (captureTimestampUs == null) {
                throw new Error('captureTimestampUs or serverTimestampUs must be provided');
            }
            if (!this.timeFilter.isSynchronized) {
                throw new Error('time sync not ready; provide serverTimestampUs explicitly');
            }
            timestampUs = this.computeSourceTimestamp(captureTimestampUs);
        }
        const header = packBinaryHeaderRaw(BinaryMessageType.SOURCE_AUDIO_CHUNK, timestampUs);
        await this.sendBinary(Buffer.concat([header, audioData]));
    }
    addMetadataListener(callback) {
        this.metadataCallbacks.add(callback);
        return () => this.metadataCallbacks.delete(callback);
    }
    addGroupUpdateListener(callback) {
        this.groupCallbacks.add(callback);
        return () => this.groupCallbacks.delete(callback);
    }
    addControllerStateListener(callback) {
        this.controllerCallbacks.add(callback);
        return () => this.controllerCallbacks.delete(callback);
    }
    addStreamStartListener(callback) {
        this.streamStartCallbacks.add(callback);
        return () => this.streamStartCallbacks.delete(callback);
    }
    addStreamEndListener(callback) {
        this.streamEndCallbacks.add(callback);
        return () => this.streamEndCallbacks.delete(callback);
    }
    addStreamClearListener(callback) {
        this.streamClearCallbacks.add(callback);
        return () => this.streamClearCallbacks.delete(callback);
    }
    addAudioChunkListener(callback) {
        this.audioChunkCallbacks.add(callback);
        return () => this.audioChunkCallbacks.delete(callback);
    }
    /** Artwork images as they complete; see {@link ArtworkCallback}. */
    addArtworkListener(callback) {
        this.artworkCallbacks.add(callback);
        return () => this.artworkCallbacks.delete(callback);
    }
    addDisconnectListener(callback) {
        this.disconnectCallbacks.add(callback);
        return () => this.disconnectCallbacks.delete(callback);
    }
    addServerCommandListener(callback) {
        this.serverCommandCallbacks.add(callback);
        return () => this.serverCommandCallbacks.delete(callback);
    }
    addSourceCommandListener(callback) {
        this.sourceCommandCallbacks.add(callback);
        return () => this.sourceCommandCallbacks.delete(callback);
    }
    isTimeSynchronized() {
        return this.timeFilter.isSynchronized;
    }
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
    computePlayTime(serverTimestampUs) {
        if (this.timeFilter.isSynchronized) {
            const clientTime = this.timeFilter.computeClientTime(serverTimestampUs);
            return clientTime - this.outputDelayUs;
        }
        return this.nowUs() + 500_000 - this.outputDelayUs;
    }
    /** The inverse of computePlayTime: add the static delay back before converting to server time. */
    computeServerTime(clientTimestampUs) {
        const adjusted = clientTimestampUs + this.outputDelayUs;
        return this.timeFilter.computeServerTime(adjusted);
    }
    computeSourceTimestamp(captureTimestampUs) {
        return this.timeFilter.computeServerTime(captureTimestampUs);
    }
    /**
     * Run the cleartext init exchange and the KKpsk2 handshake, then switch to
     * transport mode.
     *
     * Driven with its own frame listener rather than through the normal dispatch: the
     * bring-up frames are cleartext and strictly ordered, and mixing them into the
     * application router would mean teaching that router about states it never sees
     * again once the handshake is done.
     */
    async runNoiseHandshake(timeoutMs) {
        const encryption = this.encryption;
        if (!encryption || !this.ws)
            return;
        const driver = beginClientHandshake({
            identity: encryption.identity,
            suite: encryption.suite ?? '25519_ChaChaPoly_SHA256',
            pskResolver: encryption.pskResolver,
            expectedServerId: encryption.expectedServerId,
        });
        const ws = this.ws;
        const frames = [];
        let notify = null;
        const onFrame = (data, isBinary) => {
            if (isBinary)
                return; // Handshake frames are TEXT; transport frames come later.
            frames.push(data.toString());
            notify?.();
        };
        ws.on('message', onFrame);
        const nextFrame = async (what) => {
            const deadline = Date.now() + timeoutMs;
            while (!frames.length) {
                if (Date.now() > deadline)
                    throw new Error(`Timed out waiting for ${what}`);
                await new Promise((resolve) => {
                    notify = resolve;
                    setTimeout(resolve, 50);
                });
                notify = null;
            }
            return frames.shift();
        };
        try {
            ws.send(driver.clientInit);
            driver.onServerInit(await nextFrame('server/init'));
            const { send, result } = await driver.onMessage1(await nextFrame('Noise message 1'));
            ws.send(send);
            this.transport = result.transport;
            this.authenticatedServerId = result.serverId;
            this.pskCategory = result.psk.category;
            this.legacyWire = this.serverPredatesRc1(result);
            // A pre-rc1 server reads only the `2`/`3` fragment framing; rc1 uses type 1 (#172).
            this.transport.legacyFragmentFraming = this.legacyWire;
        }
        finally {
            ws.off('message', onFrame);
            // Anything that arrived while we were still swapping listeners is a transport
            // frame and must not be dropped.
            for (const frame of frames) {
                this.handleWsMessage(Buffer.from(frame));
            }
        }
    }
    /**
     * Whether the server predates 1.0.0-rc1.
     *
     * rc1 requires message 1 to name its PSK's `psk_category`, and every server
     * that speaks the rc1 wire does (aiosendspin 10.x, node-sendspin after 0.6);
     * one that leaves it out is node-sendspin 0.6 or earlier, which reads the
     * hello's `supported_commands` and `artwork@v1_support`, sends 9-byte audio
     * headers and single-message artwork, and fragments with IDs 2/3.
     */
    serverPredatesRc1(result) {
        return !result.pskCategoryNamed;
    }
    /**
     * Whether this connection speaks the pre-rc1 wire: always when unencrypted,
     * and under encryption when the server predates 1.0.0-rc1. Settled once the
     * handshake completes.
     */
    isLegacyWire() {
        return this.legacyWire;
    }
    /** Whether this connection carries its application messages under Noise. */
    get isEncrypted() {
        return this.transport !== null;
    }
    /** The server's authenticated `server_id`, or undefined on an unencrypted connection. */
    get encryptedServerId() {
        return this.authenticatedServerId;
    }
    /**
     * How this connection was admitted. `SENTINEL` means the published constant PSK
     * did it: confidential, but authenticating nothing.
     */
    get admittedWith() {
        return this.pskCategory;
    }
    /** Resolves true once the first `server/activate` has been applied, false on timeout. */
    async waitForActivation(timeoutMs) {
        if (this.activated)
            return true;
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.activationResolve = undefined;
                resolve(false);
            }, timeoutMs);
            this.activationResolve = () => {
                clearTimeout(timeout);
                resolve(true);
            };
        });
    }
    async waitForServerHello(timeoutMs) {
        if (this.serverInfo)
            return;
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timed out waiting for server/hello'));
            }, timeoutMs);
            this.serverHelloResolve = () => {
                clearTimeout(timeout);
                resolve();
            };
        });
    }
    async sendClientHello() {
        const message = { type: 'client/hello', payload: this.buildClientHello() };
        await this.sendMessage(message);
    }
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
    buildClientHello() {
        const encrypted = this.transport !== null;
        if (encrypted && !this.legacyWire) {
            const player = this.playerSupport
                ? { supported_formats: this.playerSupport.supported_formats, buffer_capacity: this.playerSupport.buffer_capacity }
                : undefined;
            const visualizer = this.visualizerSupport ? { buffer_capacity: this.visualizerSupport.buffer_capacity } : undefined;
            return {
                name: this.clientName,
                supported_roles: this.roles,
                device_info: this.deviceInfo,
                supported_pair_methods: { pairing_psk: {} },
                // We do not pair, so the honest answer is "unpaired welcome".
                unpaired_access: { enabled: true },
                ['player@v1_support']: this.roles.includes(Roles.PLAYER) ? player : undefined,
                ['visualizer@v1_support']: this.roles.includes(Roles.VISUALIZER) ? visualizer : undefined,
                ['visualizer@_draft_r1_support']: this.roles.includes(Roles.VISUALIZER_DRAFT_R1)
                    ? this.visualizerSupport
                    : undefined,
                ['source@v1_support']: this.roles.includes(Roles.SOURCE) ? this.sourceSupport : undefined,
            };
        }
        return {
            /*
             * Under encryption the identity came from `client/init` and the handshake
             * proved it, so repeating it here is at best redundant and at worst a
             * contradiction the server has to refuse. Same for `version`.
             */
            ...(encrypted ? {} : { client_id: this.clientId, version: 1 }),
            name: this.clientName,
            supported_roles: this.roles,
            device_info: this.deviceInfo,
            // We do not pair, so the honest answers are "no trust" and "unpaired welcome".
            ...(encrypted ? { unpaired_access: { enabled: true } } : {}),
            ['player@v1_support']: this.roles.includes(Roles.PLAYER) ? this.playerSupport : undefined,
            ['artwork@v1_support']: this.roles.includes(Roles.ARTWORK) ? this.legacyArtworkSupport() : undefined,
            // `Roles.VISUALIZER` is `visualizer@v1`, so its support object belongs under the
            // versioned key; the draft key would have the server parse it as the other wire.
            ['visualizer@v1_support']: this.roles.includes(Roles.VISUALIZER)
                ? this.legacyVisualizerSupport()
                : undefined,
            ['visualizer@_draft_r1_support']: this.roles.includes(Roles.VISUALIZER_DRAFT_R1)
                ? this.visualizerSupport
                : undefined,
            ['source@v1_support']: this.roles.includes(Roles.SOURCE) ? this.sourceSupport : undefined,
        };
    }
    /** A pre-rc1 hello carries the visualizer config in its support object; add `visualizerState` there. */
    legacyVisualizerSupport() {
        if (!this.visualizerSupport)
            return undefined;
        // Exactly as given when nothing beyond it was configured.
        if (!this.visualizerState || 'types' in this.visualizerSupport)
            return this.visualizerSupport;
        return { ...this.visualizerSupport, ...this.visualizerState };
    }
    /** The hello artwork object for a pre-rc1 server: as given, or derived from `artworkState`. */
    legacyArtworkSupport() {
        if (this.artworkSupport)
            return this.artworkSupport;
        return {
            channels: this.artworkChannels.map((channel) => ({
                source: channel.source,
                format: (channel.format ?? 'jpeg'),
                media_width: channel.width ?? 0,
                media_height: channel.height ?? 0,
            })),
        };
    }
    /** One `client/time` exchange: the measurement of its reply, or null if none came in time. */
    async timeExchange(timeoutMs) {
        if (!this.isConnected)
            return null;
        return new Promise((resolve) => {
            const finish = (sample) => {
                clearTimeout(timer);
                if (this.pendingTimeExchange?.finish === finish)
                    this.pendingTimeExchange = null;
                resolve(sample);
            };
            const timer = setTimeout(() => finish(null), timeoutMs);
            const clientTransmitted = this.nowUs();
            this.pendingTimeExchange = { clientTransmitted, finish };
            const message = { type: 'client/time', payload: { client_transmitted: clientTransmitted } };
            this.sendMessage(message).catch(() => finish(null));
        });
    }
    /**
     * One burst (messaging.md "Clock Synchronization", spec main): at least 8
     * `client/time` messages, each sent once the previous reply arrived, and only
     * the measurement with the lowest `max_error` goes into the filter. A burst a
     * server stops answering ends early with what it has.
     */
    async runTimeBurst() {
        let best = null;
        for (let i = 0; i < TIME_BURST_SIZE && this.isConnected; i += 1) {
            const sample = await this.timeExchange(TIME_REPLY_TIMEOUT_MS);
            if (!sample)
                break;
            if (sample.maxError > 0 && (!best || sample.maxError < best.maxError))
                best = sample;
        }
        if (!best || !this.isConnected)
            return;
        this.timeFilter.update(best.measurement, best.maxError, best.receivedUs);
        if (this.timeFilter.isSynchronized) {
            const wake = this.timeSyncResolve;
            this.timeSyncResolve = undefined;
            wake?.();
        }
    }
    /** Resolves true once the time filter has converged, false on timeout. */
    async waitForTimeSync(timeoutMs) {
        if (this.timeFilter.isSynchronized)
            return true;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.timeSyncResolve = undefined;
                resolve(false);
            }, timeoutMs);
            this.timeSyncResolve = () => {
                clearTimeout(timer);
                resolve(this.timeFilter.isSynchronized);
            };
        });
    }
    async sendMessage(message) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket is not connected');
        }
        if (this.transport && !this.activated && message.type !== 'client/hello' && message.type !== 'client/goodbye') {
            // rc1 messaging.md "Communication": nothing but the hello (or a goodbye) before activation.
            throw new Error(`${message.type} cannot be sent before server/activate`);
        }
        const data = JSON.stringify(message);
        if (this.transport) {
            for (const frame of this.transport.encodeText(data)) {
                this.ws.send(frame);
            }
            return;
        }
        this.ws.send(data);
    }
    async sendBinary(payload) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket is not connected');
        }
        if (this.transport) {
            for (const frame of this.transport.encodeBinary(payload)) {
                this.ws.send(frame);
            }
            return;
        }
        this.ws.send(payload);
    }
    /**
     * Route one frame from the socket.
     *
     * `isBinary` is the only reliable way to tell a text frame from a binary one: `ws`
     * hands both to the listener as a Buffer, so the `typeof data === 'string'` test
     * this used was never true and every JSON message on an unencrypted connection was
     * fed to the audio-chunk path instead. It went unnoticed because the app drives the
     * server half, and the encrypted path reads its frames elsewhere.
     */
    handleWsMessage(data, isBinary = true) {
        const receivedUs = this.nowUs();
        if (this.transport) {
            this.handleEncryptedFrame(Buffer.from(data), receivedUs);
            return;
        }
        if (!isBinary) {
            void this.handleJsonMessage(data.toString(), receivedUs);
            return;
        }
        if (data instanceof Buffer || data instanceof Uint8Array) {
            this.handleBinaryMessage(Buffer.from(data));
            return;
        }
    }
    /** Decrypt one transport frame and route it as if it had arrived in the clear. */
    handleEncryptedFrame(frame, receivedUs = this.nowUs()) {
        if (!this.transport)
            return;
        let decoded;
        try {
            decoded = this.transport.decode(frame);
        }
        catch {
            // A frame that fails authentication is not recoverable: drop the connection
            // rather than carry on with a peer we can no longer verify.
            void this.disconnect();
            return;
        }
        if (!decoded)
            return; // A fragment; the message is still being assembled.
        if (decoded.kind === 'text') {
            void this.handleJsonMessage(decoded.data, receivedUs);
            return;
        }
        this.handleBinaryMessage(decoded.data);
    }
    async handleJsonMessage(raw, receivedUs = this.nowUs()) {
        let message;
        try {
            message = JSON.parse(raw);
        }
        catch (err) {
            return;
        }
        switch (message.type) {
            case 'server/hello':
                this.handleServerHello(message.payload);
                break;
            case 'server/activate':
                await this.handleServerActivate(message.payload);
                break;
            case 'server/time':
                this.handleServerTime(message.payload, receivedUs);
                break;
            case 'stream/start':
                await this.handleStreamStart(message);
                break;
            case 'stream/clear':
                this.handleStreamClear(message);
                break;
            case 'stream/end':
                this.handleStreamEnd(message);
                break;
            case 'group/update':
                this.handleGroupUpdate(message.payload);
                break;
            case 'server/state':
                this.handleServerState(message.payload);
                break;
            case 'server/command':
                await this.handleServerCommand(message.payload);
                break;
            default:
                break;
        }
    }
    handleBinaryMessage(payload) {
        if (!payload.length)
            return;
        const messageType = payload[0];
        if (messageType >= BinaryMessageType.ARTWORK_CHANNEL_0 && messageType <= BinaryMessageType.ARTWORK_CHANNEL_3) {
            this.handleArtworkMessage(messageType - BinaryMessageType.ARTWORK_CHANNEL_0, payload);
            return;
        }
        if (messageType === BinaryMessageType.AUDIO_CHUNK) {
            if (!this.streamActive)
                return;
            if (this.legacyWire) {
                if (payload.length < BINARY_HEADER_SIZE)
                    return;
                const header = unpackBinaryHeader(payload);
                this.handleAudioChunk(header.timestampUs, payload.subarray(BINARY_HEADER_SIZE));
                return;
            }
            // rc1 (#167): `[0x04][timestamp int64][send_ahead uint32][payload]`.
            if (payload.length < PLAYER_AUDIO_HEADER_SIZE)
                return;
            const audio = unpackPlayerAudioHeader(payload);
            this.handleAudioChunk(audio.timestampUs, payload.subarray(PLAYER_AUDIO_HEADER_SIZE), audio.sendAheadUs);
        }
    }
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
    handleArtworkMessage(channel, payload) {
        if (this.legacyWire) {
            if (!this.artworkStreamActive || payload.length < BINARY_HEADER_SIZE)
                return;
            const header = unpackBinaryHeader(payload);
            this.showArtwork(channel, Buffer.from(payload.subarray(BINARY_HEADER_SIZE)), header.timestampUs);
            return;
        }
        const malformed = malformedArtworkMessage(payload);
        if (malformed) {
            this.closeOnProtocolError(`malformed artwork message: ${malformed}`);
            return;
        }
        if (!this.artworkStreamActive)
            return;
        const flags = payload[1];
        if (flags & ARTWORK_FLAG_CANCEL) {
            this.discardPendingArtwork(channel);
            return;
        }
        if (flags & ARTWORK_FLAG_ANNOUNCE) {
            if (this.artworkInFlight !== null) {
                this.closeOnProtocolError('artwork announce while a transfer is in flight');
                return;
            }
            const timestampUs = Number(payload.readBigInt64BE(2));
            const totalSize = payload.readUInt32BE(10);
            this.discardPendingArtwork(channel);
            if (totalSize === 0) {
                this.showArtwork(channel, Buffer.alloc(0), timestampUs);
                return;
            }
            this.artworkPending.set(channel, { timestampUs, totalSize, parts: [], received: 0 });
            this.artworkInFlight = channel;
            return;
        }
        const pending = this.artworkPending.get(channel);
        if (this.artworkInFlight !== channel || !pending) {
            this.closeOnProtocolError(`artwork part on channel ${channel} with no transfer in flight there`);
            return;
        }
        const data = payload.subarray(2);
        pending.received += data.length;
        if (pending.received > pending.totalSize) {
            this.closeOnProtocolError('artwork part extends past total_size');
            return;
        }
        pending.parts.push(Buffer.from(data));
        if (pending.received === pending.totalSize) {
            this.artworkPending.delete(channel);
            this.artworkInFlight = null;
            this.showArtwork(channel, Buffer.concat(pending.parts), pending.timestampUs);
        }
    }
    discardPendingArtwork(channel) {
        this.artworkPending.delete(channel);
        if (this.artworkInFlight === channel)
            this.artworkInFlight = null;
    }
    showArtwork(channel, image, timestampUs) {
        if (image.length)
            this.artworkShown.add(channel);
        else
            this.artworkShown.delete(channel);
        for (const cb of [...this.artworkCallbacks]) {
            try {
                cb(channel, image, timestampUs);
            }
            catch {
                // ignore
            }
        }
    }
    /** The server broke the protocol: the spec has the client close the connection. */
    closeOnProtocolError(_reason) {
        void this.disconnect();
    }
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
    async handleServerActivate(payload) {
        if (!this.transport)
            return; // Only an encrypted connection is activated.
        const activities = Array.isArray(payload?.activities) ? payload.activities.map(String) : [];
        const allowed = this.pskCategory === PskCategory.LONG_TERM ? ['playback'] : ['playback', 'pairing'];
        const playbackCapable = allowed.includes('playback');
        const roles = Array.isArray(payload?.active_roles)
            ? payload.active_roles.map(String)
            : playbackCapable
                ? this.activeRoles
                : [];
        if (activities.some((activity) => !allowed.includes(activity)) || (roles.length && !playbackCapable)) {
            await this.goodbye(GoodbyeReason.UNAUTHORIZED);
            return;
        }
        const previous = this.activeRoles;
        this.activities = activities;
        this.activeRoles = roles;
        this.endRemovedRoleStreams(previous, roles);
        // A removed source role stops sending and closes its stream (rc1 messaging.md).
        if (this.sourceStreamActive && !roles.some((role) => roleFamily(role) === 'source')) {
            await this.sendClientStreamEnd().catch(() => { });
        }
        if (!this.activated) {
            this.activated = true;
            this.activationResolve?.();
            this.activationResolve = undefined;
            return;
        }
        const added = roles.some((role) => !previous.includes(role));
        if (added && this.initialStateSent) {
            await this.sendInitialState().catch(() => { });
        }
    }
    /** A `server/activate` removed roles: their streams end as if by `stream/end`. */
    endRemovedRoleStreams(previous, next) {
        const removed = new Set(previous.filter((role) => !next.includes(role)).map(roleFamily).filter((family) => STREAM_END_ROLE_FAMILIES.includes(family)));
        if (!removed.size)
            return;
        const families = [...removed].sort();
        this.endStreams(families);
        this.notifyStreamEnd(families);
    }
    handleServerHello(payload) {
        /*
         * Under encryption the hello is only `{name}` — the id came from `server/init`
         * and the handshake proved it, so take it from there rather than from a field
         * the message no longer carries.
         */
        this.serverInfo = {
            serverId: this.authenticatedServerId ?? payload.server_id,
            name: payload.name,
            version: payload.version ?? 1,
        };
        // Unencrypted, the legacy hello itself names the active roles.
        if (!this.transport) {
            this.activeRoles = Array.isArray(payload.active_roles) ? payload.active_roles.map(String) : [...this.roles];
        }
        this.serverHelloResolve?.();
        this.serverHelloResolve = undefined;
    }
    /**
     * A `server/time` reply, taken with the time its frame arrived (spec main #298,
     * "Receive timestamps": at transport arrival, before decryption). Only the reply
     * to the exchange in flight counts; the burst decides what the filter gets.
     */
    handleServerTime(payload, receivedUs) {
        const pending = this.pendingTimeExchange;
        if (!pending || payload?.client_transmitted !== pending.clientTransmitted)
            return;
        const { measurement, maxError } = SendspinTimeFilter.measure(payload, receivedUs);
        pending.finish({ measurement, maxError, receivedUs });
    }
    /**
     * A `stream/start` starts a stream or reconfigures a running one. Listeners
     * hear every one that carries an artwork or visualizer object (the new
     * configuration is the only place a reconfiguration shows) and every one that
     * starts the player stream; a player-only format update stays internal, as it
     * always has.
     */
    async handleStreamStart(message) {
        const { player, artwork, visualizer } = message.payload;
        let notify = !!artwork || !!visualizer;
        if (visualizer)
            this.visualizerStreamActive = true;
        if (artwork) {
            // A new configuration replaces the stream's; a transfer under the old one is dropped.
            if (this.artworkStreamActive) {
                for (const channel of [...this.artworkPending.keys()])
                    this.discardPendingArtwork(channel);
            }
            this.artworkStreamActive = true;
        }
        if (player) {
            const isFormatUpdate = this.streamActive && this.currentPlayer;
            this.streamActive = true;
            const pcmFormat = new PCMFormat(player.sample_rate, player.channels, player.bit_depth);
            const codecHeader = player.codec_header ? Buffer.from(player.codec_header, 'base64') : undefined;
            this.configureAudioOutput(new AudioFormat(player.codec, pcmFormat, codecHeader));
            this.currentPlayer = player;
            if (!isFormatUpdate)
                notify = true;
        }
        if (notify)
            this.notifyStreamStart(message);
    }
    handleStreamClear(message) {
        const roles = message.payload.roles;
        if (roles) {
            const invalid = roles.filter((role) => !STREAM_CLEAR_ROLE_FAMILIES.includes(roleFamily(role)));
            if (invalid.length)
                return;
        }
        this.notifyStreamClear(roles);
    }
    handleStreamEnd(message) {
        const roles = message.payload.roles;
        this.endStreams(roles?.map(roleFamily));
        this.notifyStreamEnd(roles);
    }
    /** End the streams of `families` (every stream when undefined). */
    endStreams(families) {
        if (!families || families.includes('player')) {
            this.streamActive = false;
            this.currentPlayer = undefined;
            this.currentAudioFormat = undefined;
        }
        if (!families || families.includes('visualizer')) {
            this.visualizerStreamActive = false;
        }
        if (!families || families.includes('artwork')) {
            // rc1: on an artwork stream/end the client clears its images and drops pending ones.
            this.artworkStreamActive = false;
            for (const channel of [...this.artworkPending.keys()])
                this.discardPendingArtwork(channel);
            this.artworkInFlight = null;
            for (const channel of [...this.artworkShown].sort())
                this.showArtwork(channel, Buffer.alloc(0), 0);
        }
    }
    handleGroupUpdate(payload) {
        for (const cb of [...this.groupCallbacks]) {
            try {
                cb(payload);
            }
            catch (err) {
                // ignore individual callback failures
            }
        }
    }
    handleServerState(payload) {
        for (const cb of [...this.controllerCallbacks]) {
            try {
                cb(payload);
            }
            catch (err) {
                // ignore
            }
        }
        if (payload.metadata) {
            for (const cb of [...this.metadataCallbacks]) {
                try {
                    cb(payload);
                }
                catch (err) {
                    // ignore
                }
            }
        }
    }
    async handleServerCommand(payload) {
        if (payload.player) {
            /*
             * A player command must be one we offered: in the latest `client/state` on an
             * rc1 connection (#177), in the hello on a pre-rc1 one. Anything else is
             * ignored, as the spec has clients do.
             */
            const offered = this.legacyWire
                ? [...(this.playerSupport?.supported_commands ?? []), ...this.legacyStateCommands()]
                : this.reportedPlayerCommands;
            if (!offered.includes(payload.player.command)) {
                const { player: _ignored, ...rest } = payload;
                if (!rest.source)
                    return;
                payload = rest;
            }
        }
        const player = payload.player;
        if (player && (player.command === PlayerCommand.SET_OUTPUT_DELAY || player.command === PlayerCommand.SET_STATIC_DELAY)) {
            // DEPRECATED(spec-pr-164): a pre-rc1 server says `set_static_delay` / `static_delay_ms`.
            const delay = player.output_delay_ms ?? player.static_delay_ms;
            if (typeof delay === 'number') {
                this.setOutputDelayMs(delay);
                // A field changed through a command is reported back like any other change.
                const reported = this.legacyWire
                    ? this.sendLegacyPlayerState({ static_delay_ms: Math.round(this.outputDelayUs / 1000) })
                    : this.initialStateSent
                        ? this.sendFullState()
                        : Promise.resolve();
                await reported.catch(() => { });
            }
        }
        for (const cb of [...this.serverCommandCallbacks]) {
            try {
                cb(payload);
            }
            catch {
                // ignore
            }
        }
        if (payload.source) {
            for (const cb of [...this.sourceCommandCallbacks]) {
                try {
                    cb(payload.source);
                }
                catch {
                    // ignore
                }
            }
        }
    }
    configureAudioOutput(format) {
        this.currentAudioFormat = format;
    }
    handleAudioChunk(timestampUs, payload, sendAheadUs) {
        if (!this.currentAudioFormat)
            return;
        for (const cb of [...this.audioChunkCallbacks]) {
            try {
                cb(timestampUs, payload, this.currentAudioFormat, sendAheadUs);
            }
            catch {
                // ignore individual callback failures
            }
        }
    }
    notifyStreamStart(message) {
        for (const cb of [...this.streamStartCallbacks]) {
            try {
                cb(message);
            }
            catch {
                // ignore
            }
        }
    }
    notifyStreamEnd(roles) {
        for (const cb of [...this.streamEndCallbacks]) {
            try {
                cb(roles);
            }
            catch {
                // ignore
            }
        }
    }
    notifyStreamClear(roles) {
        for (const cb of [...this.streamClearCallbacks]) {
            try {
                cb(roles);
            }
            catch {
                // ignore
            }
        }
    }
    notifyDisconnect() {
        for (const cb of [...this.disconnectCallbacks]) {
            try {
                cb();
            }
            catch {
                // ignore
            }
        }
    }
    scheduleTimeSync(delayMs = this.computeTimeSyncInterval()) {
        this.stopTimeSync();
        this.timeSyncTimer = setTimeout(async () => {
            this.timeSyncTimer = null;
            try {
                await this.runTimeBurst();
            }
            catch {
                // ignore send failures to keep loop alive
            }
            if (this.isConnected && !this.timeSyncTimer)
                this.scheduleTimeSync();
        }, delayMs);
    }
    stopTimeSync() {
        if (this.timeSyncTimer) {
            clearTimeout(this.timeSyncTimer);
            this.timeSyncTimer = null;
        }
    }
    /** Time between bursts: back to back until the filter converges, then by its error, never over 10 s. */
    computeTimeSyncInterval() {
        if (!this.timeFilter.isSynchronized)
            return 0;
        const error = this.timeFilter.error;
        if (error < 1_000)
            return 5000;
        if (error < 2_000)
            return 2000;
        if (error < 5_000)
            return 1000;
        return 500;
    }
    nowUs() {
        return Math.floor(performance.now() * 1000);
    }
    cleanup() {
        this.stopTimeSync();
        this.pendingTimeExchange?.finish(null);
        this.pendingTimeExchange = null;
        const wakeTimeSync = this.timeSyncResolve;
        this.timeSyncResolve = undefined;
        wakeTimeSync?.();
        this.ws?.removeAllListeners();
        this.ws = undefined;
        this.timeFilter.reset();
        this.serverInfo = undefined;
        this.transport = null;
        this.legacyWire = true;
        this.activeRoles = [];
        this.activities = [];
        this.activated = false;
        // Wake a connect() still waiting for activation; it sees the closed socket.
        const wake = this.activationResolve;
        this.activationResolve = undefined;
        wake?.();
        this.initialStateSent = false;
        this.streamActive = false;
        this.currentAudioFormat = undefined;
        this.currentPlayer = undefined;
        this.visualizerStreamActive = false;
        this.sourceStreamActive = false;
        this.artworkStreamActive = false;
        this.artworkPending.clear();
        this.artworkInFlight = null;
        this.artworkShown.clear();
        this.notifyDisconnect();
    }
}
