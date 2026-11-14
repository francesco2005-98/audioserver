/**
 * Noise KKpsk2 — handshake and transport, no I/O.
 *
 * Implemented directly on `node:crypto` rather than pulled in as a dependency:
 * every primitive Noise needs (X25519, ChaCha20-Poly1305, AES-256-GCM,
 * HMAC-SHA256) is already there, and correctness is pinned by interop tests
 * against `noiseprotocol`, the same library the reference server uses.
 *
 * The pattern, from the Noise spec:
 *
 *     KKpsk2:
 *       -> s
 *       <- s
 *       ...
 *       -> e, es, ss
 *       <- e, ee, se, psk
 *
 * Both statics are known before the handshake starts — they arrive in the
 * cleartext `client/init` / `server/init` exchange — and the PSK is mixed at the
 * second message. That placement is what lets a responder read message 1 before
 * it knows which PSK to use: the `psk_id` it needs is inside message 1's
 * encrypted payload.
 *
 * In Sendspin the **server is the initiator** and the client the responder.
 */
export declare const HASH_LEN = 32;
export declare const TAG_LEN = 16;
export declare const MAX_NONCE: bigint;
export type NoiseCipherSuite = '25519_ChaChaPoly_SHA256' | '25519_AESGCM_SHA256';
export declare const SUPPORTED_SUITES: readonly NoiseCipherSuite[];
export declare class NoiseError extends Error {
}
export interface NoiseSessionOptions {
    suite: NoiseCipherSuite;
    /** Our own static private key. */
    localStaticPriv: Buffer;
    /** The peer's static public key, learned from the cleartext init exchange. */
    remoteStaticPub: Buffer;
    /** Bound into the handshake so the cleartext init cannot be tampered with. */
    prologue: Buffer;
    /**
     * The pre-shared key. An initiator must supply it up front; a responder may
     * omit it and supply it with {@link NoiseSession.mixPsk} once message 1 has
     * named it.
     */
    psk?: Buffer;
}
/**
 * A Noise KKpsk2 session: handshake first, then transport.
 *
 * Create with {@link NoiseSession.asInitiator} (server) or
 * {@link NoiseSession.asResponder} (client).
 */
export declare class NoiseSession {
    readonly initiator: boolean;
    readonly suite: NoiseCipherSuite;
    private readonly localStaticPriv;
    private readonly localStaticPub;
    private readonly remoteStaticPub;
    private readonly state;
    private ephemeral;
    private remoteEphemeral;
    private psk;
    private messageIndex;
    private sendCipher;
    private recvCipher;
    private finalHandshakeHash;
    private constructor();
    private static build;
    /** The server side: knows the PSK before the handshake starts. */
    static asInitiator(options: NoiseSessionOptions & {
        psk: Buffer;
    }): NoiseSession;
    /** The client side: may learn the PSK from message 1. */
    static asResponder(options: NoiseSessionOptions): NoiseSession;
    /**
     * A copy of this session at its current point, to continue with another PSK.
     *
     * KKpsk2 mixes the PSK only at message 2, so an initiator that fails to verify
     * message 2 against the PSK it named can re-verify the very same message 2
     * against the Sentinel from a fork taken before the first attempt: the Sentinel
     * Fallback of connection.md (aiosendspin `fork_at_message_2`). Only valid before
     * message 2 has been read or written.
     */
    forkWithPsk(psk: Buffer): NoiseSession;
    /** Supply the real PSK between reading message 1 and writing message 2. */
    mixPsk(psk: Buffer): void;
    get handshakeComplete(): boolean;
    /** The 32-byte handshake hash `h`, available once the handshake completes. */
    get handshakeHash(): Buffer;
    /** Produce the next outgoing handshake message carrying `payload`. */
    writeMessage(payload?: Buffer): Buffer;
    /** Consume the next incoming handshake message; returns its decrypted payload. */
    readMessage(message: Buffer): Buffer;
    private writeMessage1;
    private readMessage1;
    private writeMessage2;
    private readMessage2;
    private finish;
    encrypt(plaintext: Buffer): Buffer;
    decrypt(ciphertext: Buffer): Buffer;
}
/** Constant-time compare, for anywhere a secret is checked against an expectation. */
export declare function secretEquals(a: Buffer, b: Buffer): boolean;
//# sourceMappingURL=session.d.ts.map