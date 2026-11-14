import type { CastMessagePayload } from '../transport/types.js';
export declare const encodeCastMessage: (payload: CastMessagePayload) => Promise<Uint8Array>;
export declare const decodeCastMessage: (buffer: Uint8Array) => Promise<CastMessagePayload>;
