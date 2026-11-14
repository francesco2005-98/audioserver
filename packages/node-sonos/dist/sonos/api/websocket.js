"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SonosWebSocketApi = void 0;
const ws_1 = __importDefault(require("ws"));
const node_crypto_1 = require("node:crypto");
const constants_1 = require("../constants");
const errors_1 = require("../errors");
const audioClip_1 = require("./namespaces/audioClip");
const groups_1 = require("./namespaces/groups");
const groupVolume_1 = require("./namespaces/groupVolume");
const playback_1 = require("./namespaces/playback");
const playbackMetadata_1 = require("./namespaces/playbackMetadata");
const playbackSession_1 = require("./namespaces/playbackSession");
const playerVolume_1 = require("./namespaces/playerVolume");
const homeTheater_1 = require("./namespaces/homeTheater");
class SonosWebSocketApi {
    websocketUrl;
    ws;
    resultFutures = new Map();
    stopCalled = false;
    heartbeatTimer;
    heartbeatIntervalMs;
    retryDelayMs;
    retryJitterMs;
    maxReconnects;
    audioClip;
    groups;
    groupVolume;
    playback;
    playbackMetadata;
    playbackSession;
    playerVolume;
    homeTheater;
    logger = console;
    onConnect;
    onDisconnect;
    constructor(websocketUrl, opts = {}) {
        this.websocketUrl = websocketUrl;
        this.audioClip = new audioClip_1.AudioClipNamespace(this);
        this.groups = new groups_1.GroupsNamespace(this);
        this.groupVolume = new groupVolume_1.GroupVolumeNamespace(this);
        this.playback = new playback_1.PlaybackNamespace(this);
        this.playbackMetadata = new playbackMetadata_1.PlaybackMetadataNamespace(this);
        this.playbackSession = new playbackSession_1.PlaybackSessionNamespace(this);
        this.playerVolume = new playerVolume_1.PlayerVolumeNamespace(this);
        this.homeTheater = new homeTheater_1.HomeTheaterNamespace(this);
        this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 30000;
        this.retryDelayMs = opts.retryDelayMs ?? 2000;
        this.retryJitterMs = opts.retryJitterMs ?? 500;
        this.maxReconnects = opts.maxReconnects;
    }
    get connected() {
        return Boolean(this.ws && this.ws.readyState === ws_1.default.OPEN);
    }
    async connect() {
        if (this.connected) {
            throw new errors_1.InvalidState('Already connected');
        }
        // A socket that closed on its own stays in `this.ws` until disconnect() clears it. Drop it
        // here so a reconnect creates a fresh socket instead of failing forever with
        // 'Already connected' — which left the client permanently unable to reconnect while every
        // command kept throwing 'Not connected'.
        this.discardSocket();
        this.logger.debug?.(`Connecting to Sonos WebSocket ${this.websocketUrl}`);
        this.stopCalled = false;
        try {
            // The Sonos subprotocol MUST be requested via ws's `protocols` argument,
            // not as a raw Sec-WebSocket-Protocol header. ws only registers a
            // requested-protocol set when you pass `protocols`; with the header form
            // that set stays empty, so when Sonos echoes the subprotocol back in its
            // 101 response ws aborts the handshake with "Server sent a subprotocol but
            // none was requested" — surfacing as an error immediately after a 101.
            this.ws = new ws_1.default(this.websocketUrl, 'v1.api.smartspeaker.audio', {
                headers: {
                    'X-Sonos-Api-Key': constants_1.LOCAL_API_TOKEN,
                },
                rejectUnauthorized: false,
                perMessageDeflate: true,
                maxPayload: 0,
            });
        }
        catch (err) {
            throw new errors_1.CannotConnect('Failed to create websocket', err);
        }
        await new Promise((resolve, reject) => {
            if (!this.ws)
                return reject(new errors_1.CannotConnect('No websocket'));
            let upgradeInfo = null;
            this.ws.once('upgrade', (res) => {
                upgradeInfo = {
                    statusCode: res.statusCode,
                    statusMessage: res.statusMessage,
                    headers: res.headers,
                };
                this.logger.debug?.('Sonos WebSocket upgrade response', upgradeInfo);
            });
            this.ws.once('unexpected-response', (_req, res) => {
                const chunks = [];
                const stream = res;
                stream.on('data', (chunk) => chunks.push(chunk));
                stream.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf8').slice(0, 512);
                    this.logger.warn?.('Sonos WebSocket upgrade rejected', {
                        url: this.websocketUrl,
                        statusCode: res.statusCode,
                        statusMessage: res.statusMessage,
                        headers: res.headers,
                        body,
                    });
                    reject(new errors_1.CannotConnect(`Upgrade rejected: ${res.statusCode ?? '?'} ${res.statusMessage ?? ''} body=${body}`));
                });
                stream.on('error', () => {
                    reject(new errors_1.CannotConnect(`Upgrade rejected: ${res.statusCode ?? '?'} ${res.statusMessage ?? ''}`));
                });
            });
            this.ws.once('open', () => resolve());
            this.ws.once('error', (err) => {
                const detail = upgradeInfo
                    ? ` (upgrade ${upgradeInfo.statusCode} ${upgradeInfo.statusMessage ?? ''})`
                    : '';
                reject(new errors_1.CannotConnect(`Failed to connect${detail}`, err));
            });
        });
        this.ws.on('message', (data) => this.handleRawMessage(data));
        this.ws.on('close', () => {
            this.clearHeartbeat();
        });
        this.ws.on('error', (err) => {
            this.logger.warn?.('WebSocket error', err);
        });
        this.ws.on('pong', () => {
            // noop; pong receipt confirms liveness
        });
        this.startHeartbeat();
        await this.onConnect?.();
    }
    async startListening() {
        this.stopCalled = false;
        // Kept outside the loop: a per-iteration counter never grows, so maxReconnects would never
        // trip and the backoff would stay at its minimum forever.
        let attempts = 0;
        while (!this.stopCalled) {
            let reason;
            try {
                if (!this.connected) {
                    await this.connect();
                }
                // A healthy session resets the backoff so a long uptime is not punished by an old
                // streak of failures.
                attempts = 0;
                reason = await this.waitForClose();
                if (this.stopCalled)
                    break;
                this.discardSocket(reason);
                await this.onDisconnect?.(reason);
                this.logger.warn?.('WebSocket closed, reconnecting...', reason);
            }
            catch (err) {
                if (this.stopCalled)
                    break;
                reason = err instanceof Error ? err.message : undefined;
                this.discardSocket(reason);
                this.logger.warn?.('WebSocket listen error, reconnecting...', err);
                await this.onDisconnect?.(reason);
            }
            attempts += 1;
            if (this.maxReconnects && attempts > this.maxReconnects) {
                this.logger.error?.('Max reconnect attempts reached');
                break;
            }
            await this.delay(this.computeRetryDelay(attempts));
        }
    }
    async disconnect() {
        this.stopCalled = true;
        this.clearHeartbeat();
        if (this.ws && this.ws.readyState === ws_1.default.OPEN) {
            await new Promise((resolve) => {
                this.ws?.once('close', () => resolve());
                this.ws?.close();
            });
        }
        this.discardSocket('Connection closed');
    }
    /**
     * Forgets the current socket and fails every command still waiting on it. Without this a
     * command issued while the socket dies would hang forever (no result frame is ever coming),
     * and the stale socket would block the next connect().
     */
    discardSocket(reason = 'Connection closed') {
        this.clearHeartbeat();
        const ws = this.ws;
        this.ws = undefined;
        for (const pending of this.resultFutures.values()) {
            pending.reject(new errors_1.ConnectionClosed(reason));
        }
        this.resultFutures.clear();
        if (!ws)
            return;
        ws.removeAllListeners();
        if (ws.readyState !== ws_1.default.CLOSED) {
            ws.terminate();
        }
    }
    async sendCommand(namespace, command, options, pathParams) {
        if (!this.connected || !this.ws)
            throw new errors_1.InvalidState('Not connected');
        const cmdId = (0, node_crypto_1.randomUUID)();
        const cmdMessage = {
            namespace: `${namespace}:${constants_1.API_VERSION}`,
            command,
            cmdId,
            ...(pathParams ?? {}),
        };
        const payload = [cmdMessage, options ?? {}];
        const resultPromise = new Promise((resolve, reject) => {
            this.resultFutures.set(cmdId, { resolve, reject });
        });
        await this.send(payload);
        return resultPromise.finally(() => this.resultFutures.delete(cmdId));
    }
    sendCommandNoWait(namespace, command, options, pathParams) {
        if (!this.connected || !this.ws)
            throw new errors_1.NotConnected('Not connected');
        const cmdMessage = {
            namespace: `${namespace}:${constants_1.API_VERSION}`,
            command,
            cmdId: (0, node_crypto_1.randomUUID)(),
            ...(pathParams ?? {}),
        };
        const payload = [cmdMessage, options ?? {}];
        void this.send(payload);
    }
    async send(payload) {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN) {
            throw new errors_1.NotConnected('Not connected');
        }
        if (this.logger && this.logger.log && constants_1.LOG_LEVEL_VERBOSE) {
            this.logger.log?.(constants_1.LOG_LEVEL_VERBOSE, 'Publishing message', payload);
        }
        const data = JSON.stringify(payload);
        await new Promise((resolve, reject) => {
            this.ws?.send(data, (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    handleRawMessage(raw) {
        try {
            const parsed = JSON.parse(raw.toString());
            try {
                this.handleIncoming(parsed);
            }
            catch (err) {
                this.logger.error?.('Failed to handle Sonos message', err);
            }
        }
        catch (err) {
            this.logger.error?.('Invalid JSON from Sonos', err);
        }
    }
    handleIncoming(raw) {
        if (!Array.isArray(raw) || raw.length !== 2) {
            this.logger.error?.('Invalid Sonos message shape', raw);
            return;
        }
        const [msg, msgData] = raw;
        if (!msg || typeof msg !== 'object') {
            throw new errors_1.InvalidMessage('Received malformed message');
        }
        // error response
        if ('errorCode' in msgData) {
            const errData = msgData;
            if ('cmdId' in msg && msg.cmdId) {
                const future = this.resultFutures.get(msg.cmdId);
                future?.reject(new errors_1.FailedCommand(errData.errorCode, errData.reason));
            }
            else {
                this.logger.error?.('Unhandled error', msgData);
            }
            return;
        }
        // command result
        if ('success' in msg) {
            if (msg.cmdId && this.resultFutures.has(msg.cmdId)) {
                const pending = this.resultFutures.get(msg.cmdId);
                if (msg.success) {
                    pending?.resolve(msgData);
                }
                else {
                    pending?.reject(new errors_1.FailedCommand(String(msgData['_objectType'] ?? 'unknown')));
                }
            }
            return;
        }
        // event
        if (msg.type) {
            const namespaces = [
                this.audioClip,
                this.groups,
                this.groupVolume,
                this.playbackMetadata,
                this.playbackSession,
                this.playback,
                this.playerVolume,
                this.homeTheater,
            ];
            const target = namespaces.find((ns) => ns.eventType === msg.type);
            if (target) {
                target.handleEvent(msg, msgData);
            }
            else {
                this.logger.debug?.(`Unhandled event type ${msg.type}`);
            }
            return;
        }
        this.logger.debug?.('Unhandled message', raw);
    }
    async waitForClose() {
        return new Promise((resolve, reject) => {
            const ws = this.ws;
            if (!ws)
                return reject(new errors_1.NotConnected('No websocket'));
            const onClose = (code, reason) => {
                ws.removeListener('error', onError);
                resolve(`${code}:${reason.toString()}`);
            };
            const onError = (err) => {
                ws.removeListener('close', onClose);
                reject(new errors_1.ConnectionFailed(err));
            };
            ws.once('close', onClose);
            ws.once('error', onError);
        });
    }
    startHeartbeat() {
        this.clearHeartbeat();
        if (!this.heartbeatIntervalMs)
            return;
        this.heartbeatTimer = setInterval(() => {
            if (!this.ws || this.ws.readyState !== ws_1.default.OPEN)
                return;
            try {
                this.ws.ping();
            }
            catch (err) {
                this.logger.warn?.('Heartbeat ping failed', err);
                this.ws.terminate();
            }
        }, this.heartbeatIntervalMs);
    }
    clearHeartbeat() {
        if (this.heartbeatTimer)
            clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
    }
    async delay(ms) {
        await new Promise((resolve) => setTimeout(resolve, ms));
    }
    computeRetryDelay(attempt) {
        const base = this.retryDelayMs * Math.min(2 ** (attempt - 1), 8);
        const jitter = Math.random() * this.retryJitterMs;
        return base + jitter;
    }
}
exports.SonosWebSocketApi = SonosWebSocketApi;
