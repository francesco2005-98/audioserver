"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FailedCommand = exports.InvalidMessage = exports.InvalidState = exports.NotConnected = exports.ConnectionFailed = exports.CannotConnect = exports.ConnectionClosed = exports.TransportError = exports.SonosError = void 0;
class SonosError extends Error {
    constructor(message) {
        super(message);
        this.name = this.constructor.name;
    }
}
exports.SonosError = SonosError;
class TransportError extends SonosError {
    causeError;
    constructor(message, error) {
        super(message);
        this.causeError = error;
    }
}
exports.TransportError = TransportError;
class ConnectionClosed extends TransportError {
}
exports.ConnectionClosed = ConnectionClosed;
class CannotConnect extends TransportError {
}
exports.CannotConnect = CannotConnect;
class ConnectionFailed extends TransportError {
    constructor(error) {
        super(error ? `${error.message}` : 'Connection failed.', error);
    }
}
exports.ConnectionFailed = ConnectionFailed;
class NotConnected extends SonosError {
}
exports.NotConnected = NotConnected;
class InvalidState extends SonosError {
}
exports.InvalidState = InvalidState;
class InvalidMessage extends SonosError {
}
exports.InvalidMessage = InvalidMessage;
class FailedCommand extends SonosError {
    errorCode;
    details;
    constructor(errorCode, details) {
        super(`Command failed: ${details ?? errorCode}`);
        this.errorCode = errorCode;
        this.details = details;
    }
}
exports.FailedCommand = FailedCommand;
