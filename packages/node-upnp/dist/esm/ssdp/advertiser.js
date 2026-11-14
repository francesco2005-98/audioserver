import dgram from 'node:dgram';
const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const ADVERTISE_INTERVAL_MS = 30_000;
const MAX_AGE_SECONDS = 1800;
/**
 * SSDP presence responder — announces registered UPnP devices and answers
 * M-SEARCH so control points (BubbleUPnP, Samsung, VLC, B&O, …) discover them
 * without a manual poll. USNs follow the standard triple per device: root
 * device, device type, and each service type, all under that device's UDN.
 */
export class SsdpAdvertiser {
    socket;
    timer;
    running = false;
    devices = new Map();
    serverHeaderValue;
    log;
    constructor(options = {}) {
        this.serverHeaderValue = options.serverHeader ?? 'Linux/5 UPnP/1.0 node-upnp/1.0';
        this.log = options.logger;
    }
    /** Register (or replace) a device and announce it immediately if running. */
    addDevice(device) {
        this.devices.set(device.udn, device);
        if (this.running) {
            this.sendAliveFor(device);
        }
    }
    /** Remove a device and send byebye for it. */
    removeDevice(udn) {
        const device = this.devices.get(udn);
        if (!device) {
            return;
        }
        this.devices.delete(udn);
        if (this.running) {
            this.sendByebyeFor(device);
        }
    }
    hasDevices() {
        return this.devices.size > 0;
    }
    async start() {
        if (this.running) {
            return;
        }
        this.running = true;
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        this.socket = socket;
        socket.on('message', (msg, rinfo) => this.handleMessage(msg, rinfo));
        // Binding :1900 can fail — most often EADDRINUSE when another UPnP/DLNA
        // process on the host already holds the port. dgram reports that as an
        // 'error' event, NOT through the bind callback, so waiting only on the
        // callback would never settle and hang start() forever. SSDP presence is
        // best-effort: a failed bind must resolve (never hang, never throw) with the
        // advertiser left disabled, so the caller's startup carries on without UPnP.
        const bound = await new Promise((resolve) => {
            const onBindError = (error) => {
                this.log?.warn?.('ssdp bind failed; advertiser disabled', {
                    message: error.message,
                });
                resolve(false);
            };
            socket.once('error', onBindError);
            socket.bind(SSDP_PORT, () => {
                socket.removeListener('error', onBindError);
                try {
                    socket.addMembership(SSDP_ADDRESS);
                }
                catch (error) {
                    this.log?.warn?.('ssdp addMembership failed', {
                        message: error instanceof Error ? error.message : String(error),
                    });
                }
                resolve(true);
            });
        });
        if (!bound) {
            // Swallow any further error from the dead socket while tearing it down.
            socket.on('error', () => { });
            this.running = false;
            this.socket = undefined;
            try {
                socket.close();
            }
            catch {
                /* already unusable */
            }
            return;
        }
        // Steady-state errors after a successful bind: log and keep advertising.
        socket.on('error', (error) => {
            this.log?.warn?.('ssdp socket error', { message: error.message });
        });
        this.sendAlive();
        this.timer = setInterval(() => this.sendAlive(), ADVERTISE_INTERVAL_MS);
        this.timer.unref?.();
        this.log?.info?.('ssdp advertiser started', { devices: this.devices.size });
    }
    async stop() {
        if (!this.running) {
            return;
        }
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        try {
            this.sendByebye();
        }
        catch {
            /* best effort */
        }
        const socket = this.socket;
        this.socket = undefined;
        if (socket) {
            await new Promise((resolve) => {
                try {
                    socket.close(() => resolve());
                }
                catch {
                    resolve();
                }
            });
        }
    }
    notificationTypes(device) {
        return [
            { nt: 'upnp:rootdevice', usnSuffix: '::upnp:rootdevice' },
            { nt: device.udn, usnSuffix: '' },
            { nt: device.deviceType, usnSuffix: `::${device.deviceType}` },
            ...device.serviceTypes.map((svc) => ({ nt: svc, usnSuffix: `::${svc}` })),
        ];
    }
    sendAlive() {
        for (const device of this.devices.values()) {
            this.sendAliveFor(device);
        }
    }
    sendAliveFor(device) {
        const socket = this.socket;
        if (!socket) {
            return;
        }
        const location = device.location();
        for (const { nt, usnSuffix } of this.notificationTypes(device)) {
            const usn = `${device.udn}${usnSuffix}`;
            const message = 'NOTIFY * HTTP/1.1\r\n' +
                `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\n` +
                `CACHE-CONTROL: max-age=${MAX_AGE_SECONDS}\r\n` +
                `LOCATION: ${location}\r\n` +
                'NTS: ssdp:alive\r\n' +
                `NT: ${nt}\r\n` +
                `SERVER: ${this.serverHeaderValue}\r\n` +
                `USN: ${usn}\r\n` +
                '\r\n';
            const buf = Buffer.from(message, 'ascii');
            socket.send(buf, 0, buf.length, SSDP_PORT, SSDP_ADDRESS);
        }
    }
    sendByebye() {
        for (const device of this.devices.values()) {
            this.sendByebyeFor(device);
        }
    }
    sendByebyeFor(device) {
        const socket = this.socket;
        if (!socket) {
            return;
        }
        for (const { nt, usnSuffix } of this.notificationTypes(device)) {
            const usn = `${device.udn}${usnSuffix}`;
            const message = 'NOTIFY * HTTP/1.1\r\n' +
                `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\n` +
                'NTS: ssdp:byebye\r\n' +
                `NT: ${nt}\r\n` +
                `USN: ${usn}\r\n` +
                '\r\n';
            const buf = Buffer.from(message, 'ascii');
            socket.send(buf, 0, buf.length, SSDP_PORT, SSDP_ADDRESS);
        }
    }
    handleMessage(msg, rinfo) {
        const text = msg.toString('ascii');
        if (!text.startsWith('M-SEARCH')) {
            return;
        }
        const headers = parseHeaders(text);
        if ((headers.man ?? '').replace(/"/g, '') !== 'ssdp:discover') {
            return;
        }
        const st = (headers.st ?? '').trim();
        for (const device of this.devices.values()) {
            for (const { nt, usnSuffix } of this.matchingTargets(device, st)) {
                this.sendSearchResponse(device, nt, usnSuffix, rinfo);
            }
        }
    }
    matchingTargets(device, st) {
        const all = this.notificationTypes(device);
        if (st === 'ssdp:all') {
            return all;
        }
        return all.filter((t) => t.nt === st);
    }
    sendSearchResponse(device, nt, usnSuffix, rinfo) {
        const socket = this.socket;
        if (!socket) {
            return;
        }
        const usn = `${device.udn}${usnSuffix}`;
        const message = 'HTTP/1.1 200 OK\r\n' +
            `CACHE-CONTROL: max-age=${MAX_AGE_SECONDS}\r\n` +
            'EXT:\r\n' +
            `LOCATION: ${device.location()}\r\n` +
            `SERVER: ${this.serverHeaderValue}\r\n` +
            `ST: ${nt}\r\n` +
            `USN: ${usn}\r\n` +
            '\r\n';
        const buf = Buffer.from(message, 'ascii');
        socket.send(buf, 0, buf.length, rinfo.port, rinfo.address);
    }
}
function parseHeaders(text) {
    const headers = {};
    for (const line of text.split(/\r?\n/)) {
        const idx = line.indexOf(':');
        if (idx === -1) {
            continue;
        }
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        if (key) {
            headers[key] = value;
        }
    }
    return headers;
}
