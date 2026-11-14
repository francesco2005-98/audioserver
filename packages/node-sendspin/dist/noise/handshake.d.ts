/**
 * Server-side driver for the cleartext init exchange and the KKpsk2 handshake.
 *
 * The sequence, all of it before a single application message:
 *
 *   1. client -> `client/init`  {client_id, version, suite}   (cleartext TEXT)
 *   2. server -> `server/init`  {server_id, version}          (cleartext TEXT)
 *   3. server -> `noise/handshake` message 1, payload {psk_id, psk_category}
 *   4. client -> `noise/handshake` message 2, payload {}
 *   5. transport mode: binary frames only
 *
 * The two init frames are concatenated verbatim into the Noise prologue, so a
 * tampered suite or identity fails the handshake rather than silently downgrading
 * anything. Steps 2 and 3 go out back-to-back — the spec has the server wait for
 * nothing in between.
 */
import { Identity, pskIdFor } from './keys.js';
import { NoiseSession, type NoiseCipherSuite } from './session.js';
import { NoiseTransport } from './wire.js';
/** Raised when the handshake cannot complete. The caller closes the socket silently. */
export declare class HandshakeAbortedError extends Error {
}
/** The `reason` of a `server/error`, which answers a `client/init` the server cannot accept. */
export type InitRejectReason = 'unsupported_version' | 'unsupported_suite' | 'malformed';
/**
 * A `client/init` this server cannot accept. Unlike a silent failure, the server
 * answers it with `server/error {reason}` in place of `server/init`, then closes
 * (connection.md "Failure Handling", #265).
 */
export declare class InitRejectedError extends HandshakeAbortedError {
    readonly reason: InitRejectReason;
    constructor(reason: InitRejectReason, message: string);
}
/** The `server/error` frame for `reason`, sent as cleartext TEXT. */
export declare function serverErrorFrame(reason: InitRejectReason): string;
/** How a connection was admitted, which is what its trust ultimately rests on. */
export declare enum PskCategory {
    /** The published Sentinel PSK: authenticates nothing. Unpaired playback only. */
    SENTINEL = "sentinel",
    /** A stored per-client credential from a completed pairing. */
    LONG_TERM = "long_term",
    /** A Pairing PSK distributed out of band to admit a new client. */
    PAIRING = "pairing"
}
/**
 * The two-letter code a category travels under in Noise message 1's
 * `psk_category`. It binds both sides to the same use of the PSK, so a client
 * holding the matched PSK under another category falls back to the Sentinel.
 */
export declare const PSK_CATEGORY_CODE: Readonly<Record<PskCategory, string>>;
/** The category a wire code names, or null for a code this side does not know. */
export declare function pskCategoryFromCode(code: unknown): PskCategory | null;
export interface ResolvedPsk {
    pskId: string;
    psk: Buffer;
    category: PskCategory;
}
/** The Sentinel PSK as a resolved record, which is what unpaired access admits with. */
export declare const SENTINEL_RESOLVED: ResolvedPsk;
/**
 * Given a `client_id`, return the PSK that admits it, or null to refuse.
 *
 * A host that has no pairing store returns {@link SENTINEL_RESOLVED} to admit
 * everyone for unpaired playback. Returning null aborts before `server/init` goes
 * out, so a client we will not admit never even learns our identity.
 */
export type PskProvider = (clientId: string) => ResolvedPsk | null | Promise<ResolvedPsk | null>;
export interface HandshakeResult {
    transport: NoiseTransport;
    session: NoiseSession;
    /** The client's static public key, base64url — its authenticated `client_id`. */
    clientId: string;
    suite: NoiseCipherSuite;
    psk: ResolvedPsk;
    /** The Noise handshake hash, which a pairing exchange would bind to. */
    handshakeHash: Buffer;
    /** The prologue, kept so a re-handshake can reuse it. */
    prologue: Buffer;
    /**
     * Message 2 did not verify against the PSK message 1 named, but did against the
     * Sentinel (connection.md "Sentinel Fallback"): the client no longer holds the
     * credential this server offered. `psk` is then the Sentinel, and the server MUST
     * NOT declare `'playback'` or activate roles while it keeps that credential.
     */
    credentialMismatch?: boolean;
}
/** What the driver wants sent, in order, as cleartext TEXT frames. */
export interface HandshakeStep1 {
    /** `server/init` followed by `noise/handshake` message 1. */
    send: string[];
    /** Feed the client's `noise/handshake` message 2 here to finish. */
    finish: (message2Text: string) => HandshakeResult;
}
/** Whether a first frame is the start of an encrypted connection. */
export declare function isClientInit(text: string): boolean;
/**
 * Begin the server-side handshake from the client's `client/init` frame.
 *
 * Split into "what to send" and a `finish` callback rather than owning the socket,
 * so the session keeps one place where bytes go out and the whole exchange stays
 * testable without a WebSocket.
 */
export declare function beginServerHandshake(options: {
    clientInitText: string;
    identity: Identity;
    pskProvider: PskProvider;
}): Promise<HandshakeStep1>;
/**
 * Given the `psk_id` and `psk_category` message 1 named, return the matching PSK,
 * or null when this side holds no PSK of that category under that id.
 *
 * `category` is null when the server predates `psk_category` (pre-1.0.0-rc1); a
 * resolver then matches on the id alone. A null result is not fatal: the
 * handshake falls back to the Sentinel PSK, as the spec's Sentinel Fallback
 * requires, so the server learns the credential is gone instead of seeing a
 * silent close.
 *
 * A client with no pairing store recognises only the Sentinel PSK — which is what
 * {@link defaultClientPskResolver} does.
 */
export type PskResolver = (pskId: string, category: PskCategory | null) => ResolvedPsk | null | Promise<ResolvedPsk | null>;
/** Recognise the Sentinel PSK and nothing else: unpaired access, no stored credentials. */
export declare const defaultClientPskResolver: PskResolver;
export interface ClientHandshakeResult extends Omit<HandshakeResult, 'clientId'> {
    /** The server's static public key, base64url — its authenticated `server_id`. */
    serverId: string;
    /**
     * Whether message 1 named its PSK's `psk_category`. 1.0.0-rc1 requires it, so a
     * server that leaves it out predates rc1 (node-sendspin 0.6 and earlier) and
     * speaks the older wire: 9-byte audio headers, hello-declared player commands
     * and artwork channels, `2`/`3` fragments.
     */
    pskCategoryNamed: boolean;
}
/**
 * Client-side (Noise responder) handshake.
 *
 * Mirror of the server driver: it returns the frames to send and a callback per
 * incoming frame, so the caller keeps ownership of the socket.
 *
 * `expectedServerId` is what turns encryption into authentication. Without it the
 * statics are only what this very connection claimed, so an active
 * man-in-the-middle can substitute its own in both directions; a caller that has
 * paired before should pass the id it stored.
 */
export declare function beginClientHandshake(options: {
    identity: Identity;
    suite: NoiseCipherSuite;
    pskResolver?: PskResolver;
    expectedServerId?: string;
}): {
    clientInit: string;
    /** Feed `server/init`; returns nothing to send yet (message 1 comes next). */
    onServerInit: (serverInitText: string) => void;
    /** Feed Noise message 1; returns message 2 to send, and completes the handshake. */
    onMessage1: (message1Text: string) => Promise<{
        send: string;
        result: ClientHandshakeResult;
    }>;
};
export { pskIdFor };
//# sourceMappingURL=handshake.d.ts.map