"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SonosNamespace = void 0;
/**
 * Base helper for namespace handlers.
 */
class SonosNamespace {
    api;
    namespace;
    eventKey;
    listeners = new Map();
    eventType;
    constructor(api, namespace, eventType, eventKey) {
        this.api = api;
        this.namespace = namespace;
        this.eventKey = eventKey;
        this.eventType = eventType;
    }
    async handleSubscribe(id, callback) {
        if (this.listeners.has(id)) {
            this.api.logger.error(`Duplicate subscription detected for ${id}`);
        }
        await this.api.sendCommand(this.namespace, 'subscribe', undefined, { [this.eventKey]: id });
        this.listeners.set(id, callback);
        return () => {
            this.listeners.delete(id);
            this.api.sendCommandNoWait(this.namespace, 'unsubscribe', undefined, { [this.eventKey]: id });
        };
    }
    handleEvent(event, eventData) {
        const id = event[this.eventKey];
        if (typeof id === 'string') {
            const handler = this.listeners.get(id);
            handler?.(eventData);
        }
    }
}
exports.SonosNamespace = SonosNamespace;
