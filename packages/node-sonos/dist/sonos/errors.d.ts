export declare class SonosError extends Error {
    constructor(message: string);
}
export declare class TransportError extends SonosError {
    readonly causeError?: Error;
    constructor(message: string, error?: Error);
}
export declare class ConnectionClosed extends TransportError {
}
export declare class CannotConnect extends TransportError {
}
export declare class ConnectionFailed extends TransportError {
    constructor(error?: Error);
}
export declare class NotConnected extends SonosError {
}
export declare class InvalidState extends SonosError {
}
export declare class InvalidMessage extends SonosError {
}
export declare class FailedCommand extends SonosError {
    readonly errorCode: string;
    readonly details?: string;
    constructor(errorCode: string, details?: string);
}
