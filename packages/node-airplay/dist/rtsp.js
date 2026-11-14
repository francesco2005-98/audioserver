/**
 * The receiver's control connection: RTSP/1.0 request-response over one TCP
 * socket, optionally wrapped in HAP's encrypted framing once pairing has run.
 *
 * AirPlay speaks RTSP over the same socket for the whole session and keeps it
 * open — it is also the channel the receiver uses to report teardown — so this
 * is a long-lived connection with a request queue, not a request factory.
 */
import { connect } from 'node:net';
export const USER_AGENT = 'AirPlay/670.6.2';
const DEFAULT_TIMEOUT_MS = 10_000;
export class RtspConnection {
    host;
    port;
    sessionId;
    onClose;
    socket = null;
    buffer = Buffer.alloc(0);
    queue = [];
    cseq = 0;
    /** Set once pairing completes; from then on every byte is HAP-framed. */
    hap = null;
    closed = false;
    constructor(host, port, 
    /** Random per-session id used in the default request URI. */
    sessionId, 
    /** Called when the receiver drops the control channel — the session is over. */
    onClose) {
        this.host = host;
        this.port = port;
        this.sessionId = sessionId;
        this.onClose = onClose;
    }
    async connect(timeoutMs = DEFAULT_TIMEOUT_MS) {
        await new Promise((resolve, reject) => {
            const socket = connect({ host: this.host, port: this.port });
            const timer = setTimeout(() => {
                socket.destroy();
                reject(new Error(`RTSP connect to ${this.host}:${this.port} timed out`));
            }, timeoutMs);
            socket.once('connect', () => {
                clearTimeout(timer);
                socket.setNoDelay(true);
                this.socket = socket;
                socket.on('data', (chunk) => this.onData(chunk));
                socket.on('error', (err) => this.failAll(err));
                socket.on('close', () => {
                    this.failAll(new Error('RTSP connection closed'));
                    if (!this.closed) {
                        this.onClose?.('receiver closed the control channel');
                    }
                });
                resolve();
            });
            socket.once('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });
    }
    /** Local address the socket ended up on — goes into the SDP/SETUP bodies. */
    localAddress() {
        return this.socket?.localAddress?.replace(/^::ffff:/, '') ?? '0.0.0.0';
    }
    /** Switch the connection to HAP-encrypted framing. */
    enableEncryption(hap) {
        this.hap = hap;
    }
    isEncrypted() {
        return this.hap !== null;
    }
    async request(method, options = {}) {
        const socket = this.socket;
        if (!socket || this.closed) {
            throw new Error('RTSP connection is not open');
        }
        const body = options.body ?? Buffer.alloc(0);
        const uri = options.uri ?? `rtsp://${this.host}/${this.sessionId}`;
        const cseq = ++this.cseq;
        const headers = {
            'User-Agent': USER_AGENT,
            CSeq: String(cseq),
            ...(options.headers ?? {}),
        };
        if (options.contentType) {
            headers['Content-Type'] = options.contentType;
        }
        headers['Content-Length'] = String(body.length);
        const headerText = Object.entries(headers)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\r\n');
        const head = Buffer.from(`${method} ${uri} RTSP/1.0\r\n${headerText}\r\n\r\n`, 'utf8');
        const raw = Buffer.concat([head, body]);
        const response = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const index = this.queue.findIndex((entry) => entry.timer === timer);
                if (index >= 0) {
                    this.queue.splice(index, 1);
                }
                reject(new Error(`RTSP ${method} timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`));
            }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
            this.queue.push({ resolve, reject, timer });
        });
        socket.write(this.hap ? this.hap.encrypt(raw) : raw);
        return response;
    }
    close() {
        this.closed = true;
        this.socket?.destroy();
        this.socket = null;
    }
    onData(chunk) {
        let plain = chunk;
        if (this.hap) {
            plain = this.hap.decrypt(chunk);
            if (plain.length === 0) {
                return; // a partial HAP frame; the session buffers the remainder
            }
        }
        this.buffer = Buffer.concat([this.buffer, plain]);
        this.drain();
    }
    /** Pull every complete response out of the read buffer. */
    drain() {
        for (;;) {
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd < 0) {
                return;
            }
            const headerText = this.buffer.subarray(0, headerEnd).toString('utf8');
            const lines = headerText.split('\r\n');
            const statusLine = lines[0] ?? '';
            const match = /^\S+\s+(\d+)\s*(.*)$/.exec(statusLine);
            if (!match) {
                // Not a response — an event the receiver pushed at us. Drop the frame
                // rather than desyncing the parser.
                this.buffer = this.buffer.subarray(headerEnd + 4);
                continue;
            }
            const headers = new Map();
            for (const line of lines.slice(1)) {
                const sep = line.indexOf(':');
                if (sep > 0) {
                    headers.set(line.slice(0, sep).trim().toLowerCase(), line.slice(sep + 1).trim());
                }
            }
            const contentLength = Number(headers.get('content-length') ?? '0') || 0;
            const bodyStart = headerEnd + 4;
            if (this.buffer.length < bodyStart + contentLength) {
                return; // body still arriving
            }
            const body = Buffer.from(this.buffer.subarray(bodyStart, bodyStart + contentLength));
            this.buffer = this.buffer.subarray(bodyStart + contentLength);
            const pending = this.queue.shift();
            if (pending) {
                clearTimeout(pending.timer);
                pending.resolve({
                    status: Number(match[1]),
                    reason: match[2] ?? '',
                    headers,
                    body,
                });
            }
        }
    }
    failAll(err) {
        while (this.queue.length > 0) {
            const pending = this.queue.shift();
            clearTimeout(pending.timer);
            pending.reject(err);
        }
    }
}
