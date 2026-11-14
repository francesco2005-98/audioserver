import EventEmitter from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { ClientAddedEvent, ClientRemovedEvent } from './events.js';
import { ServerClient } from './server-client.js';
export class SendspinServer extends EventEmitter {
    constructor(serverId, serverName, opts = {}) {
        super();
        this.clients = new Set();
        this.serverId = serverId;
        this.serverName = serverName;
        this.opts = opts;
    }
    get connectedClients() {
        return this.clients;
    }
    async start(options = {}) {
        if (this.wss)
            return;
        const port = options.port ?? 8927;
        const host = options.host ?? '0.0.0.0';
        const path = options.path ?? this.opts.path ?? '/sendspin';
        this.wss = new WebSocketServer({ port, host, path });
        this.wss.on('connection', (ws) => this.registerClient(ws, 'incoming'));
    }
    async stop() {
        for (const client of [...this.clients]) {
            client.close();
        }
        await new Promise((resolve) => {
            if (!this.wss)
                return resolve();
            this.wss.close(() => resolve());
            this.wss = undefined;
        });
    }
    connectToClient(url) {
        const ws = new WebSocket(url);
        ws.on('open', () => this.registerClient(ws, 'outgoing'));
        ws.on('error', () => ws.close());
    }
    registerClient(ws, side) {
        const opts = {
            connectionSide: side,
            defaultRoles: this.opts.defaultRoles,
            serverId: this.serverId,
            serverName: this.serverName,
            serverVersion: this.opts.serverVersion,
        };
        const client = new ServerClient(ws, opts);
        this.clients.add(client);
        this.emitEvent(new ClientAddedEvent(client.clientId ?? 'unknown'));
        client.on('disconnect', () => {
            this.clients.delete(client);
            this.emitEvent(new ClientRemovedEvent(client.clientId ?? 'unknown'));
        });
    }
    emitEvent(event) {
        this.emit(event.type, event);
    }
}
