/**
 * Post-handshake encrypted transport.
 *
 * Once Noise is up every application message travels as a **binary** WebSocket
 * frame holding one Noise transport message. The decrypted plaintext carries a
 * leading type byte: `0` for a JSON control body, `1` for a fragment of a message
 * too large for one frame. Role binary messages keep their own first byte (the
 * `BinaryMessageType`), which is why they need no wrapping — the type byte the
 * caller already prefixed *is* the type byte.
 */
import { type NoiseSession } from './session.js';
/** A JSON control body. */
export declare const MSG_TYPE_JSON_BODY = 0;
/**
 * A fragment (1.0.0-rc1, #172): `[1][flags][orig_type][data]` opens a message,
 * `[1][flags][data]` continues it.
 */
export declare const MSG_TYPE_FRAGMENT = 1;
export declare const FRAGMENT_FLAG_LAST = 1;
export declare const FRAGMENT_FLAG_FIRST = 2;
export declare const FRAGMENT_FLAGS_RESERVED = 252;
/** @deprecated Pre-rc1 (#172) fragment with more to follow; IDs 2-3 are reserved since. */
export declare const MSG_TYPE_FRAGMENT_MORE = 2;
/** @deprecated Pre-rc1 (#172) final fragment of a message. */
export declare const MSG_TYPE_FRAGMENT_END = 3;
/** Noise's 65535-byte transport limit, minus the 16-byte AEAD tag. */
export declare const MAX_TRANSPORT_PLAINTEXT: number;
/** Bounds one connection's reassembly buffer against a peer streaming endless fragments. */
export declare const MAX_REASSEMBLED_MESSAGE_BYTES: number;
/** A decrypted application message. */
export type DecryptedFrame = {
    kind: 'text';
    data: string;
} | {
    kind: 'binary';
    data: Buffer;
};
/**
 * Wraps a Noise session in the Sendspin transport framing.
 *
 * Pure translation: it produces the buffers to put on the wire and consumes the
 * ones that arrive, leaving the socket itself to the caller. That keeps it
 * testable without a WebSocket and lets the session own backpressure.
 */
export declare class NoiseTransport {
    private session;
    private reassemblyBuffer;
    private reassemblyLength;
    private reassemblyType;
    private reassemblyLegacy;
    /**
     * Send oversized messages with the pre-rc1 `2`/`3` framing.
     *
     * Set for a peer that predates #172, which would read type-1 fragments as an
     * unknown binary ID and drop them. Off by default: rc1 peers in turn drop 2/3.
     */
    legacyFragmentFraming: boolean;
    /**
     * Runs once per inbound pre-rc1 `2`/`3` fragmented message, which is reassembled.
     *
     * Accepting them costs an rc1 peer nothing — it never sends IDs 2/3 — and keeps
     * every older peer readable, so it is on by default; the owner can replace it to
     * flag the peer. Set it to null to deliver 2/3 frames as ordinary binary messages
     * with an unknown ID instead, as a strict rc1 receiver would.
     */
    onLegacyFragment: (() => void) | null;
    constructor(session: NoiseSession);
    /** Replace the session after a re-handshake, dropping any partial message. */
    swapSession(next: NoiseSession): void;
    /** Encrypt a JSON control body into one or more wire frames. */
    encodeText(text: string): Buffer[];
    /**
     * Encrypt an already-typed binary message into one or more wire frames.
     *
     * `data` must start with its role type byte — for us that is whatever
     * `packBinaryHeaderRaw` put there.
     */
    encodeBinary(data: Buffer): Buffer[];
    private encodePlaintext;
    /**
     * Decrypt one wire frame.
     *
     * Returns null while a fragmented message is still being assembled. Throws
     * {@link NoiseError} on anything the transport cannot make sense of — a failed
     * tag, an empty plaintext, a stray frame mid-reassembly — all of which are
     * grounds to drop the connection rather than try to recover.
     */
    decode(frame: Buffer): DecryptedFrame | null;
    /** A type-1 fragment, checked against every malformed-sequence rule of rc1 messaging.md. */
    private onFragment;
    /** A pre-rc1 `2`/`3` fragment; only reached when the owner opted in. */
    private onLegacyFragmentFrame;
    private startReassembly;
    private appendFragment;
    /** Drop any partial message and throw: every sequence error is grounds to close. */
    private fail;
    private resetReassembly;
}
/** Split an oversized type-prefixed plaintext into type-1 fragment frames (rc1, #172). */
export declare function fragmentMessage(plaintext: Buffer): Buffer[];
/**
 * Split into the pre-rc1 `2`/`3` framing, for a peer that predates #172.
 *
 * @deprecated Kept under its original name for compatibility; rc1 peers need
 * {@link fragmentMessage}.
 */
export declare function fragment(plaintext: Buffer): Buffer[];
//# sourceMappingURL=wire.d.ts.map