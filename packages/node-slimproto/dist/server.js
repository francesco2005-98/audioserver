import { EventEmitter } from 'events';
import net from 'net';
import { startDiscovery } from './discovery.js';
import { SLIMPROTO_PORT } from './constants.js';
import { EventType } from './models.js';
import { getHostname, getIp } from './util.js';
import { SlimClient } from './client.js';
export class SlimServer extends EventEmitter {
    options;
    server;
    discovery;
    playersMap = new Map();
    subscriptions = [];
    constructor(options = {}) {
        super();
        this.options = options;
    }
    get players() {
        return Array.from(this.playersMap.values());
    }
    getPlayer(playerId) {
        return this.playersMap.get(playerId);
    }
    async start() {
        const ipAddress = this.options.ipAddress ?? (await getIp());
        const name = this.options.name ?? getHostname();
        const controlPort = this.options.controlPort ?? SLIMPROTO_PORT;
        this.server = net.createServer((socket) => this.registerPlayer(socket));
        await new Promise((resolve, reject) => {
            this.server?.once('error', reject);
            this.server?.listen(controlPort, '0.0.0.0', () => resolve());
        });
        this.discovery = startDiscovery({
            ipAddress,
            controlPort,
            cliPort: this.options.cliPort ?? null,
            cliPortJson: this.options.cliPortJson ?? null,
            name,
        });
    }
    async stop() {
        for (const client of this.playersMap.values()) {
            client.disconnect();
        }
        this.playersMap.clear();
        if (this.server) {
            await new Promise((resolve) => this.server?.close(() => resolve()));
            this.server = undefined;
        }
        this.discovery?.close();
        this.discovery = undefined;
    }
    subscribe(cb, eventFilter, playerFilter) {
        const eventList = eventFilter == null ? null : Array.isArray(eventFilter) ? eventFilter : [eventFilter];
        const playerList = playerFilter == null ? null : Array.isArray(playerFilter) ? playerFilter : [playerFilter];
        const subscription = { callback: cb, eventFilter: eventList, playerFilter: playerList };
        this.subscriptions.push(subscription);
        return () => {
            const idx = this.subscriptions.indexOf(subscription);
            if (idx >= 0)
                this.subscriptions.splice(idx, 1);
        };
    }
    registerPlayer(socket) {
        const client = new SlimClient(socket, (player, eventType, data) => {
            this.handleClientEvent(player, eventType, data);
        });
        socket.on('close', () => this.handleDisconnect(client));
        socket.on('error', () => this.handleDisconnect(client));
    }
    handleDisconnect(client) {
        if (client.playerId) {
            this.playersMap.delete(client.playerId);
        }
    }
    handleClientEvent(player, eventType, data) {
        const playerId = player.playerId;
        if (eventType === EventType.PLAYER_CONNECTED) {
            const existing = this.playersMap.get(playerId);
            if (existing && existing.connected) {
                player.disconnect();
                return;
            }
            if (existing) {
                existing.disconnect();
            }
            this.playersMap.set(playerId, player);
        }
        if (eventType === EventType.PLAYER_DISCONNECTED) {
            if (playerId) {
                this.playersMap.delete(playerId);
            }
        }
        this.forwardEvent(playerId, eventType, data);
    }
    forwardEvent(playerId, eventType, data) {
        const event = { type: eventType, playerId, data };
        this.emit(eventType, event);
        for (const sub of this.subscriptions) {
            if (sub.playerFilter && playerId && !sub.playerFilter.includes(playerId))
                continue;
            if (sub.eventFilter && !sub.eventFilter.includes(eventType))
                continue;
            Promise.resolve(sub.callback(event)).catch((err) => 
            // eslint-disable-next-line no-console
            console.error('Error in subscriber', err));
        }
    }
}
