/**
 * X25519 identity keys, base64url helpers, and `psk_id` derivation.
 *
 * A Sendspin peer's identity *is* its X25519 public key: `client_id` and
 * `server_id` are that key base64url-encoded, which is why they are exactly 43
 * characters. Under encryption there is nothing else to authenticate against.
 */
/** Core protocol version carried in `client/init` / `server/init`. */
export declare const NOISE_PROTOCOL_VERSION = 1;
export declare const PSK_SIZE = 32;
export declare const X25519_KEY_SIZE = 32;
/** Length of a base64url-encoded peer id (a 32-byte key, unpadded). */
export declare const PEER_ID_SIZE = 43;
/**
 * The published constant PSK used when no other PSK applies.
 *
 * It is public, so it authenticates nothing — it exists so that an unpaired
 * connection can still run the same encrypted handshake as a paired one, giving
 * confidentiality against a passive listener without a pairing exchange first.
 * Treat any connection admitted by it as unauthenticated.
 */
export declare const SENTINEL_PSK: Buffer;
export declare function b64urlEncode(data: Buffer): string;
/** Decode base64url, tolerating missing padding. Throws on invalid input. */
export declare function b64urlDecode(value: string): Buffer;
/** The `psk_id` a peer uses to name a PSK without revealing it. */
export declare function pskIdFor(psk: Buffer): string;
/** `psk_id` of the Sentinel PSK, precomputed since every unpaired handshake names it. */
export declare const SENTINEL_PSK_ID: string;
export declare function generatePsk(): Buffer;
/** X25519 shared secret, as Noise's `DH()`. */
export declare function dh(privateRaw: Buffer, publicRaw: Buffer): Buffer;
/** The public half of a raw X25519 private key. */
export declare function publicFromPrivate(privateRaw: Buffer): Buffer;
/** A fresh ephemeral keypair, as Noise's `GENERATE_KEYPAIR()`. */
export declare function generateKeypair(): {
    privateRaw: Buffer;
    publicRaw: Buffer;
};
/**
 * A Sendspin static identity: the long-term X25519 keypair whose public half is
 * this peer's `server_id`.
 *
 * Persist `privateB64u` and reload it with {@link Identity.fromPrivateB64u} — a
 * server that regenerates its identity looks like a different server to every
 * client that had paired with it.
 */
export declare class Identity {
    readonly privateBytes: Buffer;
    readonly publicBytes: Buffer;
    private constructor();
    static generate(): Identity;
    static fromPrivateBytes(privateBytes: Buffer): Identity;
    static fromPrivateB64u(value: string): Identity;
    /** The base64url public key — this peer's `server_id` / `client_id`. */
    get peerId(): string;
    /** The private key, base64url-encoded, for persistence. */
    get privateB64u(): string;
}
/** Decode a peer id to its raw public key, rejecting anything malformed. */
export declare function peerIdToPublicKey(peerId: string, what: string): Buffer;
//# sourceMappingURL=keys.d.ts.map