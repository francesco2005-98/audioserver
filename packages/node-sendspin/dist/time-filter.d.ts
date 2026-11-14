/**
 * Two-dimensional Kalman filter for Sendspin time synchronisation.
 *
 * The algorithm the spec defines (messaging.md "Time filter", #303), with its
 * recommended parameters, as aiosendspin's `time_sync.py` and the C++ reference
 * implementation run it.
 */
export declare class SendspinTimeFilter {
    private lastUpdate;
    private count;
    private offset;
    private drift;
    private offsetCovariance;
    private offsetDriftCovariance;
    private driftCovariance;
    private readonly processVariance;
    private readonly driftProcessVariance;
    private readonly forgetVarianceFactor;
    private current;
    constructor(processStdDev?: number, forgetFactor?: number, driftProcessStdDev?: number);
    /**
     * Feed one measurement: `measurement` and `maxError` from a `server/time` exchange
     * (see {@link SendspinTimeFilter.measure}), `timeAdded` the client's receive time.
     */
    update(measurement: number, maxError: number, timeAdded: number): void;
    /**
     * The measurement and its `max_error` from one `server/time` exchange, with the
     * spec's integer arithmetic (`/ 2` truncating toward zero). `receivedUs` is the
     * client's receive time of the reply, also the measurement's `time_added`.
     */
    static measure(reply: {
        client_transmitted: number;
        server_received: number;
        server_transmitted: number;
    }, receivedUs: number): {
        measurement: number;
        maxError: number;
    };
    computeServerTime(clientTime: number): number;
    computeClientTime(serverTime: number): number;
    reset(): void;
    /** How many measurements the filter has taken (it stops counting at 100). */
    get measurements(): number;
    get isSynchronized(): boolean;
    get error(): number;
    get covariance(): number;
    get offsetUs(): number;
}
//# sourceMappingURL=time-filter.d.ts.map