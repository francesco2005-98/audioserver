/**
 * Writing `bplist00` bodies — the encoding the AirPlay 2 session and stream
 * SETUP go out in.
 *
 * Two passes: every object is first interned in depth-first order so it has a
 * stable index, then each is serialised against those indices. Doing it in one
 * pass means emitting a reference before its target's index is settled, which
 * is how subtly-wrong plists get written — they parse, and the receiver reads
 * the wrong values.
 */
import { type PlistValue } from './bplist.js';
/**
 * An integer to be written as a signed 64-bit value whatever its magnitude —
 * the PTP ClockID goes out that way, as the reference sender does.
 */
export declare class PlistInt64 {
    readonly value: bigint;
    constructor(value: bigint);
}
export type PlistInput = PlistValue | PlistInt64 | PlistInput[] | {
    [key: string]: PlistInput;
};
/** Encode a value as a `bplist00` body. */
export declare function buildBinaryPlist(root: PlistInput): Buffer;
