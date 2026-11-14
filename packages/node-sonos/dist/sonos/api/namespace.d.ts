import type { SonosWebSocketApi } from './websocket';
export type SubscribeCallback<T> = (payload: T) => void;
export type UnsubscribeCallback = () => void;
/**
 * Base helper for namespace handlers.
 */
export declare class SonosNamespace<TEventPayload> {
    protected api: SonosWebSocketApi;
    protected namespace: string;
    protected eventKey: string;
    protected listeners: Map<string, SubscribeCallback<TEventPayload>>;
    readonly eventType: string;
    constructor(api: SonosWebSocketApi, namespace: string, eventType: string, eventKey: string);
    protected handleSubscribe(id: string, callback: SubscribeCallback<TEventPayload>): Promise<UnsubscribeCallback>;
    handleEvent(event: Record<string, unknown>, eventData: TEventPayload): void;
}
