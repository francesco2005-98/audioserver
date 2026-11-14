export interface BackoffOptions {
    baseMs: number;
    maxMs: number;
    factor: number;
    jitter: number;
}
export declare class Backoff {
    private readonly options;
    private attempt;
    constructor(options: BackoffOptions);
    nextDelay(): number;
    reset(): void;
}
