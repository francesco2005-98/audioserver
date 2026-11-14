import { Namespaces } from '../protocol/namespaces.js';
import { BaseController } from './baseController.js';
import { CastStatusModel } from '../core/models.js';
export class ReceiverController extends BaseController {
    status;
    castStatus;
    constructor(channel) {
        super(channel, Namespaces.RECEIVER, 'sender-0', 'receiver-0');
    }
    handleMessage(message) {
        const payload = message;
        if (payload.type === 'RECEIVER_STATUS') {
            this.status = payload;
            this.castStatus = CastStatusModel.fromReceiverStatus(payload);
            this.emit('status', payload);
            this.emit('castStatus', this.castStatus);
        }
        if (payload.type === 'APP_AVAILABILITY') {
            return;
        }
    }
    async getStatus(timeoutMs = 5000) {
        const response = await this.request({ type: 'GET_STATUS' }, timeoutMs, (payload) => {
            return payload.type === 'RECEIVER_STATUS';
        });
        this.status = response;
        this.castStatus = CastStatusModel.fromReceiverStatus(response);
        return response;
    }
    async launch(appId, timeoutMs = 10000) {
        const response = await this.request({ type: 'LAUNCH', appId }, timeoutMs, (payload) => {
            return payload.type === 'RECEIVER_STATUS';
        });
        this.status = response;
        this.castStatus = CastStatusModel.fromReceiverStatus(response);
        return response;
    }
    async stop(sessionId, timeoutMs = 5000) {
        const response = await this.request({ type: 'STOP', sessionId }, timeoutMs, (payload) => {
            return payload.type === 'RECEIVER_STATUS';
        });
        this.status = response;
        this.castStatus = CastStatusModel.fromReceiverStatus(response);
        return response;
    }
    getCachedStatus() {
        return this.status;
    }
    async getCastStatus(timeoutMs = 5000) {
        if (this.castStatus) {
            return this.castStatus;
        }
        const status = await this.getStatus(timeoutMs);
        this.castStatus = CastStatusModel.fromReceiverStatus(status);
        return this.castStatus;
    }
    getCachedCastStatus() {
        return this.castStatus;
    }
    async getSessions(timeoutMs = 5000) {
        const status = await this.getStatus(timeoutMs);
        return status.status.applications ?? [];
    }
    async getAppAvailability(appIds, timeoutMs = 5000) {
        const request = { type: 'GET_APP_AVAILABILITY', appId: appIds };
        const response = await this.request(request, timeoutMs, (payload) => payload.type === 'APP_AVAILABILITY');
        const availability = response.availability ?? {};
        return Object.fromEntries(Object.entries(availability).map(([appId, state]) => [appId, state === 'APP_AVAILABLE']));
    }
    async getVolume(timeoutMs = 5000) {
        const status = await this.getStatus(timeoutMs);
        return status.status.volume;
    }
}
