export declare class SendspinEvent {
    readonly type: string;
    constructor(type: string);
}
export declare class ClientAddedEvent extends SendspinEvent {
    readonly clientId: string;
    constructor(clientId: string);
}
export declare class ClientRemovedEvent extends SendspinEvent {
    readonly clientId: string;
    constructor(clientId: string);
}
//# sourceMappingURL=events.d.ts.map