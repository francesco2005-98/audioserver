/** Unwrap an `rsaaeskey` from the SDP into the 16-byte AES key. */
export declare function decryptAesKey(wrapped: Buffer): Buffer;
/**
 * Sign an `Apple-Challenge` into the `Apple-Response` header value.
 *
 * The signed blob is the challenge followed by our address and MAC, zero-filled
 * to 32 bytes. The sender rebuilds it from what it knows about us, so both
 * halves have to agree byte for byte.
 */
export declare function answerChallenge(challenge: Buffer, localAddress: string, mac: Buffer): string;
