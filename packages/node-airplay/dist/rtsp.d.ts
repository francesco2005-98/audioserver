/**
 * The receiver's control connection: RTSP/1.0 request-response over one TCP
 * socket, optionally wrapped in HAP's encrypted framing once pairing has run.
 *
 * AirPlay speaks RTSP over the same socket for the whole session and keeps it
 * open — it is also the channel the receiver uses to report teardown — so this
 * is a long-lived connection with a request queue, not a request factory.
 */
import type { HapSession } from './hap.js';
export declare const USER_AGENT = "AirPlay/670.6.2";
export interface RtspResponse {
    status: number;
    reason: string;
    headers: Map<string, string>;
    body: Buffer;
}
export interface RtspRequestOptions {
    /** Extra headers, e.g. `X-Apple-HKP`. Content-Length is always set here. */
    headers?: Record<string, string>;
    body?: Buffer;
    contentType?: string;
    /** Request line target; defaults to the `rtsp://<host>/<sessionId>` form. */
    uri?: string;
    timeoutMs?: number;
}
export declare class RtspConnection {
    private readonly host;
    private readonly port;
    /** Random per-session id used in the default request URI. */
    private readonly sessionId;
    /** Called when the receiver drops the control channel — the session is over. */
    private readonly onClose?;
    private socket;
    private buffer;
    private readonly queue;
    private cseq;
    /** Set once pairing completes; from then on every byte is HAP-framed. */
    private hap;
    private closed;
    constructor(host: string, port: number, 
    /** Random per-session id used in the default request URI. */
    sessionId: string, 
    /** Called when the receiver drops the control channel — the session is over. */
    onClose?: ((reason: string) => void) | undefined);
    connect(timeoutMs?: number): Promise<void>;
    /** Local address the socket ended up on — goes into the SDP/SETUP bodies. */
    localAddress(): string;
    /** Switch the connection to HAP-encrypted framing. */
    enableEncryption(hap: HapSession): void;
    isEncrypted(): boolean;
    request(method: string, options?: RtspRequestOptions): Promise<RtspResponse>;
    close(): void;
    private onData;
    /** Pull every complete response out of the read buffer. */
    private drain;
    private failAll;
}
