import { TypedEventEmitter } from '../utils/eventMap.js';
export class BaseController extends TypedEventEmitter {
    channel;
    namespace;
    sourceId;
    destinationId;
    constructor(channel, namespace, sourceId, destinationId) {
        super();
        this.channel = channel;
        this.namespace = namespace;
        this.sourceId = sourceId;
        this.destinationId = destinationId;
    }
    async send(message) {
        await this.channel.sendJson(this.namespace, this.sourceId, this.destinationId, message);
    }
    async request(message, timeoutMs, predicate) {
        return this.channel.sendRequest(this.namespace, this.sourceId, this.destinationId, message, timeoutMs, predicate);
    }
    getDestinationId() {
        return this.destinationId;
    }
}
