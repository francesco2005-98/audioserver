import { BaseController } from './baseController.js';
export interface ConnectionControllerEvents {
    disconnect: () => void;
}
export declare class ConnectionController extends BaseController<ConnectionControllerEvents> {
    constructor(channel: BaseController<ConnectionControllerEvents>['channel']);
    handleMessage(message: unknown): void;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
}
