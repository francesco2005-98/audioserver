import { TypedEventEmitter } from '../utils/eventMap.js';
import type { DiscoveredDevice } from '../discovery/types.js';
import type { CastChannelOptions } from '../transport/types.js';
import { CastChannel } from '../transport/castChannel.js';
import { ReceiverController } from '../controllers/receiverController.js';
import { MediaController } from '../controllers/mediaController.js';
import { VolumeController } from '../controllers/volumeController.js';
import type { CastDeviceEvents } from './events.js';
import type { CastSession } from './CastSession.js';
import type { BaseController } from '../controllers/baseController.js';
import type { CastStatusModel, MediaStatusModel } from './models.js';
import type { EventHandler } from '../utils/eventMap.js';
type ControllerEvents = Record<string, EventHandler>;
export interface CastDeviceOptions extends CastChannelOptions {
    device: DiscoveredDevice;
}
export declare class CastDevice extends TypedEventEmitter<CastDeviceEvents> {
    private readonly options;
    private readonly channel;
    private readonly registry;
    private readonly connectionController;
    private readonly receiverController;
    private readonly volumeController;
    private mediaController;
    private session?;
    constructor(options: CastDeviceOptions);
    get id(): string;
    get name(): string;
    get host(): string;
    get port(): number;
    get receiver(): ReceiverController;
    get media(): MediaController;
    get volume(): VolumeController;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    addController(controller: BaseController<ControllerEvents>): void;
    addAppController<T extends BaseController<ControllerEvents>>(namespace: string, factory: (channel: CastChannel, destinationId: string) => T): T;
    launchApp(appId: string, timeoutMs?: number): Promise<CastSession>;
    getSession(): CastSession | undefined;
    getCastStatus(timeoutMs?: number): Promise<CastStatusModel>;
    getMediaStatusModel(timeoutMs?: number): Promise<MediaStatusModel>;
    private handleReceiverStatus;
}
export {};
