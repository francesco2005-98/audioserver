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
import { createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { dh, generateKeypair, publicFromPrivate, PSK_SIZE, X25519_KEY_SIZE } from './keys.js';
export const HASH_LEN = 32;
export const TAG_LEN = 16;
export const MAX_NONCE = 2n ** 64n - 1n;
export const SUPPORTED_SUITES = [
    '25519_ChaChaPoly_SHA256',
    '25519_AESGCM_SHA256',
];
export class NoiseError extends Error {
}
const EMPTY = Buffer.alloc(0);
function sha256(...parts) {
    const h = createHash('sha256');
    for (const part of parts)
        h.update(part);
    return h.digest();
}
function hmac(key, ...parts) {
    const h = createHmac('sha256', key);
    for (const part of parts)
        h.update(part);
    return h.digest();
}
function hkdf(chainingKey, ikm, outputs) {
    const tempKey = hmac(chainingKey, ikm);
    const o1 = hmac(tempKey, Buffer.from([0x01]));
    const o2 = hmac(tempKey, o1, Buffer.from([0x02]));
    if (outputs === 2)
        return [o1, o2];
    return [o1, o2, hmac(tempKey, o2, Buffer.from([0x03]))];
}
/**
 * The 96-bit AEAD nonce for counter `n`.
 *
 * Both suites use 32 zero bits followed by the counter, but ChaChaPoly encodes it
 * little-endian and AES-GCM big-endian. Getting this backwards produces a session
 * that authenticates its own traffic perfectly and fails against every peer.
 */
function nonceBytes(suite, n) {
    const nonce = Buffer.alloc(12);
    if (suite === '25519_AESGCM_SHA256') {
        nonce.writeBigUInt64BE(n, 4);
    }
    else {
        nonce.writeBigUInt64LE(n, 4);
    }
    return nonce;
}
function algorithmFor(suite) {
    return suite === '25519_AESGCM_SHA256' ? 'aes-256-gcm' : 'chacha20-poly1305';
}
/** Noise `CipherState`: a key plus a nonce counter. */
class CipherState {
    constructor(suite) {
        this.suite = suite;
        this.key = null;
        this.nonce = 0n;
    }
    initializeKey(key) {
        this.key = key;
        this.nonce = 0n;
    }
    get hasKey() {
        return this.key !== null;
    }
    clone() {
        const copy = new CipherState(this.suite);
        copy.key = this.key ? Buffer.from(this.key) : null;
        copy.nonce = this.nonce;
        return copy;
    }
    encryptWithAd(ad, plaintext) {
        if (!this.key)
            return plaintext;
        if (this.nonce > MAX_NONCE)
            throw new NoiseError('nonce exhausted');
        // Both suites default to a 16-byte tag, which is what Noise mandates, so no
        // authTagLength option is needed (and only CCM wants a plaintextLength).
        const cipher = createCipheriv(algorithmFor(this.suite), this.key, nonceBytes(this.suite, this.nonce));
        cipher.setAAD(ad);
        const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        this.nonce += 1n;
        return Buffer.concat([body, cipher.getAuthTag()]);
    }
    decryptWithAd(ad, ciphertext) {
        if (!this.key)
            return ciphertext;
        if (this.nonce > MAX_NONCE)
            throw new NoiseError('nonce exhausted');
        if (ciphertext.length < TAG_LEN)
            throw new NoiseError('ciphertext shorter than the auth tag');
        const body = ciphertext.subarray(0, ciphertext.length - TAG_LEN);
        const tag = ciphertext.subarray(ciphertext.length - TAG_LEN);
        const decipher = createDecipheriv(algorithmFor(this.suite), this.key, nonceBytes(this.suite, this.nonce));
        decipher.setAAD(ad);
        decipher.setAuthTag(tag);
        let plaintext;
        try {
            plaintext = Buffer.concat([decipher.update(body), decipher.final()]);
        }
        catch {
            // Never advance the nonce on a failed decrypt: the frame did not count.
            throw new NoiseError('failed to authenticate ciphertext');
        }
        this.nonce += 1n;
        return plaintext;
    }
}
/** Noise `SymmetricState`: chaining key, handshake hash, and the handshake cipher. */
class SymmetricState {
    clone() {
        const copy = Object.create(SymmetricState.prototype);
        copy.suite = this.suite;
        copy.chainingKey = Buffer.from(this.chainingKey);
        copy.h = Buffer.from(this.h);
        copy.cipher = this.cipher.clone();
        return copy;
    }
    constructor(protocolName, suite) {
        this.suite = suite;
        const name = Buffer.from(protocolName, 'ascii');
        // Spec: names of HASHLEN bytes or fewer are zero-padded rather than hashed.
        // `Noise_KKpsk2_25519_AESGCM_SHA256` is exactly 32 bytes and takes this branch.
        if (name.length <= HASH_LEN) {
            this.h = Buffer.alloc(HASH_LEN);
            name.copy(this.h);
        }
        else {
            this.h = sha256(name);
        }
        this.chainingKey = Buffer.from(this.h);
        this.cipher = new CipherState(suite);
        this.cipher.initializeKey(null);
    }
    mixHash(data) {
        this.h = sha256(this.h, data);
    }
    /**
     * Process an `e` token's public key.
     *
     * In a PSK handshake the `e` token does more than the usual `MixHash`: it also
     * calls `MixKey` on the same bytes, so the chaining key absorbs fresh ephemeral
     * entropy before the PSK is mixed in. KKpsk2 is always a PSK handshake, so this
     * always applies — and omitting it produces a handshake that is self-consistent
     * and rejected by every conformant peer.
     */
    mixEphemeral(publicKey) {
        this.mixHash(publicKey);
        this.mixKey(publicKey);
    }
    mixKey(input) {
        const [ck, tempK] = hkdf(this.chainingKey, input, 2);
        this.chainingKey = ck;
        this.cipher.initializeKey(tempK);
    }
    /** `MixKeyAndHash`, used by the `psk` token: it touches both ck and h. */
    mixKeyAndHash(input) {
        const [ck, tempH, tempK] = hkdf(this.chainingKey, input, 3);
        this.chainingKey = ck;
        this.mixHash(tempH);
        this.cipher.initializeKey(tempK);
    }
    encryptAndHash(plaintext) {
        const ciphertext = this.cipher.encryptWithAd(this.h, plaintext);
        this.mixHash(ciphertext);
        return ciphertext;
    }
    decryptAndHash(ciphertext) {
        const plaintext = this.cipher.decryptWithAd(this.h, ciphertext);
        this.mixHash(ciphertext);
        return plaintext;
    }
    /** `Split()`: the two transport cipher states, in initiator order. */
    split() {
        const [k1, k2] = hkdf(this.chainingKey, EMPTY, 2);
        const c1 = new CipherState(this.suite);
        const c2 = new CipherState(this.suite);
        c1.initializeKey(k1);
        c2.initializeKey(k2);
        return [c1, c2];
    }
}
/**
 * A Noise KKpsk2 session: handshake first, then transport.
 *
 * Create with {@link NoiseSession.asInitiator} (server) or
 * {@link NoiseSession.asResponder} (client).
 */
export class NoiseSession {
    constructor(initiator, suite, localStaticPriv, localStaticPub, remoteStaticPub, psk, prologue) {
        this.initiator = initiator;
        this.suite = suite;
        this.localStaticPriv = localStaticPriv;
        this.localStaticPub = localStaticPub;
        this.remoteStaticPub = remoteStaticPub;
        this.ephemeral = null;
        this.remoteEphemeral = null;
        this.messageIndex = 0;
        this.sendCipher = null;
        this.recvCipher = null;
        this.finalHandshakeHash = null;
        this.psk = psk;
        this.state = new SymmetricState(`Noise_KKpsk2_${suite}`, suite);
        this.state.mixHash(prologue);
        // KK pre-messages: the initiator's static, then the responder's. Both sides
        // perform the same two MixHash calls, in the same order.
        const initiatorStatic = initiator ? this.localStaticPub : this.remoteStaticPub;
        const responderStatic = initiator ? this.remoteStaticPub : this.localStaticPub;
        this.state.mixHash(initiatorStatic);
        this.state.mixHash(responderStatic);
    }
    static build(options, initiator) {
        const { suite, localStaticPriv, remoteStaticPub, prologue, psk } = options;
        if (!SUPPORTED_SUITES.includes(suite))
            throw new NoiseError(`unsupported suite ${suite}`);
        if (localStaticPriv.length !== X25519_KEY_SIZE) {
            throw new NoiseError('localStaticPriv must be 32 bytes');
        }
        if (remoteStaticPub.length !== X25519_KEY_SIZE) {
            throw new NoiseError('remoteStaticPub must be 32 bytes');
        }
        if (psk && psk.length !== PSK_SIZE)
            throw new NoiseError('psk must be 32 bytes');
        // Deriving our own static public from the private keeps the pre-message hash
        // honest even if a caller passes a mismatched pair.
        const localStaticPub = publicFromPrivate(localStaticPriv);
        return new NoiseSession(initiator, suite, Buffer.from(localStaticPriv), localStaticPub, Buffer.from(remoteStaticPub), psk ? Buffer.from(psk) : null, prologue);
    }
    /** The server side: knows the PSK before the handshake starts. */
    static asInitiator(options) {
        return NoiseSession.build(options, true);
    }
    /** The client side: may learn the PSK from message 1. */
    static asResponder(options) {
        return NoiseSession.build(options, false);
    }
    /**
     * A copy of this session at its current point, to continue with another PSK.
     *
     * KKpsk2 mixes the PSK only at message 2, so an initiator that fails to verify
     * message 2 against the PSK it named can re-verify the very same message 2
     * against the Sentinel from a fork taken before the first attempt: the Sentinel
     * Fallback of connection.md (aiosendspin `fork_at_message_2`). Only valid before
     * message 2 has been read or written.
     */
    forkWithPsk(psk) {
        if (this.messageIndex !== 1 || this.handshakeComplete) {
            throw new NoiseError('a session can only be forked between messages 1 and 2');
        }
        if (psk.length !== PSK_SIZE)
            throw new NoiseError('psk must be 32 bytes');
        const copy = Object.create(NoiseSession.prototype);
        Object.assign(copy, this);
        const fields = copy;
        fields.state = this.state.clone();
        fields.ephemeral = this.ephemeral
            ? { privateRaw: Buffer.from(this.ephemeral.privateRaw), publicRaw: Buffer.from(this.ephemeral.publicRaw) }
            : null;
        fields.remoteEphemeral = this.remoteEphemeral ? Buffer.from(this.remoteEphemeral) : null;
        fields.psk = Buffer.from(psk);
        return copy;
    }
    /** Supply the real PSK between reading message 1 and writing message 2. */
    mixPsk(psk) {
        if (psk.length !== PSK_SIZE)
            throw new NoiseError('psk must be 32 bytes');
        this.psk = Buffer.from(psk);
    }
    get handshakeComplete() {
        return this.sendCipher !== null;
    }
    /** The 32-byte handshake hash `h`, available once the handshake completes. */
    get handshakeHash() {
        if (!this.finalHandshakeHash) {
            throw new NoiseError('handshakeHash is only available after the handshake completes');
        }
        return Buffer.from(this.finalHandshakeHash);
    }
    /** Produce the next outgoing handshake message carrying `payload`. */
    writeMessage(payload = EMPTY) {
        if (this.handshakeComplete)
            throw new NoiseError('handshake already complete');
        const expectInitiator = this.messageIndex === 0;
        if (expectInitiator !== this.initiator)
            throw new NoiseError('not our turn to write');
        return this.messageIndex === 0 ? this.writeMessage1(payload) : this.writeMessage2(payload);
    }
    /** Consume the next incoming handshake message; returns its decrypted payload. */
    readMessage(message) {
        if (this.handshakeComplete)
            throw new NoiseError('handshake already complete');
        const expectInitiator = this.messageIndex === 0;
        if (expectInitiator === this.initiator)
            throw new NoiseError('not our turn to read');
        return this.messageIndex === 0 ? this.readMessage1(message) : this.readMessage2(message);
    }
    // -- message 1: -> e, es, ss ------------------------------------------------
    writeMessage1(payload) {
        this.ephemeral = generateKeypair();
        this.state.mixEphemeral(this.ephemeral.publicRaw);
        // es (initiator): DH(e, rs). ss: DH(s, rs).
        this.state.mixKey(dh(this.ephemeral.privateRaw, this.remoteStaticPub));
        this.state.mixKey(dh(this.localStaticPriv, this.remoteStaticPub));
        const encrypted = this.state.encryptAndHash(payload);
        this.messageIndex = 1;
        return Buffer.concat([this.ephemeral.publicRaw, encrypted]);
    }
    readMessage1(message) {
        if (message.length < X25519_KEY_SIZE)
            throw new NoiseError('message 1 too short');
        this.remoteEphemeral = Buffer.from(message.subarray(0, X25519_KEY_SIZE));
        this.state.mixEphemeral(this.remoteEphemeral);
        // es (responder): DH(s, re). ss: DH(s, rs).
        this.state.mixKey(dh(this.localStaticPriv, this.remoteEphemeral));
        this.state.mixKey(dh(this.localStaticPriv, this.remoteStaticPub));
        const payload = this.state.decryptAndHash(message.subarray(X25519_KEY_SIZE));
        this.messageIndex = 1;
        return payload;
    }
    // -- message 2: <- e, ee, se, psk -------------------------------------------
    writeMessage2(payload) {
        if (!this.remoteEphemeral)
            throw new NoiseError('missing remote ephemeral');
        if (!this.psk)
            throw new NoiseError('psk required before writing message 2');
        this.ephemeral = generateKeypair();
        this.state.mixEphemeral(this.ephemeral.publicRaw);
        // ee: DH(e, re). se (responder): DH(e, rs).
        this.state.mixKey(dh(this.ephemeral.privateRaw, this.remoteEphemeral));
        this.state.mixKey(dh(this.ephemeral.privateRaw, this.remoteStaticPub));
        this.state.mixKeyAndHash(this.psk);
        const encrypted = this.state.encryptAndHash(payload);
        const out = Buffer.concat([this.ephemeral.publicRaw, encrypted]);
        this.finish();
        return out;
    }
    readMessage2(message) {
        if (!this.ephemeral)
            throw new NoiseError('missing local ephemeral');
        if (!this.psk)
            throw new NoiseError('psk required before reading message 2');
        if (message.length < X25519_KEY_SIZE)
            throw new NoiseError('message 2 too short');
        this.remoteEphemeral = Buffer.from(message.subarray(0, X25519_KEY_SIZE));
        this.state.mixEphemeral(this.remoteEphemeral);
        // ee: DH(e, re). se (initiator): DH(s, re).
        this.state.mixKey(dh(this.ephemeral.privateRaw, this.remoteEphemeral));
        this.state.mixKey(dh(this.localStaticPriv, this.remoteEphemeral));
        this.state.mixKeyAndHash(this.psk);
        const payload = this.state.decryptAndHash(message.subarray(X25519_KEY_SIZE));
        this.finish();
        return payload;
    }
    finish() {
        const [c1, c2] = this.state.split();
        // The initiator sends with the first key and receives with the second.
        this.sendCipher = this.initiator ? c1 : c2;
        this.recvCipher = this.initiator ? c2 : c1;
        this.finalHandshakeHash = Buffer.from(this.state.h);
    }
    // -- transport -------------------------------------------------------------
    encrypt(plaintext) {
        if (!this.sendCipher)
            throw new NoiseError('handshake not complete');
        return this.sendCipher.encryptWithAd(EMPTY, plaintext);
    }
    decrypt(ciphertext) {
        if (!this.recvCipher)
            throw new NoiseError('handshake not complete');
        return this.recvCipher.decryptWithAd(EMPTY, ciphertext);
    }
}
/** Constant-time compare, for anywhere a secret is checked against an expectation. */
export function secretEquals(a, b) {
    return a.length === b.length && timingSafeEqual(a, b);
}
