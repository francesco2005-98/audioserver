export type EventHandler = (...args: unknown[]) => void;
export declare class TypedEventEmitter<Events> {
    private readonly emitter;
    on<K extends keyof Events>(event: K, fn: Events[K]): this;
    once<K extends keyof Events>(event: K, fn: Events[K]): this;
    off<K extends keyof Events>(event: K, fn: Events[K]): this;
    emit<K extends keyof Events>(event: K, ...args: Events[K] extends (...args: infer P) => unknown ? P : never): boolean;
    removeAllListeners(event?: keyof Events): this;
}
