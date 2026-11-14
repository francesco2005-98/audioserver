import { BinaryMessageType } from './types.js';
export interface BinaryHeader {
    messageType: number;
    timestampUs: number;
}
export declare const BINARY_HEADER_FORMAT = ">Bq";
export declare const BINARY_HEADER_SIZE = 9;
export declare function unpackBinaryHeader(data: Buffer | Uint8Array): BinaryHeader;
export declare function packBinaryHeader(header: BinaryHeader): Buffer;
export declare function packBinaryHeaderRaw(messageType: BinaryMessageType | number, timestampUs: number): Buffer;
/** Header of an rc1 player audio chunk: type, timestamp and send_ahead. */
export declare const PLAYER_AUDIO_HEADER_SIZE = 13;
/** Header of a pre-rc1 player audio chunk: type and timestamp only. */
export declare const LEGACY_PLAYER_AUDIO_HEADER_SIZE = 9;
/** Byte offset of `send_ahead` within an rc1 audio chunk. */
export declare const PLAYER_AUDIO_SEND_AHEAD_OFFSET = 9;
export interface PlayerAudioHeader extends BinaryHeader {
    sendAheadUs: number;
}
/** `max(0, min(timestamp - now, 0xFFFFFFFF))`, in µs. */
export declare function computeSendAhead(timestampUs: number, nowUs: number): number;
/** Pack a 13-byte rc1 audio chunk header. Pass `sendAheadUs = 0` and stamp it later with {@link stampSendAhead}. */
export declare function packPlayerAudioHeader(timestampUs: number, sendAheadUs?: number): Buffer;
export declare function unpackPlayerAudioHeader(data: Buffer | Uint8Array): PlayerAudioHeader;
/** Write `send_ahead` into an rc1 audio chunk in place, from its own timestamp and `nowUs`. */
export declare function stampSendAhead(chunk: Buffer, nowUs: number): void;
export declare const ARTWORK_FLAG_CANCEL = 1;
export declare const ARTWORK_FLAG_ANNOUNCE = 2;
export declare const ARTWORK_RESERVED_FLAGS = 252;
export declare const ARTWORK_MAX_MESSAGE_SIZE = 65519;
export declare const ARTWORK_ANNOUNCE_SIZE = 14;
export declare const ARTWORK_MAX_PART_DATA_SIZE: number;
export declare function packArtworkAnnounce(channel: number, timestampUs: number, totalSize: number): Buffer;
/** The part messages carrying `image` on `channel`, each within the 65519-byte cap. */
export declare function packArtworkParts(channel: number, image: Buffer): Buffer[];
export declare function packArtworkCancel(channel: number): Buffer;
//# sourceMappingURL=binary.d.ts.map