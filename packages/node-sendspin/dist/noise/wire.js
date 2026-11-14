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
import { NoiseError } from './session.js';
/** A JSON control body. */
export const MSG_TYPE_JSON_BODY = 0;
/**
 * A fragment (1.0.0-rc1, #172): `[1][flags][orig_type][data]` opens a message,
 * `[1][flags][data]` continues it.
 */
export const MSG_TYPE_FRAGMENT = 1;
export const FRAGMENT_FLAG_LAST = 0x01;
export const FRAGMENT_FLAG_FIRST = 0x02;
export const FRAGMENT_FLAGS_RESERVED = 0xfc;
/** @deprecated Pre-rc1 (#172) fragment with more to follow; IDs 2-3 are reserved since. */
export const MSG_TYPE_FRAGMENT_MORE = 2;
/** @deprecated Pre-rc1 (#172) final fragment of a message. */
export const MSG_TYPE_FRAGMENT_END = 3;
/** Binary types owned by the transport, which no role message may start with. */
const TRANSPORT_BINARY_TYPES = new Set([MSG_TYPE_FRAGMENT, MSG_TYPE_FRAGMENT_MORE, MSG_TYPE_FRAGMENT_END]);
/** Noise's 65535-byte transport limit, minus the 16-byte AEAD tag. */
export const MAX_TRANSPORT_PLAINTEXT = 65535 - 16;
/** Bounds one connection's reassembly buffer against a peer streaming endless fragments. */
export const MAX_REASSEMBLED_MESSAGE_BYTES = 64 * 1024 * 1024;
/**
 * Wraps a Noise session in the Sendspin transport framing.
 *
 * Pure translation: it produces the buffers to put on the wire and consumes the
 * ones that arrive, leaving the socket itself to the caller. That keeps it
 * testable without a WebSocket and lets the session own backpressure.
 */
