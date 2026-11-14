export const encodeFramedMessage = (payload) => {
    const buffer = new Uint8Array(4 + payload.length);
    const view = new DataView(buffer.buffer);
    view.setUint32(0, payload.length, false);
    buffer.set(payload, 4);
    return buffer;
};
export const decodeFramedMessages = (buffer) => {
    const messages = [];
    let offset = 0;
    while (offset + 4 <= buffer.length) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const length = view.getUint32(offset, false);
        const end = offset + 4 + length;
        if (end > buffer.length) {
            break;
        }
        messages.push(buffer.slice(offset + 4, end));
        offset = end;
    }
    return { messages, bytesConsumed: offset };
};
export const concatBuffers = (a, b) => {
    const merged = new Uint8Array(a.length + b.length);
    merged.set(a, 0);
    merged.set(b, a.length);
    return merged;
};
