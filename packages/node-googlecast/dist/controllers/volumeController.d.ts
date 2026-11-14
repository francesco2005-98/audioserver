import type { ReceiverStatus } from '../protocol/messages.js';
import { BaseController } from './baseController.js';
export interface VolumeControllerEvents {
    volume: (volume: ReceiverStatus['status']['volume']) => void;
}
export declare class VolumeController extends BaseController<VolumeControllerEvents> {
    private volume?;
    constructor(channel: BaseController<VolumeControllerEvents>['channel']);
    handleMessage(message: unknown): void;
    setVolume(level: number, timeoutMs?: number): Promise<ReceiverStatus>;
    mute(muted: boolean, timeoutMs?: number): Promise<ReceiverStatus>;
    getCachedVolume(): ReceiverStatus['status']['volume'] | undefined;
}
