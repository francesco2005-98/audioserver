export class CastError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CastError';
    }
}
export class ConnectionError extends CastError {
    constructor(message) {
        super(message);
        this.name = 'ConnectionError';
    }
}
export class TimeoutError extends CastError {
    constructor(message) {
        super(message);
        this.name = 'TimeoutError';
    }
}
export class ProtocolError extends CastError {
    constructor(message) {
        super(message);
        this.name = 'ProtocolError';
    }
}
export class DiscoveryError extends CastError {
    constructor(message) {
        super(message);
        this.name = 'DiscoveryError';
    }
}
