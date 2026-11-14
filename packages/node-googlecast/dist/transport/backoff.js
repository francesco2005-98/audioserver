export class Backoff {
    options;
    attempt = 0;
    constructor(options) {
        this.options = options;
    }
    nextDelay() {
        const exp = Math.min(this.options.maxMs, this.options.baseMs * Math.pow(this.options.factor, this.attempt));
        this.attempt += 1;
        const jitter = exp * this.options.jitter * Math.random();
        return exp + jitter;
    }
    reset() {
        this.attempt = 0;
    }
}
