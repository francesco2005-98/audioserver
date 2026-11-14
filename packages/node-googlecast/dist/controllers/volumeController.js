import { Namespaces } from '../protocol/namespaces.js';
import { BaseController } from './baseController.js';
export class VolumeController extends BaseController {
    volume;
    constructor(channel) {
        super(channel, Namespaces.RECEIVER, 'sender-0', 'receiver-0');
    }
    handleMessage(message) {
        const payload = message;
        if (payload.type === 'RECEIVER_STATUS') {
            this.volume = payload.status.volume;
            this.emit('volume', payload.status.volume);
        }
    }
    async setVolume(level, timeoutMs = 5000) {
        return this.request({ type: 'SET_VOLUME', volume: { level } }, timeoutMs, (payload) => payload.type === 'RECEIVER_STATUS');
    }
    async mute(muted, timeoutMs = 5000) {
        return this.request({ type: 'SET_VOLUME', volume: { muted } }, timeoutMs, (payload) => payload.type === 'RECEIVER_STATUS');
    }
    getCachedVolume() {
        return this.volume;
    }
}
