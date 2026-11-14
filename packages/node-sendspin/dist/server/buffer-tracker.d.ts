/**
 * Player buffer accounting, as 1.0.0-rc1 defines it ("Player Buffer Accounting", #288).
 *
 * A player's `buffer_capacity` is a hard byte cap on what it holds: each audio
 * chunk counts its whole message (the 13-byte header on the rc1 wire, 9 on the
 * legacy one, plus the payload) from the moment it is transmitted until
 * `timestamp + duration - output_delay` on the server clock. A server MUST NOT
 * send a chunk that would push the count over the capacity. A player
 * `stream/clear` without `from_timestamp`, or a `stream/end`, empties the count,
 * and an output-delay update re-times every chunk still counted, which is why the
 * delay is applied when reading rather than stored per chunk.
 */
export declare class PlayerBufferTracker {
    private chunks;
    /** The player's latest `output_delay_ms`, in microseconds. */
    outputDelayUs: number;
    /** Count one chunk as transmitted: its timestamp, its playing time and its size on the wire. */
    register(timestampUs: number, durationUs: number, bytes: number): void;
    /** Empty the count: a player `stream/clear` (without `from_timestamp`) or `stream/end`. */
    reset(): void;
    /** Bytes the player still holds at `nowUs` (server clock). */
    bufferedBytes(nowUs: number): number;
    /**
     * Microseconds from `nowUs` until `bytes` more fit under `capacity`: 0 when they
     * fit now, Infinity when they never can (a chunk larger than the whole buffer).
     */
    timeUntilFreeUs(bytes: number, capacity: number, nowUs: number): number;
}
//# sourceMappingURL=buffer-tracker.d.ts.map