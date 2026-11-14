import type { BaseController } from '../controllers/baseController.js';
import type { EventHandler } from '../utils/eventMap.js';
export declare class ControllerRegistry {
    private readonly controllers;
    register<Events extends {
        [K in keyof Events]: EventHandler;
    }>(controller: BaseController<Events>): void;
    unregister(namespace: string): void;
    get(namespace: string): BaseController<Record<string, EventHandler>> | undefined;
    values(): IterableIterator<BaseController<Record<string, EventHandler>>>;
}
