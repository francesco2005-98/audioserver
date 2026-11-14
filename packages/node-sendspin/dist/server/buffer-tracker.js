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
export class PlayerBufferTracker {
    constructor() {
        this.chunks = [];
        /** The player's latest `output_delay_ms`, in microseconds. */
        this.outputDelayUs = 0;
    }
    /** Count one chunk as transmitted: its timestamp, its playing time and its size on the wire. */
    register(timestampUs, durationUs, bytes) {
        this.chunks.push({ endUs: timestampUs + Math.max(0, durationUs), bytes });
    }
    /** Empty the count: a player `stream/clear` (without `from_timestamp`) or `stream/end`. */
    reset() {
        this.chunks = [];
    }
    /** Bytes the player still holds at `nowUs` (server clock). */
    bufferedBytes(nowUs) {
        const cutoff = nowUs + this.outputDelayUs;
        this.chunks = this.chunks.filter((chunk) => chunk.endUs > cutoff);
        return this.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
    }
    /**
     * Microseconds from `nowUs` until `bytes` more fit under `capacity`: 0 when they
     * fit now, Infinity when they never can (a chunk larger than the whole buffer).
     */
    timeUntilFreeUs(bytes, capacity, nowUs) {
        if (bytes > capacity)
            return Infinity;
        let held = this.bufferedBytes(nowUs);
        if (held + bytes <= capacity)
            return 0;
        const byEnd = [...this.chunks].sort((a, b) => a.endUs - b.endUs);
        for (const chunk of byEnd) {
            held -= chunk.bytes;
            if (held + bytes <= capacity)
                return Math.max(0, chunk.endUs - this.outputDelayUs - nowUs);
        }
        return 0;
    }
}
