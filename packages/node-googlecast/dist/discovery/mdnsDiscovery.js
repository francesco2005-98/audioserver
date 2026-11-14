import mdns from 'multicast-dns';
import { TypedEventEmitter } from '../utils/eventMap.js';
import { createNoopLogger } from '../utils/logger.js';
import { DiscoveryError } from '../utils/errors.js';
const SERVICE_TYPE = '_googlecast._tcp.local';
export class MdnsDiscovery extends TypedEventEmitter {
    mdnsInstance = mdns();
    logger;
    queryIntervalMs;
    deviceTimeoutMs;
    records = new Map();
    devices = new Map();
    queryTimer;
    cleanupTimer;
    started = false;
    constructor(options = {}) {
        super();
        this.queryIntervalMs = options.queryIntervalMs ?? 5000;
        this.deviceTimeoutMs = options.deviceTimeoutMs ?? 15000;
        this.logger = options.logger ?? createNoopLogger();
    }
    start() {
        if (this.started) {
            return;
        }
        this.started = true;
        this.logger.info('mDNS discovery started');
        this.mdnsInstance.on('response', (response) => this.handleResponse((response.answers ?? [])));
        this.mdnsInstance.on('error', (error) => this.emit('error', error));
        this.queryTimer = setInterval(() => this.query(), this.queryIntervalMs);
        this.cleanupTimer = setInterval(() => this.cleanup(), this.deviceTimeoutMs);
        this.query();
    }
    async stop() {
        if (!this.started) {
            return;
        }
        this.started = false;
        this.logger.info('mDNS discovery stopped');
        if (this.queryTimer) {
            clearInterval(this.queryTimer);
        }
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
        await new Promise((resolve, reject) => this.mdnsInstance.destroy((error) => (error ? reject(error) : resolve())));
    }
    getDevices() {
        return Array.from(this.devices.values());
    }
    query() {
        try {
            this.mdnsInstance.query([{ name: SERVICE_TYPE, type: 'PTR' }]);
        }
        catch (error) {
            this.emit('error', new DiscoveryError(String(error)));
        }
    }
    handleResponse(records) {
        const now = Date.now();
        for (const answer of records) {
            if (answer.type === 'PTR' && answer.name === SERVICE_TYPE) {
                this.ensureRecord(answer.data, now);
            }
            if (answer.type === 'SRV' && answer.data) {
                const record = this.records.get(answer.name);
                if (record) {
                    record.host = answer.data.target;
                    record.port = answer.data.port;
                    record.lastSeen = now;
                }
            }
            if (answer.type === 'TXT' && answer.data) {
                const record = this.records.get(answer.name);
                if (record) {
                    record.txt = this.parseTxt(answer.data);
                    record.lastSeen = now;
                }
            }
        }
        for (const [name, record] of this.records) {
            const device = this.toDevice(name, record);
            if (!device) {
                continue;
            }
            const existing = this.devices.get(device.id);
            if (!existing) {
                this.devices.set(device.id, device);
                this.logger.info('Device discovered', { name: device.name, host: device.host });
                this.emit('deviceUp', device);
            }
            else if (existing.lastSeen !== device.lastSeen) {
                this.devices.set(device.id, device);
                this.logger.debug('Device updated', { name: device.name, host: device.host });
                this.emit('deviceUpdated', device);
            }
        }
    }
    ensureRecord(name, now) {
        const existing = this.records.get(name);
        if (existing) {
            existing.lastSeen = now;
            return;
        }
        this.records.set(name, { name, lastSeen: now });
    }
    parseTxt(entries) {
        const result = {};
        for (const entry of entries) {
            const text = Buffer.isBuffer(entry) ? entry.toString('utf8') : entry;
            const [key, ...rest] = text.split('=');
            if (!key) {
                continue;
            }
            result[key] = rest.join('=');
        }
        return result;
    }
    toDevice(name, record) {
        if (!record.host || !record.port) {
            return null;
        }
        const txt = record.txt ?? {};
        const id = txt['id'] ?? name;
        const device = {
            id,
            name: txt['fn'] ?? name,
            host: record.host,
            port: record.port,
            txt,
            lastSeen: record.lastSeen,
        };
        if (txt['md']) {
            device.model = txt['md'];
        }
        if (txt['ca']) {
            device.capabilities = txt['ca'].split(',');
        }
        return device;
    }
    cleanup() {
        const now = Date.now();
        for (const [id, device] of this.devices) {
            if (now - device.lastSeen > this.deviceTimeoutMs) {
                this.devices.delete(id);
                this.emit('deviceDown', device);
            }
        }
    }
}
