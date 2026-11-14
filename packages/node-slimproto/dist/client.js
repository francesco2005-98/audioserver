import { ButtonCode, CODEC_MAPPING, DEVICE_TYPE, EventType, FORMAT_BYTE, PCM_SAMPLE_RATE, PCM_SAMPLE_SIZE, PlayerState, RemoteCode, TransitionType, } from './models.js';
import { FALLBACK_CODECS, FALLBACK_MODEL, FALLBACK_SAMPLE_RATE, FALLLBACK_FIRMWARE, HEARTBEAT_INTERVAL, } from './constants.js';
import { UnsupportedContentType } from './errors.js';
import { SlimProtoVolume } from './volume.js';
import { ipToInt, lookupHost, parseCapabilities, parseHeaders, parseStatus } from './util.js';
export class SlimClient {
    socket;
    callback;
    remoteAddress;
    remotePort;
    volumeControl = new SlimProtoVolume();
    buffer = Buffer.alloc(0);
    _connected = false;
    _playerId = '';
    _deviceType = '';
    capabilities = {};
    _deviceName = '';
    _powered = false;
    _muted = false;
    _state = PlayerState.STOPPED;
    _jiffies = 0;
    _lastTimestamp = 0;
    _elapsedMs = 0;
    _currentMedia = null;
    _bufferingMedia = null;
    _nextMedia = null;
    _autoPlay = false;
    _heartbeatTimer = null;
    _heartbeatId = 0;
    heartbeatSentAt = new Map();
    pendingClockSync = new Map();
    clockBase = null;
    constructor(socket, callback) {
        this.socket = socket;
        this.callback = callback;
        this.remoteAddress = socket.remoteAddress ?? undefined;
        this.remotePort = socket.remotePort ?? undefined;
        this.socket.on('data', (data) => this.onData(data));
        this.socket.on('close', () => this.handleDisconnect());
        this.socket.on('error', () => this.handleDisconnect());
    }
    disconnect() {
        if (this.socket.destroyed) {
            return;
        }
        this.socket.destroy();
        this.handleDisconnect();
    }
    get connected() {
        return this._connected;
    }
    get playerId() {
        return this._playerId;
    }
    get deviceType() {
        return this._deviceType;
    }
    get name() {
        if (this._deviceName)
            return this._deviceName;
        return `${this._deviceType || FALLBACK_MODEL}: ${this._playerId}`;
    }
    get deviceAddress() {
        return this.remoteAddress;
    }
    get devicePort() {
        return this.remotePort;
    }
    get state() {
        return this._state;
    }
    get currentMedia() {
        return this._currentMedia;
    }
    get supportedCodecs() {
        const codecs = this.capabilities.SupportedCodecs;
        return Array.isArray(codecs) ? codecs : FALLBACK_CODECS;
    }
    get maxSampleRate() {
        const rate = this.capabilities.MaxSampleRate;
        return typeof rate === 'number' ? rate : FALLBACK_SAMPLE_RATE;
    }
    get firmware() {
        const firmware = this.capabilities.Firmware;
        return typeof firmware === 'string' ? firmware : FALLLBACK_FIRMWARE;
    }
    get volumeLevel() {
        return this.volumeControl.volume;
    }
    get elapsedMilliseconds() {
        if (this._state !== PlayerState.PLAYING) {
            return this._elapsedMs;
        }
        return this._elapsedMs + Math.round(Date.now() - this._lastTimestamp);
    }
    get jiffies() {
        return this._jiffies;
    }
    get lastHeartbeatAt() {
        return this._lastTimestamp || null;
    }
    /**
     * Best-effort mapping between server wall clock time (ms) and player jiffies.
     * Derived from `strm t` / `stat STMt` heartbeat exchange.
     */
    get clockSync() {
        return this.clockBase;
    }
    /**
     * Estimate the player jiffies value at the given server time.
     * Returns a 32-bit unsigned timestamp suitable for `unpauseAt`.
     */
    estimateJiffiesAt(serverTimeMs) {
        if (!this.clockBase) {
            return Math.max(0, Math.round(this._jiffies + (serverTimeMs - Date.now()))) >>> 0;
        }
        const delta = Math.round(serverTimeMs - this.clockBase.serverTimeMs);
        const target = this.clockBase.jiffies + delta;
        // Keep within uint32 domain (SlimProto uses 32-bit timestamps).
        return (target >>> 0);
    }
    /**
     * Request an immediate clock sync sample (one `strm t` roundtrip).
     * Resolves true when the matching STMt arrives, false on timeout or disconnect.
     */
    async requestClockSync(timeoutMs = 800) {
        if (!this._connected)
            return false;
        this._heartbeatId += 1;
        const id = this._heartbeatId;
        const sentAt = Date.now();
        this.heartbeatSentAt.set(id, sentAt);
        // Clean up old send timestamps to avoid unbounded growth.
        for (const [key, value] of this.heartbeatSentAt) {
            if (sentAt - value > 60_000) {
                this.heartbeatSentAt.delete(key);
            }
        }
        const result = await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.pendingClockSync.delete(id);
                resolve(false);
            }, Math.max(50, timeoutMs));
            timeout.unref?.();
            this.pendingClockSync.set(id, (ok) => {
                clearTimeout(timeout);
                this.pendingClockSync.delete(id);
                resolve(ok);
            });
            void this.sendStrm({
                command: 't',
                autostart: '0',
                flags: 0,
                replayGain: id,
            }).catch(() => {
                clearTimeout(timeout);
                this.pendingClockSync.delete(id);
                resolve(false);
            });
        });
        return result;
    }
    async stop() {
        if (this._state === PlayerState.STOPPED)
            return;
        await this.sendStrm({ command: 'q', flags: 0 });
        this._state = PlayerState.STOPPED;
        this.signalUpdate();
    }
    async play() {
        if (this._state !== PlayerState.PAUSED)
            return;
        await this.sendStrm({ command: 'u', flags: 0 });
        this._state = PlayerState.PLAYING;
        this.signalUpdate();
    }
    async pause() {
        if (this._state !== PlayerState.PLAYING && this._state !== PlayerState.BUFFERING)
            return;
        await this.sendStrm({ command: 'p' });
        this._state = PlayerState.PAUSED;
        this.signalUpdate();
    }
    async pauseFor(millis) {
        const duration = Math.max(0, Math.round(millis));
        if (!duration)
            return;
        await this.sendStrm({ command: 'p', replayGain: duration });
    }
    async skipOver(millis) {
        const duration = Math.max(0, Math.round(millis));
        if (!duration)
            return;
        await this.sendStrm({ command: 'a', replayGain: duration });
    }
    async unpauseAt(timestamp) {
        const ts = Math.max(0, Math.round(timestamp));
        await this.sendStrm({ command: 'u', replayGain: ts });
    }
    async power(powered = true) {
        if (this._powered === powered)
            return;
        if (!powered) {
            await this.stop();
        }
        const powerInt = powered ? 1 : 0;
        await this.sendFrame('aude', Buffer.from([powerInt, 1]));
        this._powered = powered;
        this.signalUpdate();
    }
    async volumeSet(volumeLevel) {
        if (volumeLevel === this.volumeControl.volume)
            return;
        this.volumeControl.volume = volumeLevel;
        await this.sendAudg();
        this.signalUpdate();
    }
    async volumeUp() {
        this.volumeControl.increment();
        await this.sendAudg();
        this.signalUpdate();
    }
    async volumeDown() {
        this.volumeControl.decrement();
        await this.sendAudg();
        this.signalUpdate();
    }
    async mute(muted = false) {
        if (this._muted === muted)
            return;
        const mutedInt = muted ? 0 : 1;
        await this.sendFrame('aude', Buffer.from([mutedInt, 0]));
        this._muted = muted;
        this.signalUpdate();
    }
    async playUrl(url, mimeType, metadata, transition = TransitionType.NONE, transitionDuration = 0, enqueue = false, autostart = true, sendFlush = true) {
        if (!url.startsWith('http')) {
            throw new UnsupportedContentType(`Invalid URL: ${url}`);
        }
        if (sendFlush) {
            await this.sendStrm({ command: 'f', autostart: '0' });
            await this.sendStrm({ command: 'q', flags: 0 });
        }
        const mediaDetails = {
            url,
            mimeType: mimeType ?? undefined,
            metadata: metadata ?? {},
            transition,
            transitionDuration,
        };
        if (enqueue) {
            this._nextMedia = mediaDetails;
            this.signalUpdate();
            return;
        }
        this._bufferingMedia = mediaDetails;
        this.signalUpdate();
        if (!this._powered) {
            await this.power(true);
        }
        this._state = PlayerState.BUFFERING;
        const parsed = new URL(url);
        let scheme = parsed.protocol.replace(':', '');
        let host = parsed.hostname;
        let port = parsed.port ? Number(parsed.port) : scheme === 'https' ? 443 : 80;
        let path = parsed.pathname;
        if (parsed.search) {
            path += parsed.search;
        }
        const canHttpsRaw = String(this.capabilities.CanHTTPS ?? '').toLowerCase();
        const canHttps = canHttpsRaw === '1' || canHttpsRaw === 'true' || canHttpsRaw === 'yes';
        if (scheme === 'https' && !canHttps) {
            url = url.replace(/^https:/i, 'http:');
            scheme = 'http';
            port = 80;
        }
        if (!mimeType) {
            for (const ext of [url.slice(-3), url.split('.').pop() ?? '']) {
                const candidate = `audio/${ext}`;
                if (CODEC_MAPPING[candidate]) {
                    mimeType = candidate;
                    break;
                }
            }
        }
        const codecDetails = mimeType ? this.parseCodc(mimeType) : Buffer.from('?????');
        const ipAddress = await lookupHost(host);
        const hostHeader = port === 80 || port === 443 ? host : `${host}:${port}`;
        const httpreq = Buffer.from(`GET ${path} HTTP/1.0\r\n` +
            `Host: ${hostHeader}\r\n` +
            'Connection: close\r\n' +
            'Accept: */*\r\n' +
            'Cache-Control: no-cache\r\n' +
            'User-Agent: VLC/3.0.9 LibVLC/3.0.9\r\n' +
            'Range: bytes=0-\r\n' +
            '\r\n', 'ascii');
        this._autoPlay = autostart;
        const isSyncGroup = parsed.searchParams.has('sync') && parsed.searchParams.has('expect');
        const expectCount = isSyncGroup ? Number(parsed.searchParams.get('expect') ?? '0') : 0;
        // For sync-groups we want BUFFER_READY quickly so we can do coordinated unpause.
        // With MP3 @ 256kbps, 200KB threshold can take ~6s to fill; lowering keeps groups snappy.
        const thresholdKb = isSyncGroup ? (expectCount === 1 ? 32 : 64) : 200;
        // For sync-groups we prefer a bit more output buffer to avoid early underruns,
        // especially with lossless streams or weaker WiFi links.
        // However, `expect=1` is also used for single-player "alert" playback, where startup
        // latency matters more than underrun protection. Keep output buffering near zero there.
        const outputThreshold = isSyncGroup ? (expectCount === 1 ? 0 : 50) : 20;
        await this.sendStrm({
            command: 's',
            codecDetails,
            autostart: autostart ? '3' : '0',
            serverPort: port,
            serverIp: ipToInt(ipAddress),
            // Amount of input buffer (KB) before autostart or BUFFER_READY notification.
            // Match aioslimproto defaults (200KB) for normal playback, but reduce for sync-groups.
            threshold: thresholdKb,
            // Amount of output buffer data before playback starts, in tenths of a second.
            // Increase to reduce early underruns (tradeoff: more startup latency).
            outputThreshold,
            transDuration: transitionDuration,
            transType: transition,
            flags: scheme === 'https' ? 0x20 : 0x00,
            httpreq,
        });
    }
    async sendAudg() {
        const oldGain = this.volumeControl.oldGain();
        const newGain = this.volumeControl.newGain();
        const payload = Buffer.alloc(18);
        payload.writeUInt32BE(oldGain, 0);
        payload.writeUInt32BE(oldGain, 4);
        payload.writeUInt8(1, 8);
        payload.writeUInt8(255, 9);
        payload.writeUInt32BE(newGain, 10);
        payload.writeUInt32BE(newGain, 14);
        await this.sendFrame('audg', payload);
    }
    async sendFrame(command, data) {
        if (this.socket.destroyed) {
            this.handleDisconnect();
            return;
        }
        const cmd = Buffer.from(command, 'ascii');
        const length = data.length + 4;
        const header = Buffer.alloc(2);
        header.writeUInt16BE(length, 0);
        const packet = Buffer.concat([header, cmd, data]);
        await new Promise((resolve) => {
            this.socket.write(packet, () => resolve());
        });
    }
    async sendStrm(options) {
        const data = Buffer.alloc(24);
        let offset = 0;
        const command = options.command ?? 'q';
        const autostart = options.autostart ?? '0';
        const codecDetails = options.codecDetails ?? Buffer.from('p1321', 'ascii');
        const threshold = options.threshold ?? 0;
        const spdif = options.spdif ?? '0';
        const transDuration = options.transDuration ?? 0;
        const transType = options.transType ?? '0';
        const flags = options.flags ?? 0x20;
        const outputThreshold = options.outputThreshold ?? 0;
        const replayGain = options.replayGain ?? 0;
        const serverPort = options.serverPort ?? 0;
        const serverIp = options.serverIp ?? 0;
        data.write(command, offset, 'ascii');
        offset += 1;
        data.write(autostart, offset, 'ascii');
        offset += 1;
        codecDetails.copy(data, offset, 0, 5);
        offset += 5;
        data.writeUInt8(threshold, offset);
        offset += 1;
        data.write(spdif, offset, 'ascii');
        offset += 1;
        data.writeUInt8(transDuration, offset);
        offset += 1;
        data.write(transType, offset, 'ascii');
        offset += 1;
        data.writeUInt8(flags, offset);
        offset += 1;
        data.writeUInt8(outputThreshold, offset);
        offset += 1;
        data.writeUInt8(0, offset);
        offset += 1;
        data.writeUInt32BE(replayGain, offset);
        offset += 4;
        data.writeUInt16BE(serverPort, offset);
        offset += 2;
        data.writeUInt32BE(serverIp, offset);
        const payload = options.httpreq ? Buffer.concat([data, options.httpreq]) : data;
        await this.sendFrame('strm', payload);
    }
    handleDisconnect() {
        if (!this._connected)
            return;
        this._connected = false;
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        this.signalEvent(EventType.PLAYER_DISCONNECTED);
    }
    onData(data) {
        this.buffer = Buffer.concat([this.buffer, data]);
        while (this.buffer.length >= 8) {
            const operation = this.buffer.subarray(0, 4).toString('ascii');
            const length = this.buffer.readUInt32BE(4);
            const packetLength = 8 + length;
            if (this.buffer.length < packetLength) {
                break;
            }
            const payload = this.buffer.subarray(8, packetLength);
            this.buffer = this.buffer.subarray(packetLength);
            const op = operation.replace(/!/g, '').trim().toLowerCase();
            if (!op) {
                continue;
            }
            if (op === 'bye') {
                this.handleDisconnect();
                return;
            }
            switch (op) {
                case 'helo':
                    void this.processHelo(payload);
                    break;
                case 'stat':
                    void this.processStat(payload);
                    break;
                case 'resp':
                    void this.processResp(payload);
                    break;
                case 'setd':
                    this.processSetd(payload);
                    break;
                case 'butn':
                    this.processButn(payload);
                    break;
                case 'ir':
                    this.processIr(payload);
                    break;
                case 'knob':
                    this.processKnob(payload);
                    break;
                case 'dsco':
                    this.processDsco(payload);
                    break;
                default:
                    break;
            }
        }
    }
    async processHelo(data) {
        const devId = data.readUInt8(0);
        const mac = data.subarray(2, 8);
        const deviceMac = Array.from(mac)
            .map((value) => value.toString(16).padStart(2, '0'))
            .join(':');
        this._playerId = deviceMac.toLowerCase();
        this._deviceType = DEVICE_TYPE[devId] ?? 'unknown device';
        this.capabilities = parseCapabilities(data);
        await this.sendFrame('vers', Buffer.from('7.9', 'ascii'));
        await this.sendFrame('setd', Buffer.from([0xfe]));
        await this.sendFrame('setd', Buffer.from([0]));
        await this.power(this._powered);
        await this.volumeSet(this.volumeControl.volume);
        this._connected = true;
        this.startHeartbeat();
        this.signalEvent(EventType.PLAYER_CONNECTED);
    }
    processButn(data) {
        if (data.length < 8)
            return;
        const button = data.readUInt32BE(4);
        if (button === ButtonCode.POWER) {
            void this.togglePower();
            return;
        }
        if (button === ButtonCode.PAUSE) {
            void this.togglePause();
            return;
        }
        if (button === ButtonCode.PLAY) {
            void this.play();
            return;
        }
        if (button === ButtonCode.VOLUME_DOWN) {
            void this.volumeDown();
            return;
        }
        this.signalEvent(EventType.PLAYER_BTN_EVENT, { type: 'butn', button });
    }
    processKnob(data) {
        if (data.length < 9)
            return;
        const position = data.readUInt32BE(4);
        const sync = data.readUInt8(8);
        this.signalEvent(EventType.PLAYER_BTN_EVENT, { type: 'knob', position, sync });
    }
    processIr(data) {
        if (data.length < 8)
            return;
        const code = data.readUInt32BE(4);
        if (code === RemoteCode.POWER) {
            void this.togglePower();
            return;
        }
        if (code === RemoteCode.PAUSE) {
            void this.togglePause();
            return;
        }
        if (code === RemoteCode.PLAY) {
            void this.play();
            return;
        }
        if (code === RemoteCode.VOLUME_DOWN) {
            void this.volumeDown();
            return;
        }
        if (code === RemoteCode.VOLUME_UP) {
            void this.volumeUp();
            return;
        }
        this.signalEvent(EventType.PLAYER_BTN_EVENT, { type: 'ir', code });
    }
    processDsco(_data) {
        // stream disconnected; ignore for now
    }
    async processStat(data) {
        if (data.length < 4)
            return;
        const eventBytes = data.subarray(0, 4);
        if (eventBytes.every((value) => value === 0)) {
            return;
        }
        const event = eventBytes.toString('ascii');
        const payload = data.subarray(4);
        switch (event) {
            case 'STMc':
                this._state = PlayerState.BUFFERING;
                this.signalUpdate();
                break;
            case 'STMd':
                if (this._nextMedia) {
                    const next = this._nextMedia;
                    this._nextMedia = null;
                    await this.playUrl(next.url, next.mimeType, next.metadata, next.transition ?? TransitionType.NONE, next.transitionDuration ?? 0, false, true, false);
                    return;
                }
                this.signalEvent(EventType.PLAYER_DECODER_READY);
                break;
            case 'STMf':
                break;
            case 'STMo':
                if (this._state !== PlayerState.BUFFERING) {
                    this._state = PlayerState.BUFFERING;
                    if (this._autoPlay) {
                        void this.play();
                    }
                    else {
                        this.signalEvent(EventType.PLAYER_OUTPUT_UNDERRUN);
                    }
                }
                break;
            case 'STMp':
                this._state = PlayerState.PAUSED;
                this.signalUpdate();
                break;
            case 'STMr':
                this._state = PlayerState.PLAYING;
                this.signalUpdate();
                break;
            case 'STMs':
                this._state = PlayerState.PLAYING;
                if (this._bufferingMedia) {
                    this._currentMedia = this._bufferingMedia;
                    this._bufferingMedia = null;
                }
                this.signalUpdate();
                break;
            case 'STMt':
                this.processStatHeartbeat(payload);
                break;
            case 'STMu':
                this._state = PlayerState.STOPPED;
                this._currentMedia = null;
                this._bufferingMedia = null;
                this._nextMedia = null;
                this.signalUpdate();
                break;
            case 'STMl':
                this._state = PlayerState.BUFFER_READY;
                this.signalEvent(EventType.PLAYER_BUFFER_READY);
                break;
            case 'STMn':
                this.signalEvent(EventType.PLAYER_DECODER_ERROR);
                break;
            case 'AUDe':
                break;
            case 'AUDg':
                break;
            default:
                break;
        }
    }
    processStatHeartbeat(data) {
        if (data.length < 47)
            return;
        const now = Date.now();
        const jiffies = data.readUInt32BE(21);
        const elapsedMs = data.readUInt32BE(39);
        const serverHeartbeat = data.readUInt32BE(43);
        this._jiffies = jiffies;
        this._elapsedMs = elapsedMs;
        this._lastTimestamp = now;
        const sentAt = this.heartbeatSentAt.get(serverHeartbeat);
        if (typeof sentAt === 'number') {
            const rttMs = Math.max(0, now - sentAt);
            const midTime = sentAt + rttMs / 2;
            const shouldReplace = !this.clockBase ||
                now - this.clockBase.updatedAtMs > 10_000 ||
                rttMs <= this.clockBase.rttMs;
            if (shouldReplace) {
                // Prefer the lowest-RTT sample; it yields the best wallclock<->jiffies mapping.
                this.clockBase = {
                    serverTimeMs: midTime,
                    jiffies,
                    rttMs,
                    updatedAtMs: now,
                };
            }
            this.heartbeatSentAt.delete(serverHeartbeat);
            const pending = this.pendingClockSync.get(serverHeartbeat);
            if (pending) {
                pending(true);
            }
        }
        else {
            const pending = this.pendingClockSync.get(serverHeartbeat);
            if (pending) {
                pending(true);
            }
        }
        this.signalEvent(EventType.PLAYER_HEARTBEAT);
    }
    async processResp(data) {
        const { statusCode } = parseStatus(data);
        const headers = parseHeaders(data);
        if (headers.location) {
            await this.playUrl(headers.location, this._nextMedia?.mimeType, this._nextMedia?.metadata, this._nextMedia?.transition ?? TransitionType.NONE, this._nextMedia?.transitionDuration ?? 0);
            return;
        }
        if (statusCode > 300) {
            return;
        }
        if (headers['content-type']) {
            const codc = this.parseCodc(headers['content-type']);
            await this.sendFrame('codc', codc);
        }
        if (headers['icy-name'] && this._bufferingMedia && !this._bufferingMedia.metadata?.title) {
            if (!this._bufferingMedia.metadata) {
                this._bufferingMedia.metadata = {};
            }
            this._bufferingMedia.metadata.title = headers['icy-name'];
        }
        if (this._autoPlay) {
            await this.sendFrame('cont', Buffer.from('1'));
        }
    }
    processSetd(data) {
        if (data.length < 2)
            return;
        const dataId = data.readUInt8(0);
        if (dataId === 0) {
            this._deviceName = data.subarray(1).toString('utf8').replace(/\0+$/, '');
            this.signalEvent(EventType.PLAYER_NAME_RECEIVED, this._deviceName);
            return;
        }
        if (dataId === 0xfe) {
            const width = data.length >= 5 ? data.readUInt16BE(1) : data.readUInt16BE(1);
            const height = data.length >= 7 ? data.readUInt16BE(3) : 0;
            this.signalEvent(EventType.PLAYER_DISPLAY_RESOLUTION, `${width} x ${height}`);
        }
    }
    parseCodc(contentType) {
        if (contentType.includes('wav') || contentType.includes('pcm')) {
            const params = contentType.includes(';')
                ? Object.fromEntries(contentType
                    .replace(/;/g, '&')
                    .split('&')
                    .map((segment) => segment.trim())
                    .filter(Boolean)
                    .map((segment) => segment.split('=')))
                : {};
            const sampleRate = Number(params.rate ?? 44100);
            const sampleSize = Number(params.bitrate ?? 16);
            const channels = Number(params.channels ?? 2);
            return Buffer.from([
                'p'.charCodeAt(0),
                PCM_SAMPLE_SIZE[sampleSize]?.[0] ?? '?'.charCodeAt(0),
                PCM_SAMPLE_RATE[sampleRate]?.[0] ?? '?'.charCodeAt(0),
                String(channels).charCodeAt(0),
                '1'.charCodeAt(0),
            ]);
        }
        if (!CODEC_MAPPING[contentType]) {
            return Buffer.from('m????');
        }
        const codec = CODEC_MAPPING[contentType];
        if (!this.supportedCodecs.includes(codec)) {
            // best-effort; still try to play
        }
        if (contentType === 'audio/aac' || contentType === 'audio/aacp') {
            return Buffer.from('a2???');
        }
        return Buffer.concat([FORMAT_BYTE[codec] ?? Buffer.from('m'), Buffer.from('????')]);
    }
    signalUpdate() {
        this.signalEvent(EventType.PLAYER_UPDATED);
    }
    signalEvent(eventType, data) {
        try {
            const result = this.callback(this, eventType, data);
            if (result && typeof result.catch === 'function') {
                result.catch(() => undefined);
            }
        }
        catch {
            // ignore
        }
    }
    startHeartbeat() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
        }
        // Send one immediately to establish a clock base quickly.
        void this.requestClockSync().catch(() => undefined);
        this._heartbeatTimer = setInterval(() => {
            if (!this._connected)
                return;
            void this.requestClockSync().catch(() => undefined);
        }, HEARTBEAT_INTERVAL * 1000);
    }
    async togglePower() {
        await this.power(!this._powered);
    }
    async togglePause() {
        if (this._state === PlayerState.PLAYING) {
            await this.pause();
        }
        else {
            await this.play();
        }
    }
}
