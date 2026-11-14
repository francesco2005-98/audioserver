import { Namespaces } from '../protocol/namespaces.js';
import { BaseController } from './baseController.js';
export class ConnectionController extends BaseController {
    constructor(channel) {
        super(channel, Namespaces.CONNECTION, 'sender-0', 'receiver-0');
    }
    handleMessage(message) {
        const payload = message;
        if (payload.type === 'CLOSE') {
            this.emit('disconnect');
        }
    }
    async connect() {
        await this.send({ type: 'CONNECT' });
    }
    async disconnect() {
        await this.send({ type: 'CLOSE' });
    }
}
