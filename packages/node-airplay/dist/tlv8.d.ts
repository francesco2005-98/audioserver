/**
 * HAP TLV8 encoding — the type/length/value form every pair-setup and
 * pair-verify message is carried in.
 *
 * A value longer than 255 bytes is split across repeated entries with the same
 * tag, each up to 255 bytes; a reader must concatenate consecutive same-tag
 * fragments back together. The SRP public keys are 384 bytes, so this is the
 * normal case, not an edge case.
 */
export declare const TLV: {
    readonly METHOD: 0;
    readonly IDENTIFIER: 1;
    readonly SALT: 2;
    readonly PUBLIC_KEY: 3;
    readonly PROOF: 4;
    readonly ENCRYPTED: 5;
    readonly STATE: 6;
    readonly ERROR: 7;
    readonly SIGNATURE: 10;
    readonly FLAGS: 19;
};
/** Human-readable meaning of a HAP TLV error code. */
export declare function tlvErrorText(code: number): string;
export declare class TlvWriter {
    private readonly parts;
    add(tag: number, value: Buffer): this;
    addByte(tag: number, value: number): this;
    build(): Buffer;
}
/**
 * Read a TLV8 body into a map of tag -> concatenated value. Consecutive
 * fragments of the same tag are joined; a tag that reappears after a different
 * tag in between starts a new value (and the first one wins, matching the
 * reference reader).
 */
export declare function parseTlv(data: Buffer): Map<number, Buffer>;
