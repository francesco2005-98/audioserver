/**
 * HomeKit Accessory Protocol as an AirPlay 2 sender needs it: transient
 * pair-setup (no credentials, no PIN prompt) and the ChaCha20-Poly1305 framing
 * that every RTSP byte rides in afterwards.
 *
 * Ported from cliairplay's `ap2_hap.c`. Transient pairing is the route for a
 * receiver that advertises pairing without the PIN (0x8) or legacy (0x200)
 * status flag — measured to include current HomePods, which complete it
 * without any user interaction.
 */
import type { RtspConnection } from './rtsp.js';
/**
 * An established HAP session: the two directional channel keys plus their nonce
 * counters, and the shared secret the audio cipher is later derived from.
 */
export declare class HapSession {
    private readonly writeKey;
    private readonly readKey;
    /**
     * For transient pairing this is the SRP session key; after pair-verify it is
     * the X25519 shared secret. Either way it is what the audio keys derive from.
     */
    readonly sharedSecret: Buffer;
    private writeCounter;
    private readCounter;
    /** Bytes of an incomplete inbound frame, carried to the next read. */
    private readBuffer;
    constructor(writeKey: Buffer, readKey: Buffer, 
    /**
     * For transient pairing this is the SRP session key; after pair-verify it is
     * the X25519 shared secret. Either way it is what the audio keys derive from.
     */
    sharedSecret: Buffer);
    /**
     * Wrap plaintext in HAP frames: `[2-byte LE length][ciphertext][16-byte tag]`,
     * at most 1024 plaintext bytes per frame, with the length field as AAD.
     */
    encrypt(plain: Buffer): Buffer;
    /**
     * Unwrap as many complete frames as the input holds. A partial trailing frame
     * is kept for the next call, so this is safe to feed raw socket chunks.
     */
    decrypt(data: Buffer): Buffer;
}
export declare class HapError extends Error {
    readonly httpStatus: number;
    readonly tlvError: number;
    constructor(message: string, httpStatus?: number, tlvError?: number);
}
/**
 * Run transient pair-setup over an open (still plaintext) RTSP connection and
 * return the session that encrypts everything from here on.
 *
 * :param secret: device password when it has one; otherwise the fixed transient
 *   PIN every credential-less receiver expects.
 */
export declare function pairSetupTransient(rtsp: RtspConnection, secret?: string): Promise<HapSession>;
