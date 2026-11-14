import protobufjs from 'protobufjs';
import { ProtocolError } from '../utils/errors.js';
const CAST_CHANNEL_PROTO = `
syntax = "proto2";

package extensions.api.cast_channel;

message CastMessage {
  enum ProtocolVersion {
    CASTV2_1_0 = 0;
  }

  required ProtocolVersion protocol_version = 1;
  required string source_id = 2;
  required string destination_id = 3;
  required string namespace = 4;

  enum PayloadType {
    STRING = 0;
    BINARY = 1;
  }

  required PayloadType payload_type = 5;
  optional string payload_utf8 = 6;
  optional bytes payload_binary = 7;
}
`;
let castMessageType = null;
const ensureLoaded = async () => {
    if (castMessageType) {
        return castMessageType;
    }
    const { parse } = protobufjs;
    const root = parse(CAST_CHANNEL_PROTO, { keepCase: true }).root;
    const type = root.lookupType('extensions.api.cast_channel.CastMessage');
    castMessageType = {
        encode: (message) => type.encode(message),
        decode: (buffer) => type.decode(buffer),
    };
    return castMessageType;
};
export const encodeCastMessage = async (payload) => {
    const type = await ensureLoaded();
    const message = {
        protocol_version: 'CASTV2_1_0',
        source_id: payload.sourceId,
        destination_id: payload.destinationId,
        namespace: payload.namespace,
        payload_type: payload.payloadType,
        payload_utf8: payload.payloadUtf8,
        payload_binary: payload.payloadBinary,
    };
    return type.encode(message).finish();
};
export const decodeCastMessage = async (buffer) => {
    const type = await ensureLoaded();
    const decoded = type.decode(buffer);
    const namespace = decoded['namespace'];
    const sourceId = decoded['source_id'];
    const destinationId = decoded['destination_id'];
    const payloadTypeRaw = decoded['payload_type'];
    if (!namespace || !sourceId || !destinationId || payloadTypeRaw === undefined) {
        throw new ProtocolError('Invalid CastMessage payload');
    }
    const payloadType = payloadTypeRaw === 'BINARY' || payloadTypeRaw === 1 ? 'BINARY' : 'STRING';
    const result = {
        namespace,
        sourceId,
        destinationId,
        payloadType,
    };
    const payloadUtf8 = decoded['payload_utf8'];
    if (typeof payloadUtf8 === 'string') {
        result.payloadUtf8 = payloadUtf8;
    }
    const payloadBinary = decoded['payload_binary'];
    if (payloadBinary instanceof Uint8Array) {
        result.payloadBinary = payloadBinary;
    }
    return result;
};
