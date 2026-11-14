/**
 * HAP TLV8 encoding — the type/length/value form every pair-setup and
 * pair-verify message is carried in.
 *
 * A value longer than 255 bytes is split across repeated entries with the same
 * tag, each up to 255 bytes; a reader must concatenate consecutive same-tag
 * fragments back together. The SRP public keys are 384 bytes, so this is the
 * normal case, not an edge case.
 */
export const TLV = {
    METHOD: 0x00,
    IDENTIFIER: 0x01,
    SALT: 0x02,
    PUBLIC_KEY: 0x03,
    PROOF: 0x04,
    ENCRYPTED: 0x05,
    STATE: 0x06,
    ERROR: 0x07,
    SIGNATURE: 0x0a,
    FLAGS: 0x13,
};
const MAX_FRAGMENT = 255;
/** Human-readable meaning of a HAP TLV error code. */
export function tlvErrorText(code) {
    switch (code) {
        case 0x01:
            return 'unknown';
        case 0x02:
            return 'authentication failed (wrong PIN or password)';
        case 0x03:
            return 'too many attempts (backoff)';
        case 0x04:
            return 'unknown peer';
        case 0x05:
            return 'max peers';
        case 0x06:
            return 'max tries';
        case 0x07:
            return 'unavailable';
        case 0x08:
            return 'busy';
        default:
            return `code ${code}`;
    }
}
export class TlvWriter {
    parts = [];
    add(tag, value) {
        if (value.length === 0) {
            this.parts.push(Buffer.from([tag, 0]));
            return this;
        }
        for (let offset = 0; offset < value.length; offset += MAX_FRAGMENT) {
            const chunk = value.subarray(offset, offset + MAX_FRAGMENT);
            this.parts.push(Buffer.from([tag, chunk.length]), chunk);
        }
        return this;
    }
    addByte(tag, value) {
        return this.add(tag, Buffer.from([value & 0xff]));
    }
    build() {
        return Buffer.concat(this.parts);
    }
}
/**
 * Read a TLV8 body into a map of tag -> concatenated value. Consecutive
 * fragments of the same tag are joined; a tag that reappears after a different
 * tag in between starts a new value (and the first one wins, matching the
 * reference reader).
 */
export function parseTlv(data) {
    const out = new Map();
    const done = new Set();
    let offset = 0;
    let previousTag = -1;
    while (offset + 2 <= data.length) {
        const tag = data[offset];
        const length = data[offset + 1];
        const start = offset + 2;
        if (start + length > data.length) {
            break;
        }
        const value = data.subarray(start, start + length);
        if (tag === previousTag && !done.has(tag)) {
            out.set(tag, Buffer.concat([out.get(tag), value]));
        }
        else if (!out.has(tag)) {
            out.set(tag, Buffer.from(value));
        }
        else {
            // A repeat of a tag we already closed off: keep the first value.
            done.add(tag);
        }
        if (tag !== previousTag && previousTag !== -1) {
            done.add(previousTag);
        }
        previousTag = tag;
        offset = start + length;
    }
    return out;
}
