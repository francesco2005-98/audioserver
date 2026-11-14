/**
 * ALAC decoding — what a receiver needs, and the mirror of `alac.ts`.
 *
 * Ported from libraop's `alac.c` (David Hammerton's decoder). A sender only
 * emits the uncompressed escape frames this project's encoder writes when
 * compression would not pay; a real sender — an iPhone, iTunes — sends the
 * compressed form nearly always, so a receiver has to implement the whole
 * thing: adaptive Rice entropy coding and the adaptive FIR predictor whose
 * coefficients are rewritten as it goes.
 *
 * The predictor is the part worth reading twice: its coefficient table is not
 * constant, it is nudged after every sample by the sign of the error, so
 * decoding is only correct if the table is updated in exactly the same order
 * the encoder did it.
 */
/** The stream parameters an ALAC decoder is configured with. */
export interface AlacConfig {
    /** Samples per frame — the SDP fmtp line's first value. */
    framesPerPacket: number;
    bitDepth: number;
    channels: number;
    sampleRate: number;
    /** Entropy coder tuning; the fmtp line carries these as 40 / 10 / 14. */
    riceHistoryMult: number;
    riceInitialHistory: number;
    riceKModifier: number;
}
/**
 * Read the ALAC parameters out of an SDP `a=fmtp` line.
 *
 * The line is the ALAC magic cookie in decimal:
 * `frameLength 0 bitDepth historyMult initialHistory kModifier channels 255 0 0 sampleRate`.
 */
export declare function parseAlacFmtp(fmtp: string): AlacConfig | null;
/**
 * Decodes ALAC frames to interleaved s16le PCM.
 *
 * One instance per stream: the scratch buffers are sized from the configuration
 * and reused, which matters at 125 frames a second.
 */
export declare class AlacDecoder {
    private readonly config;
    private readonly errorsA;
    private readonly errorsB;
    private readonly samplesA;
    private readonly samplesB;
    constructor(config: AlacConfig);
    /** Decode one frame. Returns interleaved s16le, or null when unsupported. */
    decode(frame: Buffer): Buffer | null;
    private readFrameHeader;
    private decodeMono;
    /** Read one channel's predictor description: quantisation and coefficients. */
    private readPredictorHeader;
    private decodeStereo;
}
