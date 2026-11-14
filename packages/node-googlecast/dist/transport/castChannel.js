import tls from 'node:tls';
import { EventEmitter } from 'eventemitter3';
import { decodeFramedMessages, encodeFramedMessage, concatBuffers } from './framing.js';
import { Backoff } from './backoff.js';
import { encodeCastMessage, decodeCastMessage } from '../protocol/castV2.js';
import { Namespaces } from '../protocol/namespaces.js';
import { ProtocolError, TimeoutError } from '../utils/errors.js';
const DEFAULT_PORT = 8009;
export class CastChannel extends EventEmitter {
    options;
    socket;
    buffer = new Uint8Array(0);
    pendingRequests = new Map();
    backoff;
    reconnecting = false;
    state = 'idle';
    lastError;
    pingTimer;
    pongTimer;
    requestId = 1;
    constructor(options) {
        super();
        this.options = options;
        this.backoff = new Backoff({
            baseMs: options.reconnectBackoffMs ?? 500,
            maxMs: options.reconnectMaxBackoffMs ?? 5000,
            factor: options.reconnectBackoffFactor ?? 2,
            jitter: options.reconnectJitter ?? 0.2,
        });
    }
    async connect() {
        this.setState('connecting');
        await this.openSocket();
    }
    async disconnect() {
        this.cleanup();
        this.socket?.destroy();
        this.setState('disconnected');
    }
    async sendMessage(payload) {
        if (!this.socket) {
            throw new ProtocolError('Not connected');
        }
        const encoded = await encodeCastMessage(payload);
        const framed = encodeFramedMessage(encoded);
        this.socket.write(framed);
    }
    async sendJson(namespace, sourceId, destinationId, message) {
        const payload = {
            namespace,
            sourceId,
            destinationId,
            payloadType: 'STRING',
            payloadUtf8: JSON.stringify(message),
        };
        await this.sendMessage(payload);
    }
    async sendRequest(namespace, sourceId, destinationId, message, timeoutMs, predicate) {
        const requestId = this.requestId++;
        const payload = { ...message, requestId };
        await this.sendJson(namespace, sourceId, destinationId, payload);
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new TimeoutError('Request timed out'));
            }, timeoutMs);
            const pending = {
                resolve: resolve,
                reject,
                timeout,
                ...(predicate ? { predicate } : {}),
            };
            this.pendingRequests.set(requestId, pending);
        });
    }
    async openSocket() {
        const port = this.options.port ?? DEFAULT_PORT;
        await this.withConnectTimeout(new Promise((resolve, reject) => {
            const socket = tls.connect({ host: this.options.host, port, rejectUnauthorized: false });
            this.socket = socket;
            socket.once('secureConnect', () => {
                this.backoff.reset();
                this.lastError = undefined;
                this.setState('connected');
                this.emit('connected');
                this.startHeartbeat();
                resolve();
            });
            socket.once('error', (error) => {
                this.lastError = error;
                reject(error);
            });
            socket.on('data', (data) => this.handleData(data));
            socket.on('error', (error) => {
                this.lastError = error;
                this.emit('error', error);
            });
            socket.on('close', () => this.handleClose());
        }));
    }
    handleClose() {
        this.cleanup();
        this.setState('disconnected');
        this.emit('disconnected', this.lastError);
        if (this.options.reconnect && !this.reconnecting) {
            void this.reconnect();
        }
    }
    async reconnect() {
        this.reconnecting = true;
        this.setState('reconnecting');
        const attempts = this.options.reconnectAttempts ?? 5;
        for (let i = 0; i < attempts; i += 1) {
            const delay = this.backoff.nextDelay();
            await new Promise((resolve) => setTimeout(resolve, delay));
            try {
                await this.openSocket();
                this.reconnecting = false;
                return;
            }
            catch (error) {
                this.lastError = error;
                if (i === attempts - 1) {
                    this.reconnecting = false;
                    this.emit('error', new ProtocolError(String(error)));
                }
            }
        }
        this.setState('disconnected');
    }
    handleData(chunk) {
        this.buffer = concatBuffers(this.buffer, new Uint8Array(chunk));
        const { messages, bytesConsumed } = decodeFramedMessages(this.buffer);
        for (const message of messages) {
            void this.handleMessage(message);
        }
        this.buffer = this.buffer.slice(bytesConsumed);
    }
    async handleMessage(message) {
        const payload = await decodeCastMessage(message);
        let parsed = undefined;
        if (payload.payloadType === 'STRING' && payload.payloadUtf8) {
            try {
                parsed = JSON.parse(payload.payloadUtf8);
            }
            catch (error) {
                this.emit('error', new ProtocolError('Invalid JSON payload'));
            }
        }
        if (parsed && typeof parsed === 'object' && parsed !== null) {
            const requestId = parsed.requestId;
            const type = parsed.type;
            if (typeof requestId === 'number') {
                const pending = this.pendingRequests.get(requestId);
                if (pending) {
                    if (type === 'INVALID_REQUEST') {
                        clearTimeout(pending.timeout);
                        this.pendingRequests.delete(requestId);
                        pending.reject(new ProtocolError('Invalid request'));
                        return;
                    }
                    if (!pending.predicate || pending.predicate(parsed)) {
                        clearTimeout(pending.timeout);
                        this.pendingRequests.delete(requestId);
                        pending.resolve(parsed);
                    }
                }
            }
        }
        if (payload.namespace === Namespaces.HEARTBEAT && parsed) {
            const heartbeat = parsed;
            if (heartbeat.type === 'PING') {
                await this.sendJson(Namespaces.HEARTBEAT, payload.destinationId, payload.sourceId, {
                    type: 'PONG',
                });
            }
            else if (heartbeat.type === 'PONG') {
                this.resetPongTimer();
            }
        }
        this.emit('message', payload, parsed);
    }
    startHeartbeat() {
        const intervalMs = this.options.pingIntervalMs ?? 5000;
        this.pingTimer = setInterval(() => {
            if (!this.socket) {
                return;
            }
            void this.sendJson(Namespaces.HEARTBEAT, 'sender-0', 'receiver-0', { type: 'PING' });
            this.resetPongTimer();
        }, intervalMs);
    }
    resetPongTimer() {
        const timeoutMs = this.options.pongTimeoutMs ?? 10000;
        if (this.pongTimer) {
            clearTimeout(this.pongTimer);
        }
        this.pongTimer = setTimeout(() => {
            const error = new ProtocolError('Heartbeat timeout');
            this.lastError = error;
            this.emit('error', error);
            this.socket?.destroy();
        }, timeoutMs);
    }
    cleanup() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
        }
        if (this.pongTimer) {
            clearTimeout(this.pongTimer);
        }
        for (const pending of this.pendingRequests.values()) {
            clearTimeout(pending.timeout);
            pending.reject(new ProtocolError('Connection closed'));
        }
        this.pendingRequests.clear();
    }
    setState(state) {
        if (this.state === state) {
            return;
        }
        this.state = state;
        this.emit('stateChanged', state);
    }
    async withConnectTimeout(promise) {
        const timeoutMs = this.options.connectTimeoutMs ?? 10000;
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new TimeoutError('Connect timed out')), timeoutMs);
        });
        try {
            await Promise.race([promise, timeoutPromise]);
        }
        finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }
}
