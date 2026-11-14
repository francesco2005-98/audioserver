import type { CastChannel } from '../transport/castChannel.js';
import { TypedEventEmitter } from '../utils/eventMap.js';
export declare abstract class BaseController<Events> extends TypedEventEmitter<Events> {
    protected readonly channel: CastChannel;
    readonly namespace: string;
    protected readonly sourceId: string;
    protected readonly destinationId: string;
    constructor(channel: CastChannel, namespace: string, sourceId: string, destinationId: string);
    abstract handleMessage(message: unknown): void;
    protected send(message: Record<string, unknown>): Promise<void>;
    protected request<T>(message: Record<string, unknown>, timeoutMs: number, predicate?: (payload: unknown) => boolean): Promise<T>;
    getDestinationId(): string;
}
