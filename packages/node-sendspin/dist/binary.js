import { BinaryMessageType } from './types.js';
export const BINARY_HEADER_FORMAT = '>Bq';
export const BINARY_HEADER_SIZE = 9;
export function unpackBinaryHeader(data) {
    if (data.byteLength < BINARY_HEADER_SIZE) {
        throw new Error(`Expected at least ${BINARY_HEADER_SIZE} bytes, got ${data.byteLength}`);
    }
    const buffer = Buffer.from(data);
    const messageType = buffer.readUInt8(0);
    const timestampUs = Number(buffer.readBigInt64BE(1));
    return { messageType, timestampUs };
}
export function packBinaryHeader(header) {
    const buffer = Buffer.alloc(BINARY_HEADER_SIZE);
    buffer.writeUInt8(header.messageType, 0);
    buffer.writeBigInt64BE(BigInt(header.timestampUs), 1);
    return buffer;
}
export function packBinaryHeaderRaw(messageType, timestampUs) {
    return packBinaryHeader({ messageType: Number(messageType), timestampUs });
}
/*
 * Player audio chunks (spec 1.0.0-rc1, #167): `[0x04][timestamp int64][send_ahead uint32][payload]`.
 *
 * `send_ahead` is how far ahead of `timestamp` the chunk left the server, so it has
 * to be written at transmit — after any queueing, immediately before encryption —
 * not when the chunk is built. Pre-rc1 peers still read the 9-byte header
 * (`BINARY_HEADER_SIZE`), and must keep getting exactly that.
 */
/** Header of an rc1 player audio chunk: type, timestamp and send_ahead. */
export const PLAYER_AUDIO_HEADER_SIZE = 13;
/** Header of a pre-rc1 player audio chunk: type and timestamp only. */
export const LEGACY_PLAYER_AUDIO_HEADER_SIZE = BINARY_HEADER_SIZE;
/** Byte offset of `send_ahead` within an rc1 audio chunk. */
export const PLAYER_AUDIO_SEND_AHEAD_OFFSET = 9;
const UINT32_MAX = 0xffffffff;
/** `max(0, min(timestamp - now, 0xFFFFFFFF))`, in µs. */
export function computeSendAhead(timestampUs, nowUs) {
    return Math.max(0, Math.min(Math.floor(timestampUs - nowUs), UINT32_MAX));
}
/** Pack a 13-byte rc1 audio chunk header. Pass `sendAheadUs = 0` and stamp it later with {@link stampSendAhead}. */
export function packPlayerAudioHeader(timestampUs, sendAheadUs = 0) {
    const buffer = Buffer.alloc(PLAYER_AUDIO_HEADER_SIZE);
    buffer.writeUInt8(BinaryMessageType.AUDIO_CHUNK, 0);
    buffer.writeBigInt64BE(BigInt(Math.round(timestampUs)), 1);
    buffer.writeUInt32BE(Math.max(0, Math.min(Math.floor(sendAheadUs), UINT32_MAX)), PLAYER_AUDIO_SEND_AHEAD_OFFSET);
    return buffer;
}
export function unpackPlayerAudioHeader(data) {
    if (data.byteLength < PLAYER_AUDIO_HEADER_SIZE) {
        throw new Error(`Expected at least ${PLAYER_AUDIO_HEADER_SIZE} bytes, got ${data.byteLength}`);
    }
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    return {
        messageType: buffer.readUInt8(0),
        timestampUs: Number(buffer.readBigInt64BE(1)),
        sendAheadUs: buffer.readUInt32BE(PLAYER_AUDIO_SEND_AHEAD_OFFSET),
    };
}
/** Write `send_ahead` into an rc1 audio chunk in place, from its own timestamp and `nowUs`. */
export function stampSendAhead(chunk, nowUs) {
    const timestampUs = Number(chunk.readBigInt64BE(1));
    chunk.writeUInt32BE(computeSendAhead(timestampUs, nowUs), PLAYER_AUDIO_SEND_AHEAD_OFFSET);
}
/*
 * Artwork transfers (spec 1.0.0-rc1, #188): an image goes out as a 14-byte announce
 * `[type][0x02][timestamp int64][total_size uint32]` followed by parts
 * `[type][0x00][data]`, each message at most 65519 bytes so it fits one Noise
 * transport message unfragmented. `[type][0x01]` cancels a transfer in flight. A
 * pre-rc1 (hello-declared) artwork peer instead reads one `[type][timestamp][image]`.
 */
export const ARTWORK_FLAG_CANCEL = 0x01;
export const ARTWORK_FLAG_ANNOUNCE = 0x02;
export const ARTWORK_RESERVED_FLAGS = 0xfc;
export const ARTWORK_MAX_MESSAGE_SIZE = 65519;
export const ARTWORK_ANNOUNCE_SIZE = 14;
export const ARTWORK_MAX_PART_DATA_SIZE = ARTWORK_MAX_MESSAGE_SIZE - 2;
function artworkType(channel) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 3) {
        throw new Error(`artwork channel must be 0-3, got ${channel}`);
    }
    return BinaryMessageType.ARTWORK_CHANNEL_0 + channel;
}
export function packArtworkAnnounce(channel, timestampUs, totalSize) {
    const buffer = Buffer.alloc(ARTWORK_ANNOUNCE_SIZE);
    buffer.writeUInt8(artworkType(channel), 0);
    buffer.writeUInt8(ARTWORK_FLAG_ANNOUNCE, 1);
    buffer.writeBigInt64BE(BigInt(Math.round(timestampUs)), 2);
    buffer.writeUInt32BE(totalSize, 10);
    return buffer;
}
/** The part messages carrying `image` on `channel`, each within the 65519-byte cap. */
export function packArtworkParts(channel, image) {
    const prefix = Buffer.from([artworkType(channel), 0]);
    const parts = [];
    for (let offset = 0; offset < image.length; offset += ARTWORK_MAX_PART_DATA_SIZE) {
        parts.push(Buffer.concat([prefix, image.subarray(offset, offset + ARTWORK_MAX_PART_DATA_SIZE)]));
    }
    return parts;
}
export function packArtworkCancel(channel) {
    return Buffer.from([artworkType(channel), ARTWORK_FLAG_CANCEL]);
}