export class NoiseTransport {
    constructor(session) {
        this.session = session;
        this.reassemblyBuffer = null;
        this.reassemblyLength = 0;
        this.reassemblyType = null;
        this.reassemblyLegacy = false;
        /**
         * Send oversized messages with the pre-rc1 `2`/`3` framing.
         *
         * Set for a peer that predates #172, which would read type-1 fragments as an
         * unknown binary ID and drop them. Off by default: rc1 peers in turn drop 2/3.
         */
        this.legacyFragmentFraming = false;
        /**
         * Runs once per inbound pre-rc1 `2`/`3` fragmented message, which is reassembled.
         *
         * Accepting them costs an rc1 peer nothing — it never sends IDs 2/3 — and keeps
         * every older peer readable, so it is on by default; the owner can replace it to
         * flag the peer. Set it to null to deliver 2/3 frames as ordinary binary messages
         * with an unknown ID instead, as a strict rc1 receiver would.
         */
        this.onLegacyFragment = () => { };
        if (!session.handshakeComplete) {
            throw new NoiseError('NoiseSession must be in transport mode before wrapping it');
        }
    }
    /** Replace the session after a re-handshake, dropping any partial message. */
    swapSession(next) {
        if (!next.handshakeComplete) {
            throw new NoiseError('replacement NoiseSession must be in transport mode');
        }
        this.session = next;
        this.resetReassembly();
    }
    /** Encrypt a JSON control body into one or more wire frames. */
    encodeText(text) {
        return this.encodePlaintext(Buffer.concat([Buffer.from([MSG_TYPE_JSON_BODY]), Buffer.from(text, 'utf8')]));
    }
    /**
     * Encrypt an already-typed binary message into one or more wire frames.
     *
     * `data` must start with its role type byte — for us that is whatever
     * `packBinaryHeaderRaw` put there.
     */
    encodeBinary(data) {
        if (!data.length)
            throw new NoiseError('binary payload must include a leading type byte');
        if (TRANSPORT_BINARY_TYPES.has(data[0])) {
            throw new NoiseError(`binary type ${data[0]} is reserved for the transport`);
        }
        return this.encodePlaintext(data);
    }
    encodePlaintext(plaintext) {
        if (plaintext.length <= MAX_TRANSPORT_PLAINTEXT) {
            return [this.session.encrypt(plaintext)];
        }
        const frames = this.legacyFragmentFraming ? fragment(plaintext) : fragmentMessage(plaintext);
        return frames.map((frame) => this.session.encrypt(frame));
    }
    /**
     * Decrypt one wire frame.
     *
     * Returns null while a fragmented message is still being assembled. Throws
     * {@link NoiseError} on anything the transport cannot make sense of — a failed
     * tag, an empty plaintext, a stray frame mid-reassembly — all of which are
     * grounds to drop the connection rather than try to recover.
     */
    decode(frame) {
        const plaintext = this.session.decrypt(frame);
        if (!plaintext.length) {
            this.resetReassembly();
            throw new NoiseError('empty plaintext after Noise decrypt');
        }
        const typeByte = plaintext[0];
        if (typeByte === MSG_TYPE_FRAGMENT)
            return this.onFragment(plaintext);
        if ((typeByte === MSG_TYPE_FRAGMENT_MORE || typeByte === MSG_TYPE_FRAGMENT_END)
            && this.onLegacyFragment) {
            return this.onLegacyFragmentFrame(plaintext);
        }
        if (this.reassemblyBuffer) {
            this.fail('non-fragment frame while a fragmented message is in flight');
        }
        return dispatch(plaintext);
    }
    /** A type-1 fragment, checked against every malformed-sequence rule of rc1 messaging.md. */
    onFragment(plaintext) {
        if (plaintext.length < 2)
            this.fail('fragment frame missing flags byte');
        const flags = plaintext[1];
        if (flags & FRAGMENT_FLAGS_RESERVED) {
            this.fail(`fragment flags 0x${flags.toString(16).padStart(2, '0')} set reserved bits`);
        }
        let data;
        if (flags & FRAGMENT_FLAG_FIRST) {
            if (this.reassemblyBuffer)
                this.fail('first fragment while a fragmented message is in flight');
            if (plaintext.length < 3)
                this.fail('first fragment missing orig_type');
            if (plaintext[2] === MSG_TYPE_FRAGMENT)
                this.fail('first fragment has orig_type 1');
            this.startReassembly(plaintext[2], false);
            data = plaintext.subarray(3);
        }
        else if (!this.reassemblyBuffer) {
            this.fail('continuation fragment with no fragmented message in flight');
        }
        else if (this.reassemblyLegacy) {
            this.fail('type 1 fragment inside a legacy fragmented message');
        }
        else {
            data = plaintext.subarray(2);
        }
        return this.appendFragment(data, (flags & FRAGMENT_FLAG_LAST) !== 0);
    }
    /** A pre-rc1 `2`/`3` fragment; only reached when the owner opted in. */
    onLegacyFragmentFrame(plaintext) {
        const last = plaintext[0] === MSG_TYPE_FRAGMENT_END;
        if (!this.reassemblyBuffer) {
            if (last)
                this.fail('fragment-end frame with no fragmented message in flight');
            if (plaintext.length < 2)
                this.fail('fragment-more start frame missing its original type');
            if (TRANSPORT_BINARY_TYPES.has(plaintext[1])) {
                this.fail(`legacy fragment has reserved orig_type ${plaintext[1]}`);
            }
            this.onLegacyFragment?.();
            this.startReassembly(plaintext[1], true);
            return this.appendFragment(plaintext.subarray(2), false);
        }
        if (!this.reassemblyLegacy)
            this.fail('legacy fragment inside a type 1 fragmented message');
        return this.appendFragment(plaintext.subarray(1), last);
    }
    startReassembly(originalType, legacy) {
        this.reassemblyBuffer = [];
        this.reassemblyLength = 0;
        this.reassemblyType = originalType;
        this.reassemblyLegacy = legacy;
    }
    appendFragment(data, last) {
        if (this.reassemblyLength + data.length > MAX_REASSEMBLED_MESSAGE_BYTES) {
            this.fail('fragmented message exceeds the maximum reassembly size');
        }
        this.reassemblyBuffer.push(Buffer.from(data));
        this.reassemblyLength += data.length;
        if (!last)
            return null;
        const reassembled = Buffer.concat([Buffer.from([this.reassemblyType]), ...this.reassemblyBuffer]);
        this.resetReassembly();
        return dispatch(reassembled);
    }
    /** Drop any partial message and throw: every sequence error is grounds to close. */
    fail(message) {
        this.resetReassembly();
        throw new NoiseError(message);
    }
    resetReassembly() {
        this.reassemblyBuffer = null;
        this.reassemblyLength = 0;
        this.reassemblyType = null;
        this.reassemblyLegacy = false;
    }
}
function dispatch(plaintext) {
    if (plaintext[0] === MSG_TYPE_JSON_BODY) {
        return { kind: 'text', data: plaintext.subarray(1).toString('utf8') };
    }
    return { kind: 'binary', data: Buffer.from(plaintext) };
}
/** Split an oversized type-prefixed plaintext into type-1 fragment frames (rc1, #172). */
export function fragmentMessage(plaintext) {
    const originalType = plaintext[0];
    const body = plaintext.subarray(1);
    // The opening frame spends three bytes on its header (type, flags, original
    // type), every continuation two (type, flags).
    const firstCapacity = MAX_TRANSPORT_PLAINTEXT - 3;
    const contCapacity = MAX_TRANSPORT_PLAINTEXT - 2;
    const chunks = [body.subarray(0, firstCapacity)];
    for (let offset = firstCapacity; offset < body.length; offset += contCapacity) {
        chunks.push(body.subarray(offset, offset + contCapacity));
    }
    return chunks.map((chunk, index) => {
        const flags = index === chunks.length - 1 ? FRAGMENT_FLAG_LAST : 0;
        const header = index === 0
            ? Buffer.from([MSG_TYPE_FRAGMENT, flags | FRAGMENT_FLAG_FIRST, originalType])
            : Buffer.from([MSG_TYPE_FRAGMENT, flags]);
        return Buffer.concat([header, chunk]);
    });
}
/**
 * Split into the pre-rc1 `2`/`3` framing, for a peer that predates #172.
 *
 * @deprecated Kept under its original name for compatibility; rc1 peers need
 * {@link fragmentMessage}.
 */
export function fragment(plaintext) {
    const originalType = plaintext[0];
    const body = plaintext.subarray(1);
    // The opening frame spends two bytes on its header (tag + original type), every
    // continuation only one.
    const firstCapacity = MAX_TRANSPORT_PLAINTEXT - 2;
    const contCapacity = MAX_TRANSPORT_PLAINTEXT - 1;
    const frames = [
        Buffer.concat([
            Buffer.from([MSG_TYPE_FRAGMENT_MORE, originalType]),
            body.subarray(0, firstCapacity),
        ]),
    ];
    const rest = body.subarray(firstCapacity);
    const chunks = [];
    for (let offset = 0; offset < rest.length; offset += contCapacity) {
        chunks.push(rest.subarray(offset, offset + contCapacity));
    }
    chunks.forEach((chunk, index) => {
        const tag = index === chunks.length - 1 ? MSG_TYPE_FRAGMENT_END : MSG_TYPE_FRAGMENT_MORE;
        frames.push(Buffer.concat([Buffer.from([tag]), chunk]));
    });
    return frames;
}
