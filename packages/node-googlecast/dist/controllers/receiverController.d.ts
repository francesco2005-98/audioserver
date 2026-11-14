import type { ReceiverStatus } from '../protocol/messages.js';
import { BaseController } from './baseController.js';
import { CastStatusModel } from '../core/models.js';
export interface ReceiverControllerEvents {
    status: (status: ReceiverStatus) => void;
    castStatus: (status: CastStatusModel) => void;
}
export declare class ReceiverController extends BaseController<ReceiverControllerEvents> {
    private status?;
    private castStatus?;
    constructor(channel: BaseController<ReceiverControllerEvents>['channel']);
    handleMessage(message: unknown): void;
    getStatus(timeoutMs?: number): Promise<ReceiverStatus>;
    launch(appId: string, timeoutMs?: number): Promise<ReceiverStatus>;
    stop(sessionId: string, timeoutMs?: number): Promise<ReceiverStatus>;
    getCachedStatus(): ReceiverStatus | undefined;
    getCastStatus(timeoutMs?: number): Promise<CastStatusModel>;
    getCachedCastStatus(): CastStatusModel | undefined;
    getSessions(timeoutMs?: number): Promise<NonNullable<ReceiverStatus['status']['applications']>>;
    getAppAvailability(appIds: string | string[], timeoutMs?: number): Promise<Record<string, boolean>>;
    getVolume(timeoutMs?: number): Promise<ReceiverStatus['status']['volume']>;
}
