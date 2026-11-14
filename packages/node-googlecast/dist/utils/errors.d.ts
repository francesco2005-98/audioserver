export declare class CastError extends Error {
    constructor(message: string);
}
export declare class ConnectionError extends CastError {
    constructor(message: string);
}
export declare class TimeoutError extends CastError {
    constructor(message: string);
}
export declare class ProtocolError extends CastError {
    constructor(message: string);
}
export declare class DiscoveryError extends CastError {
    constructor(message: string);
}
