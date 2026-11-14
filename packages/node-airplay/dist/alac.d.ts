/**
 * ALAC encoding for the AirPlay wire — uncompressed frames.
 *
 * ALAC's bitstream has an escape mode: a frame may carry its samples verbatim
 * instead of predictor + Rice output, and every decoder must handle it because
 * Apple's own encoder falls back to it whenever compression would not pay. That
 * is what this writes. The layout below is taken from libraop's decoder
 * (`alac.c`), which is what the receiver runs, so it is what the frame is
 * checked against.
 *
 * The cost is bandwidth: a 352-frame stereo packet is 1412 bytes instead of
 * roughly half that. On a LAN carrying one AirPlay stream that is not a
 * constraint, and it keeps the predictor and the adaptive Rice coder — the part
 * of ALAC that is genuinely intricate — out of the first working version. Real
 * compression can be added behind this same interface later; the receiver
 * cannot tell the difference beyond packet size.
 *
 * Uncompressed stereo frame:
 *   3 bits  element/channel count (1 = stereo)
 *   4 bits  unused
 *  12 bits  unused
 *   1 bit   hasSize
 *   2 bits  uncompressedBytes (0)
 *   1 bit   isNotCompressed (1)
 *  32 bits  sample count, only when hasSize
 *   then, per frame: left sample, right sample, each `bitDepth` bits
 *   3 bits  end-of-elements marker (7), then byte alignment
 */
export interface AlacEncoderOptions {
    /** Samples per frame the session negotiated (`spf`, 352 for AirPlay). */
    framesPerPacket: number;
    bitDepth: 16;
    channels: 2;
}
/**
 * Encode one packet of interleaved PCM as an uncompressed ALAC frame.
 *
 * :param pcm: interleaved signed 16-bit little-endian samples, exactly
 *   `framesPerPacket * channels` of them. A short final packet is allowed and
 *   is written with an explicit sample count.
 */
export declare function encodeAlacPacket(pcm: Buffer, options: AlacEncoderOptions): Buffer;
