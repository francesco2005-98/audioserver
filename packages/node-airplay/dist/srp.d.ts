/**
 * Client side of SRP-6a (SHA-512, RFC 5054 3072-bit group) as HAP pair-setup
 * uses it. Ported from cliairplay's `srp_client_compute` (ap2_hap.c), whose
 * byte conventions were verified against real receivers:
 *
 *   k = SHA512(PAD(N) || PAD(g)) and u = SHA512(PAD(A) || PAD(B)), both padded
 *   to the 384-byte modulus size; the values hashed into x, K, M1 and HAMK use
 *   MINIMAL-length big-endian encoding, and the salt goes in as its raw TLV
 *   bytes. Getting either convention wrong still produces a valid-looking
 *   exchange that fails only at the server-proof compare, so they matter.
 *
 * BigInt is used rather than a bignum addon: pair-setup runs two modular
 * exponentiations per session, once at connect, so the cost is irrelevant.
 */
/** The fixed secret every credential-less receiver expects for transient pairing. */
export declare const TRANSIENT_PIN = "3939";
export interface SrpClientResult {
    /** Our public key A, minimal-length big-endian (goes in the M3 TLV). */
    publicKey: Buffer;
    /** Client proof M1 (goes in the M3 TLV). */
    proof: Buffer;
    /** The server proof we expect back in M4; a mismatch means a wrong secret. */
    expectedServerProof: Buffer;
    /** Session key K = SHA512(S) — the input to the channel key derivation. */
    sessionKey: Buffer;
}
/**
 * Run the client half of SRP-6a against the device's salt and public key B.
 *
 * :param salt: the 16-byte salt from the M2 TLV, raw.
 * :param serverPublicKey: the device's public key B from the M2 TLV.
 * :param secret: the shared secret — {@link TRANSIENT_PIN} unless the device
 *   has a password, which replaces it.
 */
export declare function srpClientCompute(salt: Buffer, serverPublicKey: Buffer, secret: string, 
/** Private value `a`; random when omitted. Injectable so the exchange can be
 * checked against an independent implementation, which is the only way to
 * catch a padding convention that is wrong but self-consistent. */
privateKey?: Buffer): SrpClientResult;
