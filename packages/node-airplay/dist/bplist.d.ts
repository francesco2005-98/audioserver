/**
 * Apple binary property lists (`bplist00`) — the encoding every AirPlay 2
 * message body uses, from `GET /info` to the stream SETUP.
 *
 * Only the subset Apple actually emits is handled: null/bool, int, real, date,
 * data, ASCII and UTF-16BE strings, arrays, sets and dicts. UIDs appear in
 * keyed archives, which AirPlay does not use, so they decode to a plain number.
 */
export type PlistValue = null | boolean | number | bigint | string | Buffer | Date | PlistValue[] | {
    [key: string]: PlistValue;
};
export declare const BPLIST_HEADER = "bplist00";
export declare const BPLIST_TRAILER_SIZE = 32;
/** bplist dates count seconds from 2001-01-01, not the Unix epoch. */
export declare const APPLE_EPOCH_OFFSET_MS = 978307200000;
/** Decode a `bplist00` body. Throws when the header or trailer is not a plist. */
export declare function parseBinaryPlist(data: Buffer): PlistValue;
