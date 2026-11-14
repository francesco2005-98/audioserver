export declare const encodeFramedMessage: (payload: Uint8Array) => Uint8Array;
export declare const decodeFramedMessages: (buffer: Uint8Array<ArrayBufferLike>) => {
    messages: Uint8Array[];
    bytesConsumed: number;
};
export declare const concatBuffers: (a: Uint8Array<ArrayBufferLike>, b: Uint8Array<ArrayBufferLike>) => Uint8Array;
