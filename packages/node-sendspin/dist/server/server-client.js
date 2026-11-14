import EventEmitter from 'node:events';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import { AudioCodec, PlaybackStateType, Roles, BinaryMessageType, ConnectionReason, } from '../types.js';
import { packBinaryHeaderRaw } from '../binary.js';
export class ServerClient extends EventEmitter {
    constructor(ws, opts) {
        super();
        this.activeRoles = [];
        this.ready = false;
        this.initialStateRequired = false;
        this.initialStateReceived = false;
        this.initialStateTimer = null;
        this.identified = false;
        this.maxBufferedSend = 1024 * 512;
        this.ws = ws;
        this.opts = opts;
        this.defaultRoles = opts.defaultRoles ?? [];
        this.setup();
    }
    get clientId() {
        return this.helloPayload?.client_id;
    }
    get name() {
        return this.helloPayload?.name;
    }
    get roles() {
        return this.activeRoles.length ? this.activeRoles : this.helloPayload?.supported_roles ?? this.defaultRoles;
    }
    close() {
        if (this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
            return;
        }
        this.ws.close();
    }
    async sendHello() {
        const payload = {
            server_id: this.opts.serverId,
            name: this.opts.serverName,
            version: this.opts.serverVersion ?? 1,
            active_roles: this.roles.length ? this.roles : this.defaultRoles,
            connection_reason: this.opts.connectionReason ?? ConnectionReason.DISCOVERY,
        };
        const msg = { type: 'server/hello', payload };
        this.sendJson(msg);
    }
    sendGroupUpdate(payload) {
        const msg = { type: 'group/update', payload };
        this.sendJson(msg);
    }
    sendServerState(payload) {
        const msg = { type: 'server/state', payload };
        this.sendJson(msg);
    }
    sendServerCommand(payload) {
        const msg = { type: 'server/command', payload };
        this.sendJson(msg);
    }
    sendStreamStart(payload) {
        const msg = { type: 'stream/start', payload };
        this.sendJson(msg);
    }
    sendStreamClear(payload) {
        const msg = { type: 'stream/clear', payload };
        this.sendJson(msg);
    }
    sendStreamEnd(payload) {
        const msg = { type: 'stream/end', payload };
        this.sendJson(msg);
    }
    sendAudioChunk(timestampUs, pcmData, player) {
        if (player && player.codec !== AudioCodec.PCM) {
            throw new Error('Only PCM chunks are supported in this implementation');
        }
        const header = packBinaryHeaderRaw(BinaryMessageType.AUDIO_CHUNK, timestampUs);
        const payload = Buffer.concat([header, pcmData]);
        if (this.ws.readyState !== WebSocket.OPEN)
            return;
        if (this.ws.bufferedAmount > this.maxBufferedSend) {
            setTimeout(() => {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(payload);
                }
            }, 5);
            return;
        }
        this.ws.send(payload);
    }
    setup() {
        this.ws.on('message', (data) => this.handleMessage(data));
        this.ws.on('close', () => this.emit('disconnect'));
        this.ws.on('error', () => this.emit('disconnect'));
    }
    handleMessage(data) {
        if (typeof data === 'string') {
            this.handleJson(data);
        }
        else if (data instanceof Buffer || data instanceof Uint8Array) {
            // Server currently only cares about binary audio from server to client; ignore inbound binary
        }
    }
    handleJson(raw) {
        let msg;
        try {
            msg = JSON.parse(raw);
        }
        catch {
            return;
        }
        if (!this.ready && msg.type !== 'client/hello') {
            this.closeWithReason('expected client/hello first');
            return;
        }
        switch (msg.type) {
            case 'client/hello': {
                if (this.ready) {
                    break;
                }
                this.handleClientHello(msg.payload);
                break;
            }
            case 'client/time': {
                const payload = msg.payload;
                this.respondTime(payload);
                break;
            }
            case 'client/state': {
                const payload = msg.payload;
                if (!this.initialStateReceived && this.initialStateRequired) {
                    this.initialStateReceived = true;
                    if (this.initialStateTimer) {
                        clearTimeout(this.initialStateTimer);
                        this.initialStateTimer = null;
                    }
                    this.maybeEmitHello();
                }
                this.emit('state', payload);
                break;
            }
            case 'client/command': {
                const payload = msg.payload;
                this.emit('command', payload);
                break;
            }
            case 'client/goodbye': {
                const payload = msg.payload;
                const reason = payload?.reason ? `client goodbye:${payload.reason}` : 'client goodbye';
                this.closeWithReason(reason);
                break;
            }
            default:
                break;
        }
    }
    respondTime(payload) {
        const nowUs = this.nowUs();
        const response = {
            type: 'server/time',
            payload: {
                client_transmitted: payload.client_transmitted,
                server_received: nowUs,
                server_transmitted: this.nowUs(),
            },
        };
        this.sendJson(response);
    }
    sendJson(message) {
        if (this.ws.readyState !== WebSocket.OPEN)
            return;
        this.ws.send(JSON.stringify(message));
    }
    nowUs() {
        return Math.floor(performance.now() * 1000);
    }
    handleClientHello(payload) {
        if (payload?.version !== 1) {
            this.closeWithReason('invalid protocol version');
            return;
        }
        const rawClientId = typeof payload?.client_id === 'string' ? payload.client_id.trim() : '';
        if (!rawClientId) {
            this.closeWithReason('missing client_id');
            return;
        }
        const supportedRoles = Array.isArray(payload?.supported_roles) ? payload.supported_roles : [];
        if (!supportedRoles.length) {
            this.closeWithReason('missing supported_roles');
            return;
        }
        const { activeRoles } = this.resolveActiveRoles(supportedRoles);
        this.activeRoles = activeRoles;
        const playerSupport = payload['player@v1_support'] ?? payload.player_support ?? null;
        const visualizerSupport = payload['visualizer@_draft_r1_support'] ??
            payload['visualizer@v1_support'] ??
            payload.visualizer_support ??
            null;
        if (this.activeRoles.includes(Roles.PLAYER) && !playerSupport) {
            this.closeWithReason('missing player support');
            return;
        }
        // `artwork@v1_support` left the hello in 1.0.0-rc1 (#195) and `source@v1_support`
        // after it (#335): neither is required to activate the role.
        if (this.activeRoles.includes(Roles.VISUALIZER) && !visualizerSupport) {
            this.closeWithReason('missing visualizer support');
            return;
        }
        this.helloPayload = payload;
        this.ready = true;
        void this.sendHello();
        this.sendGroupUpdate({
            playback_state: PlaybackStateType.STOPPED,
            group_id: rawClientId,
            group_name: rawClientId,
        });
        this.initialStateRequired = this.activeRoles.includes(Roles.PLAYER);
        if (this.initialStateRequired) {
            this.initialStateTimer = setTimeout(() => {
                if (!this.initialStateReceived) {
                    this.closeWithReason('initial state timeout');
                }
            }, 5000);
        }
        else {
            this.maybeEmitHello();
        }
    }
    maybeEmitHello() {
        if (this.identified || !this.helloPayload)
            return;
        if (this.initialStateRequired && !this.initialStateReceived)
            return;
        this.identified = true;
        this.emit('hello', this.helloPayload);
    }
    closeWithReason(reason) {
        if (this.initialStateTimer) {
            clearTimeout(this.initialStateTimer);
            this.initialStateTimer = null;
        }
        try {
            this.ws.close(1008, reason);
        }
        catch {
            /* ignore */
        }
    }
    resolveActiveRoles(supportedRoles) {
        const serverSupported = new Set([
            Roles.PLAYER,
            Roles.CONTROLLER,
            Roles.METADATA,
            Roles.ARTWORK,
            Roles.VISUALIZER,
            Roles.SOURCE,
        ]);
        const activeRoles = [];
        const seenFamilies = new Set();
        for (const role of supportedRoles) {
            if (typeof role !== 'string')
                continue;
            const family = role.split('@')[0];
            if (seenFamilies.has(family))
                continue;
            if (serverSupported.has(role)) {
                activeRoles.push(role);
                seenFamilies.add(family);
            }
        }
        return { activeRoles };
    }
}
