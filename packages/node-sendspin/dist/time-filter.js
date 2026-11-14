/**
 * Two-dimensional Kalman filter for Sendspin time synchronisation.
 *
 * The algorithm the spec defines (messaging.md "Time filter", #303), with its
 * recommended parameters, as aiosendspin's `time_sync.py` and the C++ reference
 * implementation run it.
 */
/** Multiple of `max_error` above which a residual counts as large. */
const ADAPTIVE_CUTOFF = 3.0;
/** Scale from `max_error` to the measurement standard deviation. */
const MAX_ERROR_SCALE = 0.5;
/** Signal-to-noise ratio `drift` must exceed before conversions apply it, squared. */
const DRIFT_SIGNIFICANCE_THRESHOLD_SQUARED = 2.0 * 2.0;
/** Value `count` must reach before adaptive forgetting applies. */
const MIN_SAMPLES = 100;
class TimeElement {
    constructor() {
        this.lastUpdate = 0;
        this.offset = 0;
        this.drift = 0;
        this.useDrift = false;
    }
}
/** `round` as the spec defines it: halves away from zero (`Math.round` rounds them up). */
function roundHalfAway(value) {
    return value < 0 ? -Math.round(-value) : Math.round(value);
}
export class SendspinTimeFilter {
    constructor(processStdDev = 0.0, forgetFactor = 2.0, driftProcessStdDev = 1e-11) {
        this.lastUpdate = 0;
        this.count = 0;
        this.offset = 0;
        this.drift = 0;
        this.offsetCovariance = Number.POSITIVE_INFINITY;
        this.offsetDriftCovariance = 0;
        this.driftCovariance = 0;
        this.current = new TimeElement();
        this.processVariance = processStdDev * processStdDev;
        this.driftProcessVariance = driftProcessStdDev * driftProcessStdDev;
        this.forgetVarianceFactor = forgetFactor * forgetFactor;
    }
    /**
     * Feed one measurement: `measurement` and `maxError` from a `server/time` exchange
     * (see {@link SendspinTimeFilter.measure}), `timeAdded` the client's receive time.
     */
    update(measurement, maxError, timeAdded) {
        if (timeAdded <= this.lastUpdate || maxError <= 0)
            return;
        const dt = timeAdded - this.lastUpdate;
        this.lastUpdate = timeAdded;
        const stdDev = maxError * MAX_ERROR_SCALE;
        const measurementVariance = stdDev * stdDev;
        if (this.count <= 0) {
            this.count = 1;
            this.offset = measurement;
            this.offsetCovariance = measurementVariance;
            this.drift = 0;
            this.current = { lastUpdate: this.lastUpdate, offset: this.offset, drift: this.drift, useDrift: false };
            return;
        }
        if (this.count === 1) {
            this.count = 2;
            this.drift = (measurement - this.offset) / dt;
            this.driftCovariance = (this.offsetCovariance + measurementVariance) / (dt * dt);
            this.offset = measurement;
            this.offsetCovariance = measurementVariance;
            this.current = { lastUpdate: this.lastUpdate, offset: this.offset, drift: this.drift, useDrift: false };
            return;
        }
        const offsetPrediction = this.offset + this.drift * dt;
        let newOffsetCovariance = this.offsetCovariance +
            2 * this.offsetDriftCovariance * dt +
            this.driftCovariance * dt * dt +
            this.processVariance * dt;
        let newOffsetDriftCovariance = this.offsetDriftCovariance + this.driftCovariance * dt;
        let newDriftCovariance = this.driftCovariance + this.driftProcessVariance * dt;
        const residual = measurement - offsetPrediction;
        if (this.count < MIN_SAMPLES) {
            this.count += 1;
        }
        else if (Math.abs(residual) > ADAPTIVE_CUTOFF * maxError) {
            newOffsetCovariance *= this.forgetVarianceFactor;
            newOffsetDriftCovariance *= this.forgetVarianceFactor;
            newDriftCovariance *= this.forgetVarianceFactor;
        }
        // Floored so a zero-error loopback cannot divide by zero.
        const uncertainty = 1.0 / Math.max(newOffsetCovariance + measurementVariance, 1e-9);
        const offsetGain = newOffsetCovariance * uncertainty;
        const driftGain = newOffsetDriftCovariance * uncertainty;
        this.offset = offsetPrediction + offsetGain * residual;
        this.drift += driftGain * residual;
        this.offsetCovariance = newOffsetCovariance - offsetGain * newOffsetCovariance;
        this.offsetDriftCovariance = newOffsetDriftCovariance - driftGain * newOffsetCovariance;
        this.driftCovariance = newDriftCovariance - driftGain * newOffsetDriftCovariance;
        const useDrift = this.drift * this.drift > DRIFT_SIGNIFICANCE_THRESHOLD_SQUARED * this.driftCovariance;
        this.current = { lastUpdate: this.lastUpdate, offset: this.offset, drift: this.drift, useDrift };
    }
    /**
     * The measurement and its `max_error` from one `server/time` exchange, with the
     * spec's integer arithmetic (`/ 2` truncating toward zero). `receivedUs` is the
     * client's receive time of the reply, also the measurement's `time_added`.
     */
    static measure(reply, receivedUs) {
        const t1 = reply.client_transmitted;
        const t2 = reply.server_received;
        const t3 = reply.server_transmitted;
        const t4 = receivedUs;
        return {
            measurement: Math.trunc((t2 - t1 + (t3 - t4)) / 2),
            maxError: Math.trunc((t4 - t1 - (t3 - t2)) / 2),
        };
    }
    computeServerTime(clientTime) {
        const element = this.current;
        const drift = element.useDrift ? element.drift : 0;
        return clientTime + roundHalfAway(element.offset + drift * (clientTime - element.lastUpdate));
    }
    computeClientTime(serverTime) {
        const element = this.current;
        const drift = element.useDrift ? element.drift : 0;
        return roundHalfAway((serverTime - element.offset + drift * element.lastUpdate) / (1 + drift));
    }
    reset() {
        this.count = 0;
        this.lastUpdate = 0;
        this.offset = 0;
        this.drift = 0;
        this.offsetCovariance = Number.POSITIVE_INFINITY;
        this.offsetDriftCovariance = 0;
        this.driftCovariance = 0;
        this.current = new TimeElement();
    }
    /** How many measurements the filter has taken (it stops counting at 100). */
    get measurements() {
        return this.count;
    }
    get isSynchronized() {
        return this.count >= 2 && Number.isFinite(this.offsetCovariance);
    }
    get error() {
        return Math.round(Math.sqrt(this.offsetCovariance));
    }
    get covariance() {
        return Math.round(this.offsetCovariance);
    }
    get offsetUs() {
        return this.offset;
    }
}
