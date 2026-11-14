"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.combineSignals = combineSignals;
/** Combine two optional abort signals into one, without requiring AbortSignal.any. */
function combineSignals(a, b) {
    if (!a)
        return b;
    if (!b)
        return a;
    const anyFn = AbortSignal.any;
    if (typeof anyFn === 'function')
        return anyFn([a, b]);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    a.addEventListener('abort', onAbort, { once: true });
    b.addEventListener('abort', onAbort, { once: true });
    return controller.signal;
}
