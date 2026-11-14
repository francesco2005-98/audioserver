import { EventEmitter } from 'eventemitter3';
export class TypedEventEmitter {
    emitter = new EventEmitter();
    on(event, fn) {
        this.emitter.on(event, fn);
        return this;
    }
    once(event, fn) {
        this.emitter.once(event, fn);
        return this;
    }
    off(event, fn) {
        this.emitter.off(event, fn);
        return this;
    }
    emit(event, ...args) {
        return this.emitter.emit(event, ...args);
    }
    removeAllListeners(event) {
        this.emitter.removeAllListeners(event);
        return this;
    }
}
