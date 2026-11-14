/** Combine two optional abort signals into one, without requiring AbortSignal.any. */
export declare function combineSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined;
