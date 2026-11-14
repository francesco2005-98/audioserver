export class SendspinEvent {
    constructor(type) {
        this.type = type;
    }
}
export class ClientAddedEvent extends SendspinEvent {
    constructor(clientId) {
        super('client-added');
        this.clientId = clientId;
    }
}
export class ClientRemovedEvent extends SendspinEvent {
    constructor(clientId) {
        super('client-removed');
        this.clientId = clientId;
    }
}
