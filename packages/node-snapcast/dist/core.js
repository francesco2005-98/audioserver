import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import os from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
const BASE_HEADER_SIZE = 26; // 3x uint16 + 2x tv(int32,int32) + size(uint32), little endian
const CHUNK_MS = 20;
const MAX_BUFFER_MS = 500;
const MAX_MESSAGE_SIZE = 1_000_000;
// Snapclient uses a steady clock (steadytimeofday). Use the monotonic clock directly.
const DEFAULT_OUTPUT = {
    sampleRate: 48000,
    channels: 2,
    pcmBitDepth: 16,
};
const DEFAULT_SERVER_NAME = 'Snapcast Server';
const DEFAULT_SERVER_VERSION = '0.0.0';
const DEFAULT_PROTOCOL_VERSION = 1;
const DEFAULT_CONTROL_PROTOCOL_VERSION = 1;
const DEFAULT_STREAM_URI = {
    scheme: 'ws',
    basePath: '/snapcast',
};
const noopLogger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
};
/**
 * Central Snapcast-compatible server (WebSocket + TCP).
 * Exposes upgrade handling for a shared HTTP server (path is decided by the caller).
 */
export class SnapcastCore {
    /** Create a Snapcast core instance with optional hooks and defaults. */
    constructor(options = {}) {
        this.wsServer = new WebSocketServer({ noServer: true });
        this.rpcServer = new WebSocketServer({ noServer: true });
        this.rpcClients = new Set();
        this.clients = new Set();
        this.nextMessageId = 0;
        this.streams = new Map();
        this.clientToStream = new Map();
        this.rpcInterval = null;
        this.streamSignatures = new Map();
        this.clientConfigs = new Map();
        this.groupConfigs = new Map();
        this.clientToGroup = new Map();
        this.rpcStreams = new Map();
        this.log = options.logger ?? noopLogger;
        this.hooks = options.hooks ?? {};
        this.defaultOutput = options.defaultOutput ?? DEFAULT_OUTPUT;
        this.serverName = options.serverName ?? DEFAULT_SERVER_NAME;
        this.serverVersion = options.serverVersion ?? DEFAULT_SERVER_VERSION;
        this.protocolVersion = options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
        this.controlProtocolVersion =
            options.controlProtocolVersion ?? DEFAULT_CONTROL_PROTOCOL_VERSION;
        this.streamUri = {
            ...DEFAULT_STREAM_URI,
            ...options.streamUri,
        };
        this.wsServer.on('connection', (socket, req) => {
            this.handleConnection(socket, req);
        });
        this.rpcServer.on('connection', (socket) => {
            this.rpcClients.add(socket);
            this.startRpcUpdates();
            socket.on('message', (data) => this.handleRpcMessage(socket, data));
            socket.on('close', () => {
                this.rpcClients.delete(socket);
                this.stopRpcUpdatesIfIdle();
            });
            socket.on('error', () => {
                this.rpcClients.delete(socket);
                this.stopRpcUpdatesIfIdle();
            });
        });
    }
    /** Handle HTTP upgrade requests for Snapcast stream + JSON-RPC endpoints. */
    handleUpgrade(request, socket, head) {
        const rawPath = (request.url ?? '').split('?')[0] || '/';
        const path = rawPath === '/' ? '/snapcast' : rawPath;
        const basePath = this.normalizeBasePath(this.streamUri.basePath || DEFAULT_STREAM_URI.basePath);
        const isStreamPath = path === '/snapcast' ||
            path === '/stream' ||
            path === basePath ||
            path.startsWith('/snapcast/') ||
            path.startsWith('/stream/') ||
            path.startsWith(`${basePath}/`);
        const isRpcPath = path === '/snapcast/jsonrpc' ||
            path === '/jsonrpc' ||
            path === `${basePath}/jsonrpc`;
        if (!isStreamPath && !isRpcPath) {
            return false;
        }
        if (isRpcPath) {
            this.rpcServer.handleUpgrade(request, socket, head, (ws) => {
                this.rpcServer.emit('connection', ws, request);
            });
            return true;
        }
        this.wsServer.handleUpgrade(request, socket, head, (ws) => {
            this.wsServer.emit('connection', ws, request);
        });
        return true;
    }
    /** Close all sockets and clear registered streams. */
    close() {
        this.clients.forEach((client) => this.closeClientSocket(client));
        this.clients.clear();
        this.wsServer.close();
        this.rpcServer.close();
        this.rpcClients.clear();
        if (this.rpcInterval) {
            clearInterval(this.rpcInterval);
            this.rpcInterval = null;
        }
        this.clearStream();
    }
    /** Replace hook handlers (useful for hot reloads). */
    setHooks(hooks) {
        this.hooks = hooks ?? {};
    }
    /** List connected clients and their active mapping. */
    listClients() {
        return Array.from(this.clients).map((c) => ({
            clientId: c.clientId ?? '',
            streamId: c.streamId,
            connected: this.isClientOpen(c),
            connectedAt: c.connectedAt,
            lastHelloId: c.lastHelloId,
            latency: this.getClientConfig(c.clientId ?? '').latency,
        }));
    }
    /** Update a client latency setting (milliseconds). */
    setClientLatency(clientId, latency) {
        if (!clientId || !Number.isFinite(latency)) {
            return { updated: false, connected: false, latency: 0 };
        }
        const clamped = Math.max(0, Math.round(latency));
        this.ensureClientConfig(clientId).latency = clamped;
        const client = this.findClientById(clientId);
        let connected = false;
        if (client && this.isClientOpen(client)) {
            connected = true;
            const output = this.streams.get(client.streamId)?.output ??
                this.streams.values().next().value?.output ??
                this.defaultOutput;
            this.sendSettings(client, output, 0, false);
        }
        this.sendClientNotification('Client.OnLatencyChanged', { id: clientId, latency: clamped });
        this.sendServerUpdate();
        return { updated: true, connected, latency: clamped };
    }
    /** Force-map a client ID to a stream ID. */
    setClientStream(clientId, streamId) {
        if (!clientId || !streamId) {
            return { updated: false, connected: false };
        }
        this.clientToStream.set(clientId, streamId);
        let connected = false;
        let pushed = false;
        for (const client of this.clients) {
            if (client.clientId === clientId) {
                connected = this.isClientOpen(client);
                if (client.streamId !== streamId) {
                    this.updateClientStream(client, streamId);
                }
                const output = this.streams.get(streamId)?.output ??
                    this.streams.values().next().value?.output ??
                    this.defaultOutput;
                this.sendSettings(client, output, 0, true);
                pushed = true;
            }
        }
        this.log.info('snapcast client stream mapped', { clientId, streamId, connected, pushed });
        this.updateFlowControl(streamId);
        return { updated: true, connected };
    }
    /** Register or update a PCM stream and client mappings. */
    setStream(streamId, zoneId, output, stream, clientIds = []) {
        const bytesPerFrame = (output.pcmBitDepth / 8) * output.channels;
        const targetBytes = Math.max(bytesPerFrame, Math.floor((output.sampleRate * CHUNK_MS) / 1000) * bytesPerFrame);
        const existing = this.streams.get(streamId);
        if (existing && existing.source === stream) {
            // Reuse the active stream when only the client mapping or output metadata changes.
            const formatChanged = existing.output.sampleRate !== output.sampleRate ||
                existing.output.channels !== output.channels ||
                existing.output.pcmBitDepth !== output.pcmBitDepth;
            existing.zoneId = zoneId;
            existing.output = output;
            existing.bytesPerFrame = bytesPerFrame;
            existing.targetBytes = targetBytes;
            if (formatChanged) {
                existing.nextTimestampUs = 0;
                existing.chunkBuffer = Buffer.alloc(0);
            }
            else if (existing.nextTimestampUs < this.nowUs()) {
                existing.nextTimestampUs = 0;
            }
            clientIds.forEach((id) => {
                this.clientToStream.set(id, streamId);
            });
            for (const client of this.clients) {
                if (clientIds.includes(client.clientId ?? '')) {
                    this.updateClientStream(client, streamId);
                    this.log.info('snapcast client reassigned to stream', { clientId: client.clientId, streamId });
                }
            }
            this.log.info('snapcast stream updated', {
                streamId,
                zoneId,
                sampleRate: output.sampleRate,
                channels: output.channels,
                bitDepth: output.pcmBitDepth,
                clientIds,
            });
            this.pushSettingsToClients(streamId, output);
            this.updateFlowControl(streamId);
            this.streamSignatures.delete(streamId);
            return;
        }
        const hadExisting = this.streams.has(streamId) ||
            Array.from(this.clients).some((client) => client.streamId === streamId);
        this.clearStream(streamId);
        const waitForClient = async () => {
            const active = this.streams.get(streamId);
            if (!active || active.closed)
                return;
            if (typeof stream.pause === 'function') {
                try {
                    stream.pause();
                }
                catch {
                    /* ignore */
                }
            }
            if (!active.waitingForClient) {
                active.waitingForClient = true;
                active.waitForClientResolve = undefined;
            }
            await new Promise((resolve) => {
                const latest = this.streams.get(streamId);
                if (!latest || latest.closed) {
                    resolve();
                    return;
                }
                latest.waitForClientResolve = resolve;
            });
        };
        const consumeStream = async () => {
            try {
                // Ensure paused until at least one client is connected.
                if (!this.hasActiveClient(streamId)) {
                    await waitForClient();
                }
                for await (const chunk of stream) {
                    const active = this.streams.get(streamId);
                    if (!active || active.closed)
                        return;
                    if (!this.hasActiveClient(streamId)) {
                        await waitForClient();
                        continue;
                    }
                    active.chunkBuffer = Buffer.concat([active.chunkBuffer, chunk]);
                    const chunkSize = Math.max(1, active.targetBytes);
                    while (active.chunkBuffer.length >= chunkSize) {
                        const payload = active.chunkBuffer.slice(0, chunkSize);
                        active.chunkBuffer = active.chunkBuffer.slice(chunkSize);
                        this.broadcastWireChunk(streamId, payload);
                    }
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.log.debug('snapcast stream error', { zoneId, message });
            }
            finally {
                this.log.debug('snapcast stream closed', { zoneId });
                this.clearStream(streamId);
            }
        };
        const active = {
            streamId,
            zoneId,
            output,
            bytesPerFrame,
            targetBytes,
            nextTimestampUs: 0,
            chunkBuffer: Buffer.alloc(0),
            source: stream,
            waitingForClient: false,
            closed: false,
            cleanup: () => {
                const current = this.streams.get(streamId);
                if (current) {
                    current.closed = true;
                    if (current.waitForClientResolve) {
                        current.waitForClientResolve();
                        current.waitForClientResolve = undefined;
                    }
                }
                if (typeof stream.destroy === 'function') {
                    stream.destroy();
                }
            },
        };
        this.streams.set(streamId, active);
        void consumeStream();
        // Register client mappings for this stream.
        clientIds.forEach((id) => {
            this.clientToStream.set(id, streamId);
        });
        // Reassign already-connected clients whose ID maps to this stream.
        for (const client of this.clients) {
            if (clientIds.includes(client.clientId ?? '')) {
                this.updateClientStream(client, streamId);
                this.log.info('snapcast client reassigned to stream', { clientId: client.clientId, streamId });
            }
        }
        this.log.info('snapcast stream registered', {
            streamId,
            zoneId,
            sampleRate: output.sampleRate,
            channels: output.channels,
            bitDepth: output.pcmBitDepth,
            clientIds,
        });
        // Notify already connected clients for this stream.
        this.pushSettingsToClients(streamId, output);
        // Do not force-close unmapped clients; allow them to keep their connection and request streams explicitly.
        // Pause stream flow until at least one client is connected to this stream.
        this.updateFlowControl(streamId);
        this.streamSignatures.delete(streamId);
    }
    /** Update volume (and optional mute) for one or more clients. */
    setClientVolumes(clientIds, volume, muted) {
        if (!clientIds.length)
            return;
        const clamped = Math.min(100, Math.max(0, Math.round(volume)));
        for (const clientId of clientIds) {
            this.applyClientVolume(clientId, clamped, muted);
        }
        this.sendServerUpdate();
    }
    /** Clear a stream by ID/zone or clear all streams when omitted. */
    clearStream(zoneId) {
        if (zoneId != null) {
            const zoneNum = typeof zoneId === 'string' ? Number(zoneId) : zoneId;
            for (const [id, active] of this.streams.entries()) {
                if (active.zoneId === zoneNum || id === String(zoneId)) {
                    active.cleanup();
                    this.streams.delete(id);
                    // Drop client mappings that pointed to this stream.
                    for (const [clientId, streamId] of this.clientToStream.entries()) {
                        if (streamId === id) {
                            this.clientToStream.delete(clientId);
                        }
                    }
                }
            }
            return;
        }
        this.streams.forEach((active) => active.cleanup());
        this.streams.clear();
        this.clientToStream.clear();
    }
    handleConnection(socket, _req) {
        const requested = this.extractStreamId(_req?.url ?? '/snapcast') ?? 'default';
        const streamId = this.resolveStreamId(requested);
        const client = {
            socket,
            transport: 'ws',
            buffer: Buffer.alloc(0),
            clientId: null,
            requestedStreamId: requested,
            streamId,
            lastHelloId: null,
            connectedAt: Date.now(),
        };
        this.clients.add(client);
        this.log.debug('snapcast ws connection opened', { streamId });
        socket.on('message', (data) => {
            this.consumeData(client, Buffer.isBuffer(data) ? data : Buffer.from(data));
        });
        socket.on('close', () => {
            if (client.clientId) {
                this.sendClientNotification('Client.OnDisconnect', {
                    client: this.buildClientStatus(client, false),
                    id: client.clientId,
                });
            }
            this.clients.delete(client);
            this.updateFlowControl(client.streamId);
            this.sendServerUpdate();
        });
        socket.on('error', (error) => {
            this.log.debug('snapcast client error', { message: error.message });
            if (client.clientId) {
                this.sendClientNotification('Client.OnDisconnect', {
                    client: this.buildClientStatus(client, false),
                    id: client.clientId,
                });
            }
            this.clients.delete(client);
            this.updateFlowControl(client.streamId);
            this.sendServerUpdate();
        });
        this.updateFlowControl(client.streamId);
    }
    /** Accept a new TCP Snapclient connection. */
    handleTcpConnection(socket) {
        const requested = 'default';
        const streamId = this.resolveStreamId(requested);
        const client = {
            socket,
            transport: 'tcp',
            buffer: Buffer.alloc(0),
            clientId: null,
            requestedStreamId: requested,
            streamId,
            lastHelloId: null,
            connectedAt: Date.now(),
        };
        this.clients.add(client);
        this.log.debug('snapcast tcp connection opened', {
            streamId,
            remote: socket.remoteAddress,
        });
        socket.on('data', (data) => {
            this.consumeData(client, Buffer.isBuffer(data) ? data : Buffer.from(data));
        });
        socket.on('close', () => {
            if (client.clientId) {
                this.sendClientNotification('Client.OnDisconnect', {
                    client: this.buildClientStatus(client, false),
                    id: client.clientId,
                });
            }
            this.clients.delete(client);
            this.updateFlowControl(client.streamId);
            this.sendServerUpdate();
        });
        socket.on('error', (error) => {
            this.log.debug('snapcast client error', { message: error.message });
            if (client.clientId) {
                this.sendClientNotification('Client.OnDisconnect', {
                    client: this.buildClientStatus(client, false),
                    id: client.clientId,
                });
            }
            this.clients.delete(client);
            this.updateFlowControl(client.streamId);
            this.sendServerUpdate();
        });
        this.updateFlowControl(client.streamId);
    }
    consumeData(client, data) {
        client.buffer = Buffer.concat([client.buffer, data]);
        while (client.buffer.length >= BASE_HEADER_SIZE) {
            const header = this.parseHeader(client.buffer);
            if (!header) {
                this.terminateClient(client, 'invalid-header');
                return;
            }
            if (header.type > 8) {
                this.terminateClient(client, 'unknown-message-type', { type: header.type });
                return;
            }
            if (header.size > MAX_MESSAGE_SIZE) {
                this.terminateClient(client, 'message-too-large', { size: header.size });
                return;
            }
            const totalLength = BASE_HEADER_SIZE + header.size;
            if (client.buffer.length < totalLength) {
                return;
            }
            const body = client.buffer.slice(BASE_HEADER_SIZE, totalLength);
            client.buffer = client.buffer.slice(totalLength);
            this.handleMessage(client, header, body);
        }
    }
    parseHeader(buffer) {
        try {
            const type = buffer.readUInt16LE(0);
            const id = buffer.readUInt16LE(2);
            const refersTo = buffer.readUInt16LE(4);
            const sentSec = buffer.readInt32LE(6);
            const sentUsec = buffer.readInt32LE(10);
            const now = this.nowTv();
            const size = buffer.readUInt32LE(22);
            return {
                type,
                id,
                refersTo,
                sent: { sec: sentSec, usec: sentUsec },
                // Per reference snapserver, stamp server receive time instead of trusting the client payload.
                received: now,
                size,
            };
        }
        catch (error) {
            this.log.warn('failed to parse snapcast header', { message: error.message });
            return null;
        }
    }
    terminateClient(client, reason, details) {
        this.log.warn('snapcast client disconnected', {
            reason,
            clientId: client.clientId,
            streamId: client.streamId,
            ...details,
        });
        client.buffer = Buffer.alloc(0);
        this.closeClientSocket(client);
    }
    isClientOpen(client) {
        if (client.transport === 'ws') {
            return client.socket.readyState === WebSocket.OPEN;
        }
        const socket = client.socket;
        return socket.writable && !socket.destroyed;
    }
    sendToClient(client, payload) {
        if (!this.isClientOpen(client)) {
            return;
        }
        if (client.transport === 'ws') {
            client.socket.send(payload);
            return;
        }
        client.socket.write(payload);
    }
    closeClientSocket(client) {
        try {
            if (client.transport === 'ws') {
                client.socket.close();
            }
            else {
                client.socket.destroy();
            }
        }
        catch {
            /* ignore */
        }
    }
    getClientRemoteIp(client) {
        if (client.transport === 'ws') {
            const remoteIp = client.socket?._socket?.remoteAddress;
            return typeof remoteIp === 'string' ? remoteIp : null;
        }
        const remoteIp = client.socket.remoteAddress;
        return typeof remoteIp === 'string' ? remoteIp : null;
    }
    handleMessage(client, header, body) {
        switch (header.type) {
            case 5: // Hello
                this.handleHello(client, header, body);
                break;
            case 7: // Client Info
                this.handleClientInfo(client, body);
                break;
            case 4: // Time
                this.handleTime(client, header);
                break;
            default:
                // Ignore unsupported types.
                break;
        }
    }
    handleHello(client, header, body) {
        try {
            const jsonLen = body.readUInt32LE(0);
            const jsonStr = body.slice(4, 4 + jsonLen).toString('utf8');
            const parsed = JSON.parse(jsonStr);
            const instance = typeof parsed.Instance === 'number' && parsed.Instance > 1 ? `#${parsed.Instance}` : '';
            client.clientId = `${parsed.ID || parsed.MAC || 'client'}${instance}`;
            client.lastHelloId = header.id;
            const config = this.ensureClientConfig(client.clientId, parsed.Instance);
            if (typeof parsed.Arch === 'string') {
                config.host.arch = parsed.Arch;
            }
            if (typeof parsed.HostName === 'string') {
                config.host.name = parsed.HostName;
            }
            if (typeof parsed.OS === 'string') {
                config.host.os = parsed.OS;
            }
            if (typeof parsed.MAC === 'string') {
                config.host.mac = parsed.MAC;
            }
            const remoteIp = this.getClientRemoteIp(client);
            if (remoteIp) {
                config.host.ip = remoteIp;
            }
            if (typeof parsed.ClientName === 'string') {
                config.snapclient.name = parsed.ClientName;
            }
            if (typeof parsed.Version === 'string') {
                config.snapclient.version = parsed.Version;
            }
            if (typeof parsed.SnapStreamProtocolVersion === 'number') {
                config.snapclient.protocolVersion = parsed.SnapStreamProtocolVersion;
            }
            this.log.info('snapcast client connected', { clientId: client.clientId, requestedStream: client.streamId });
            const mappedStream = this.clientToStream.get(client.clientId);
            if (mappedStream) {
                this.updateClientStream(client, mappedStream);
                this.log.info('snapcast client mapped to stream', { clientId: client.clientId, streamId: mappedStream });
            }
            if (client.clientId) {
                this.applyStreamVolumeToClient(client.clientId, client.streamId);
            }
            if (client.clientId) {
                this.ensureGroupForClient(client.clientId, client.streamId);
                this.sendClientNotification('Client.OnConnect', {
                    client: this.buildClientStatus(client, true),
                    id: client.clientId,
                });
                this.sendServerUpdate();
            }
        }
        catch (error) {
            this.log.warn('failed to parse snapcast Hello', { message: error.message });
        }
        const activeStream = this.streams.get(client.streamId);
        const activeOutput = activeStream?.output ?? this.defaultOutput;
        this.sendSettings(client, activeOutput, header.id, true);
        this.updateFlowControl(client.streamId);
    }
    handleClientInfo(client, body) {
        try {
            const jsonLen = body.readUInt32LE(0);
            const jsonStr = body.slice(4, 4 + jsonLen).toString('utf8');
            const parsed = JSON.parse(jsonStr);
            const clientId = client.clientId;
            if (!clientId) {
                return;
            }
            const config = this.ensureClientConfig(clientId);
            if (typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)) {
                config.volume.percent = Math.min(100, Math.max(0, Math.round(parsed.volume)));
            }
            if (typeof parsed.muted === 'boolean') {
                config.volume.muted = parsed.muted;
            }
            this.sendClientNotification('Client.OnVolumeChanged', {
                id: clientId,
                volume: { muted: config.volume.muted, percent: config.volume.percent },
            });
            this.sendServerUpdate();
        }
        catch (error) {
            this.log.warn('failed to parse snapcast client info', { message: error.message });
        }
    }
    applyClientVolume(clientId, volume, muted) {
        if (!clientId)
            return;
        const config = this.ensureClientConfig(clientId);
        config.volume.percent = Math.min(100, Math.max(0, Math.round(volume)));
        if (typeof muted === 'boolean') {
            config.volume.muted = muted;
        }
        const client = this.findClientById(clientId);
        if (client && this.isClientOpen(client)) {
            const output = this.streams.get(client.streamId)?.output ??
                this.streams.values().next().value?.output ??
                this.defaultOutput;
            this.sendSettings(client, output, 0, false);
        }
        this.sendClientNotification('Client.OnVolumeChanged', {
            id: clientId,
            volume: { muted: config.volume.muted, percent: config.volume.percent },
        });
    }
    applyStreamVolumeToClient(clientId, streamId) {
        const active = this.streams.get(streamId);
        if (!active) {
            return;
        }
        const raw = this.hooks.getStreamProperties?.(this.getStreamContext(active));
        if (!raw || typeof raw.volume !== 'number' || !Number.isFinite(raw.volume)) {
            return;
        }
        const config = this.ensureClientConfig(clientId);
        config.volume.percent = Math.min(100, Math.max(0, Math.round(raw.volume)));
    }
    handleStreamAdd(params, reply, error) {
        const streamUri = typeof params.streamUri === 'string' ? params.streamUri : '';
        if (!streamUri) {
            return error(-32602, 'Invalid params');
        }
        const parsed = this.parseStreamUri(streamUri);
        if (!parsed || !parsed.id) {
            return error(-32602, 'Invalid params');
        }
        const streamId = parsed.id;
        this.rpcStreams.set(streamId, { id: streamId, uri: streamUri });
        this.getOrCreateGroup(streamId, streamId);
        this.sendServerUpdate();
        return reply({ stream_id: streamId });
    }
    parseStreamUri(uri) {
        try {
            const url = new URL(uri);
            const query = {};
            url.searchParams.forEach((value, key) => {
                query[key] = value;
            });
            const name = url.searchParams.get('name') ?? url.searchParams.get('stream') ?? '';
            const pathTail = url.pathname ? url.pathname.split('/').filter(Boolean).pop() ?? '' : '';
            const id = (name || pathTail || uri).trim();
            if (!id) {
                return null;
            }
            return {
                id,
                scheme: url.protocol.replace(':', ''),
                host: url.host,
                path: url.pathname,
                fragment: url.hash.replace('#', ''),
                query,
            };
        }
        catch {
            return null;
        }
    }
    handleTime(client, header) {
        // Snapcast Time: latency = server_received - client_sent.
        const sentUs = header.sent.sec * 1_000_000 + header.sent.usec;
        const recvUs = header.received.sec * 1_000_000 + header.received.usec;
        const deltaUs = recvUs - sentUs;
        const latencySec = Math.trunc(deltaUs / 1_000_000);
        const latencyUsec = Math.trunc(deltaUs - latencySec * 1_000_000);
        const payload = Buffer.alloc(8);
        payload.writeInt32LE(latencySec, 0);
        payload.writeInt32LE(latencyUsec, 4);
        const message = this.encodeMessage(4, this.nextId(), header.id, payload);
        this.sendToClient(client, message);
    }
    broadcastWireChunk(streamId, payload) {
        const active = this.streams.get(streamId);
        if (!active || this.clients.size === 0) {
            return;
        }
        // Derive timestamp based on running stream clock to keep steady playout.
        const frames = Math.max(1, Math.floor(payload.length / Math.max(1, active.bytesPerFrame)));
        const durationUs = Math.floor((frames * 1_000_000) / Math.max(1, active.output.sampleRate));
        const nowUs = this.nowUs();
        let tsUs = active.nextTimestampUs && Number.isFinite(active.nextTimestampUs) ? active.nextTimestampUs : nowUs;
        if (!active.nextTimestampUs) {
            tsUs = nowUs;
        }
        // If we fell behind (e.g., after a pause or reconnect), jump forward to avoid sending stale chunks.
        if (tsUs < nowUs) {
            tsUs = nowUs;
        }
        active.nextTimestampUs = tsUs + durationUs;
        const timestamp = {
            sec: Math.floor(tsUs / 1_000_000),
            usec: Math.floor(tsUs - Math.floor(tsUs / 1_000_000) * 1_000_000),
        };
        const chunkPayload = Buffer.alloc(8 + 4 + payload.length);
        chunkPayload.writeInt32LE(timestamp.sec, 0);
        chunkPayload.writeInt32LE(timestamp.usec, 4);
        chunkPayload.writeUInt32LE(payload.length, 8);
        payload.copy(chunkPayload, 12);
        const message = this.encodeMessage(2, this.nextId(), 0, chunkPayload);
        for (const client of this.clients) {
            if (this.isClientOpen(client) && client.streamId === streamId) {
                this.sendToClient(client, message);
            }
        }
    }
    encodeJsonMessage(type, refersTo, payload) {
        const json = JSON.stringify(payload);
        const body = Buffer.alloc(4 + Buffer.byteLength(json));
        body.writeUInt32LE(Buffer.byteLength(json), 0);
        body.write(json, 4);
        return this.encodeMessage(type, this.nextId(), refersTo, body);
    }
    buildPcmCodecHeader(sampleRate, channels, bitDepth) {
        const wav = this.encodeWavHeader(sampleRate, channels, bitDepth);
        const payload = Buffer.alloc(4 + wav.length + 4 + Buffer.byteLength('pcm'));
        payload.writeUInt32LE(Buffer.byteLength('pcm'), 0);
        payload.write('pcm', 4);
        payload.writeUInt32LE(wav.length, 4 + Buffer.byteLength('pcm'));
        wav.copy(payload, 8 + Buffer.byteLength('pcm'));
        return this.encodeMessage(1, this.nextId(), 0, payload);
    }
    encodeWavHeader(sampleRate, channels, bitDepth) {
        const blockAlign = (channels * bitDepth) / 8;
        const byteRate = sampleRate * blockAlign;
        const buffer = Buffer.alloc(44);
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(36, 4);
        buffer.write('WAVE', 8);
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16);
        buffer.writeUInt16LE(1, 20);
        buffer.writeUInt16LE(channels, 22);
        buffer.writeUInt32LE(sampleRate, 24);
        buffer.writeUInt32LE(byteRate, 28);
        buffer.writeUInt16LE(blockAlign, 32);
        buffer.writeUInt16LE(bitDepth, 34);
        buffer.write('data', 36);
        buffer.writeUInt32LE(0, 40);
        return buffer;
    }
    encodeMessage(type, id, refersTo, payload) {
        const safeType = type & 0xffff;
        const safeId = id & 0xffff;
        const safeRefersTo = refersTo & 0xffff;
        const header = Buffer.alloc(BASE_HEADER_SIZE);
        header.writeUInt16LE(safeType, 0);
        header.writeUInt16LE(safeId, 2);
        header.writeUInt16LE(safeRefersTo, 4);
        const now = this.nowTv();
        header.writeInt32LE(now.sec, 6);
        header.writeInt32LE(now.usec, 10);
        header.writeInt32LE(now.sec, 14);
        header.writeInt32LE(now.usec, 18);
        header.writeUInt32LE(payload.length, 22);
        return Buffer.concat([header, payload]);
    }
    nextId() {
        this.nextMessageId = (this.nextMessageId % 0xffff) + 1;
        return this.nextMessageId;
    }
    nowTv() {
        const us = this.nowUs();
        const sec = Math.floor(us / 1_000_000);
        const usec = Math.floor(us - sec * 1_000_000);
        return { sec, usec };
    }
    nowUs() {
        // Use host uptime to align with snapclient steady clock (CLOCK_BOOTTIME).
        return Math.trunc(os.uptime() * 1_000_000);
    }
    extractStreamId(url) {
        const safeUrl = url || '/snapcast';
        let streamParam = null;
        try {
            const u = new URL(safeUrl, 'http://localhost');
            streamParam = u.searchParams.get('stream');
        }
        catch {
            // ignore
        }
        const path = safeUrl.split('?')[0] || '/snapcast';
        if (streamParam && streamParam.trim()) {
            return streamParam.trim();
        }
        if (path.startsWith('/stream/')) {
            return decodeURIComponent(path.slice('/stream/'.length)) || null;
        }
        if (path.startsWith('/snapcast/')) {
            return decodeURIComponent(path.slice('/snapcast/'.length)) || null;
        }
        return 'default';
    }
    normalizeBasePath(path) {
        const trimmed = path?.trim() || DEFAULT_STREAM_URI.basePath;
        const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
        return withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
    }
    resolveStreamId(requested) {
        if (this.streams.has(requested)) {
            return requested;
        }
        // Keep the requested id so late-registered streams (per-zone) do not get rerouted to another zone.
        this.log.debug('snapcast resolveStreamId: stream not found, keeping requested', { requested });
        return requested;
    }
    pushSettingsToClients(streamId, output) {
        let pushed = 0;
        for (const client of this.clients) {
            if (client.streamId === streamId && this.isClientOpen(client)) {
                this.sendSettings(client, output, 0, true);
                pushed += 1;
            }
        }
        this.log.debug('snapcast pushed settings to clients', { streamId, count: pushed });
    }
    sendSettings(client, output, refersTo, includeHeader) {
        const config = this.getClientConfig(client.clientId ?? '');
        const group = this.findGroupByClientId(client.clientId ?? '');
        const muted = config.volume.muted || (group?.muted ?? false);
        const settings = this.encodeJsonMessage(3, refersTo, {
            bufferMs: this.computeBufferMs(output),
            latency: Number.isFinite(config.latency) ? config.latency : 0,
            volume: config.volume.percent,
            muted,
        });
        this.sendToClient(client, settings);
        if (includeHeader) {
            const wavHeader = this.buildPcmCodecHeader(output.sampleRate, output.channels, output.pcmBitDepth);
            this.sendToClient(client, wavHeader);
        }
    }
    updateFlowControl(streamId) {
        const active = this.streams.get(streamId);
        if (!active)
            return;
        const hasClient = this.hasActiveClient(streamId);
        if (hasClient && active.waitForClientResolve) {
            active.waitingForClient = false;
            const resolve = active.waitForClientResolve;
            active.waitForClientResolve = undefined;
            resolve();
            if (typeof active.source.resume === 'function') {
                try {
                    active.source.resume();
                }
                catch {
                    /* ignore */
                }
            }
        }
        if (!hasClient && typeof active.source.pause === 'function') {
            try {
                active.source.pause();
            }
            catch {
                /* ignore */
            }
        }
        if (!hasClient && active.chunkBuffer.length > 0) {
            // Drop any queued audio when nobody is listening to avoid unbounded buffers.
            active.chunkBuffer = Buffer.alloc(0);
            active.nextTimestampUs = 0;
            this.log.debug('snapcast stream drained (no clients)', { streamId });
        }
    }
    hasActiveClient(streamId) {
        return Array.from(this.clients).some((client) => client.streamId === streamId && this.isClientOpen(client));
    }
    computeBufferMs(output) {
        const computed = output.prebufferBytes
            ? Math.round((output.prebufferBytes / (output.sampleRate * output.channels * (output.pcmBitDepth / 8))) * 1000)
            : 0;
        if (!Number.isFinite(computed) || computed <= 0) {
            return MAX_BUFFER_MS;
        }
        return Math.min(computed, MAX_BUFFER_MS);
    }
    handleRpcMessage(socket, raw) {
        let payload;
        try {
            payload = JSON.parse(raw.toString());
        }
        catch {
            socket.send(JSON.stringify({
                id: null,
                jsonrpc: '2.0',
                error: { code: -32700, message: 'Parse error' },
            }));
            return;
        }
        if (!payload || typeof payload !== 'object')
            return;
        const requests = Array.isArray(payload) ? payload : [payload];
        const responses = [];
        for (const request of requests) {
            const response = this.handleRpcRequest(request);
            if (response) {
                responses.push(response);
            }
        }
        if (responses.length > 0) {
            socket.send(JSON.stringify(Array.isArray(payload) ? responses : responses[0]));
        }
    }
    handleRpcRequest(request) {
        if (!request || typeof request !== 'object' || typeof request.method !== 'string') {
            if (request?.id === undefined)
                return null;
            return {
                id: request.id ?? null,
                jsonrpc: '2.0',
                error: { code: -32600, message: 'Invalid request' },
            };
        }
        const id = request.id ?? null;
        const method = request.method;
        const params = request.params ?? {};
        const reply = (result) => ({ id, jsonrpc: '2.0', result });
        const error = (code, message) => ({ id, jsonrpc: '2.0', error: { code, message } });
        switch (method) {
            case 'Server.GetRPCVersion':
                return reply({ major: 2, minor: 0, patch: 0 });
            case 'Server.GetStatus': {
                const status = this.buildStatus();
                return reply({ server: status });
            }
            case 'Client.GetStatus': {
                const clientId = typeof params.id === 'string' ? params.id : '';
                const client = this.findClientById(clientId);
                if (client) {
                    return reply({ client: this.buildClientStatus(client, this.isClientOpen(client)) });
                }
                if (!clientId || !this.clientConfigs.has(clientId)) {
                    return error(-32602, 'Invalid params');
                }
                return reply({ client: this.buildClientStatusFromConfig(clientId, false) });
            }
            case 'Client.SetVolume': {
                const clientId = typeof params.id === 'string' ? params.id : '';
                const volume = params.volume;
                if (!clientId || !volume || typeof volume !== 'object') {
                    return error(-32602, 'Invalid params');
                }
                const muted = typeof volume.muted === 'boolean' ? volume.muted : false;
                const percent = Number(volume.percent);
                if (!Number.isFinite(percent)) {
                    return error(-32602, 'Value for volume must be an int');
                }
                const clamped = Math.min(100, Math.max(0, Math.round(percent)));
                this.setClientVolume(clientId, { muted, percent: clamped });
                const client = this.findClientById(clientId);
                if (client && this.isClientOpen(client)) {
                    const output = this.streams.get(client.streamId)?.output ??
                        this.streams.values().next().value?.output ??
                        this.defaultOutput;
                    this.sendSettings(client, output, 0, false);
                }
                this.sendClientNotification('Client.OnVolumeChanged', { id: clientId, volume: { muted, percent: clamped } });
                this.sendServerUpdate();
                return reply({ volume: { muted, percent: clamped } });
            }
            case 'Client.SetLatency': {
                const clientId = typeof params.id === 'string' ? params.id : '';
                const latency = Number(params.latency);
                if (!clientId || !Number.isFinite(latency)) {
                    return error(-32602, 'Invalid params');
                }
                const clamped = Math.max(0, Math.round(latency));
                this.ensureClientConfig(clientId).latency = clamped;
                const client = this.findClientById(clientId);
                if (client && this.isClientOpen(client)) {
                    const output = this.streams.get(client.streamId)?.output ??
                        this.streams.values().next().value?.output ??
                        this.defaultOutput;
                    this.sendSettings(client, output, 0, false);
                }
                this.sendClientNotification('Client.OnLatencyChanged', { id: clientId, latency: clamped });
                this.sendServerUpdate();
                return reply({ latency: clamped });
            }
            case 'Client.SetName': {
                const clientId = typeof params.id === 'string' ? params.id : '';
                const name = typeof params.name === 'string' ? params.name : '';
                if (!clientId) {
                    return error(-32602, 'Invalid params');
                }
                this.ensureClientConfig(clientId).name = name;
                this.sendClientNotification('Client.OnNameChanged', { id: clientId, name });
                this.sendServerUpdate();
                return reply({ name });
            }
            case 'Group.GetStatus': {
                const groupId = typeof params.id === 'string' ? params.id : '';
                const group = this.groupConfigs.get(groupId);
                if (!group) {
                    return error(-32602, 'Invalid params');
                }
                return reply({ group: this.buildGroupStatusFromGroup(group) });
            }
            case 'Group.SetMute': {
                const groupId = typeof params.id === 'string' ? params.id : '';
                const mute = params.mute;
                if (!groupId || typeof mute !== 'boolean') {
                    return error(-32602, 'Invalid params');
                }
                const group = this.groupConfigs.get(groupId);
                if (!group) {
                    return error(-32602, 'Group not found');
                }
                group.muted = mute;
                const active = this.streams.get(group.streamId);
                if (active) {
                    for (const clientId of group.clientIds) {
                        const client = this.findClientById(clientId);
                        if (client && this.isClientOpen(client)) {
                            this.sendSettings(client, active.output, 0, false);
                        }
                    }
                }
                this.sendClientNotification('Group.OnMute', { id: groupId, mute });
                this.sendServerUpdate();
                return reply({ mute });
            }
            case 'Group.SetStream': {
                const groupId = typeof params.id === 'string' ? params.id : '';
                const streamId = typeof params.stream_id === 'string' ? params.stream_id : '';
                if (!groupId || !streamId) {
                    return error(-32602, 'Invalid params');
                }
                const group = this.groupConfigs.get(groupId);
                if (!group) {
                    return error(-32602, 'Group not found');
                }
                group.streamId = streamId;
                for (const clientId of group.clientIds) {
                    this.setClientStream(clientId, streamId);
                }
                this.sendClientNotification('Group.OnStreamChanged', { id: groupId, stream_id: streamId });
                this.sendServerUpdate();
                return reply({ stream_id: streamId });
            }
            case 'Group.SetClients': {
                const groupId = typeof params.id === 'string' ? params.id : '';
                const clients = Array.isArray(params.clients)
                    ? params.clients.filter((c) => typeof c === 'string')
                    : null;
                if (!groupId || !clients) {
                    return error(-32602, 'Invalid params');
                }
                const group = this.groupConfigs.get(groupId);
                if (!group) {
                    return error(-32602, 'Group not found');
                }
                const previousClients = new Set(group.clientIds);
                const requestedClients = new Set(clients);
                // Move removed clients into new standalone groups that keep the same stream.
                for (const clientId of previousClients) {
                    if (requestedClients.has(clientId)) {
                        continue;
                    }
                    group.clientIds.delete(clientId);
                    const newGroupId = randomUUID();
                    const newGroup = this.getOrCreateGroup(newGroupId, group.streamId);
                    newGroup.clientIds.add(clientId);
                    this.clientToGroup.set(clientId, newGroupId);
                }
                // Move requested clients into the target group.
                for (const clientId of requestedClients) {
                    const currentGroup = this.findGroupByClientId(clientId);
                    if (currentGroup && currentGroup.id !== group.id) {
                        currentGroup.clientIds.delete(clientId);
                        if (currentGroup.clientIds.size === 0) {
                            this.groupConfigs.delete(currentGroup.id);
                        }
                    }
                    group.clientIds.add(clientId);
                    this.clientToGroup.set(clientId, group.id);
                    this.setClientStream(clientId, group.streamId);
                }
                if (group.clientIds.size === 0) {
                    this.groupConfigs.delete(group.id);
                }
                const status = this.buildStatus();
                this.sendServerUpdate();
                return reply({ server: status });
            }
            case 'Group.SetName': {
                const groupId = typeof params.id === 'string' ? params.id : '';
                const name = typeof params.name === 'string' ? params.name : '';
                if (!groupId) {
                    return error(-32602, 'Invalid params');
                }
                const group = this.groupConfigs.get(groupId);
                if (!group) {
                    return error(-32602, 'Group not found');
                }
                group.name = name;
                this.sendClientNotification('Group.OnNameChanged', { id: groupId, name });
                this.sendServerUpdate();
                return reply({ name });
            }
            case 'Server.DeleteClient': {
                const clientId = typeof params.id === 'string' ? params.id : '';
                const client = this.findClientById(clientId);
                if (!clientId) {
                    return error(-32602, 'Invalid params');
                }
                if (!client && !this.clientConfigs.has(clientId)) {
                    return error(-32602, 'Invalid params');
                }
                if (client) {
                    this.closeClientSocket(client);
                    this.clients.delete(client);
                    this.removeClientFromGroup(clientId);
                }
                this.clientToGroup.delete(clientId);
                this.clientConfigs.delete(clientId);
                try {
                    for (const group of this.groupConfigs.values()) {
                        group.clientIds.delete(clientId);
                    }
                }
                catch {
                    /* ignore */
                }
                const status = this.buildStatus();
                this.sendServerUpdate();
                return reply({ server: status });
            }
            case 'Stream.Control': {
                const streamId = typeof params.id === 'string' ? params.id : typeof params.stream_id === 'string' ? params.stream_id : '';
                const command = typeof params.command === 'string' ? params.command : '';
                if (!streamId || !command) {
                    return error(-32602, "Parameter 'commmand' is missing");
                }
                const stream = this.streams.get(streamId);
                if (!stream) {
                    return error(-32603, 'Stream not found');
                }
                const result = this.runStreamControl(stream, command, params);
                if (result.ok) {
                    return reply('ok');
                }
                return error(result.error?.code ?? -32603, result.error?.message ?? 'Stream control failed');
            }
            case 'Stream.SetProperty': {
                const streamId = typeof params.id === 'string' ? params.id : '';
                const property = typeof params.property === 'string' ? params.property : '';
                if (!streamId || !property) {
                    return error(-32602, "Parameter 'property' is missing");
                }
                const stream = this.streams.get(streamId);
                if (!stream) {
                    return error(-32603, 'Stream not found');
                }
                const result = this.runStreamProperty(stream, property, params?.value, params);
                if (result.ok) {
                    return reply('ok');
                }
                return error(result.error?.code ?? -32603, result.error?.message ?? 'Stream property failed');
            }
            case 'Stream.AddStream':
                return this.handleStreamAdd(params, reply, error);
            case 'Stream.RemoveStream': {
                const streamId = typeof params.id === 'string' ? params.id : '';
                if (!streamId) {
                    return error(-32602, 'Invalid params');
                }
                if (!this.streams.has(streamId) && !this.rpcStreams.has(streamId)) {
                    return error(-32603, 'Stream not found');
                }
                this.rpcStreams.delete(streamId);
                this.clearStream(streamId);
                for (const [groupId, group] of this.groupConfigs.entries()) {
                    if (groupId === streamId || group.streamId === streamId) {
                        this.groupConfigs.delete(groupId);
                    }
                }
                this.sendServerUpdate();
                return reply({ stream_id: streamId });
            }
            default:
                if (request.id === undefined)
                    return null;
                return error(-32601, 'Method not found');
        }
    }
    runStreamControl(stream, command, params) {
        if (!this.hooks.onStreamControl) {
            return { ok: false, error: { code: -32602, message: `Command '${command}' not supported` } };
        }
        try {
            const result = this.hooks.onStreamControl(this.getStreamContext(stream), command, params);
            return this.normalizeHookResult(result, {
                code: -32602,
                message: `Command '${command}' not supported`,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log.warn('snapcast stream control failed', { message, command, streamId: stream.streamId });
            return { ok: false, error: { code: -32603, message: 'Stream control failed' } };
        }
    }
    runStreamProperty(stream, property, value, params) {
        if (!this.hooks.onStreamProperty) {
            return { ok: false, error: { code: -32602, message: `Property '${property}' not supported` } };
        }
        try {
            const result = this.hooks.onStreamProperty(this.getStreamContext(stream), property, value, params);
            return this.normalizeHookResult(result, {
                code: -32602,
                message: `Property '${property}' not supported`,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log.warn('snapcast stream property failed', { message, property, streamId: stream.streamId });
            return { ok: false, error: { code: -32603, message: 'Stream property failed' } };
        }
    }
    normalizeHookResult(result, fallback) {
        if (result === undefined) {
            return { ok: true };
        }
        if (typeof result === 'boolean') {
            return result ? { ok: true } : { ok: false, error: fallback };
        }
        if (result.ok) {
            return { ok: true };
        }
        if (result.error) {
            return result;
        }
        return { ok: false, error: fallback };
    }
    startRpcUpdates() {
        if (this.rpcInterval)
            return;
        this.rpcInterval = setInterval(() => this.broadcastUpdates(), 1000);
    }
    stopRpcUpdatesIfIdle() {
        if (this.rpcClients.size === 0 && this.rpcInterval) {
            clearInterval(this.rpcInterval);
            this.rpcInterval = null;
        }
    }
    broadcastUpdates() {
        if (this.rpcClients.size === 0)
            return;
        const status = this.buildStatus();
        const changed = status.streams.some((stream) => {
            const sig = JSON.stringify({
                id: stream.id,
                playbackStatus: stream.properties?.playbackStatus,
                position: stream.properties?.position,
                metadata: stream.properties?.metadata,
            });
            const prev = this.streamSignatures.get(stream.id);
            if (prev !== sig) {
                this.streamSignatures.set(stream.id, sig);
                return true;
            }
            return false;
        });
        if (!changed)
            return;
        const notification = {
            jsonrpc: '2.0',
            method: 'Server.OnUpdate',
            params: { server: status },
        };
        const payload = JSON.stringify(notification);
        for (const client of Array.from(this.rpcClients)) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        }
    }
    buildStatus() {
        const serverMeta = this.buildServerMeta();
        const streams = this.buildStreamStatusList();
        const groups = this.buildGroupStatusList();
        return {
            server: serverMeta,
            streams,
            groups,
        };
    }
    buildServerMeta() {
        const hostName = os.hostname();
        const ip = this.pickLocalAddress();
        const base = {
            host: {
                arch: os.arch(),
                ip,
                mac: '',
                name: hostName,
                os: os.platform(),
            },
            snapserver: {
                controlProtocolVersion: this.controlProtocolVersion,
                name: this.serverName,
                protocolVersion: this.protocolVersion,
                version: this.serverVersion,
            },
        };
        const override = this.hooks.getServerMeta?.() ?? {};
        return {
            host: { ...base.host, ...(override?.host ?? {}) },
            snapserver: { ...base.snapserver, ...(override?.snapserver ?? {}) },
        };
    }
    getStreamContext(active) {
        return {
            streamId: active.streamId,
            zoneId: active.zoneId,
            output: active.output,
        };
    }
    getStreamProperties(active) {
        const context = this.getStreamContext(active);
        const raw = this.hooks.getStreamProperties?.(context) ?? {};
        const playbackStatus = raw.playbackStatus ?? 'stopped';
        return {
            canControl: raw.canControl ?? false,
            canGoNext: raw.canGoNext ?? false,
            canGoPrevious: raw.canGoPrevious ?? false,
            canPause: raw.canPause ?? false,
            canPlay: raw.canPlay ?? false,
            canSeek: raw.canSeek ?? false,
            loopStatus: raw.loopStatus ?? 'none',
            shuffle: raw.shuffle ?? false,
            volume: typeof raw.volume === 'number' ? raw.volume : 100,
            playbackStatus,
            position: raw.position,
            metadata: raw.metadata,
        };
    }
    buildStreamUri(active) {
        const context = this.getStreamContext(active);
        const hooked = this.hooks.getStreamUri?.(context);
        if (hooked) {
            return hooked;
        }
        const scheme = this.streamUri.scheme || DEFAULT_STREAM_URI.scheme;
        const host = this.streamUri.host ?? this.pickLocalAddress();
        const basePath = this.normalizeBasePath(this.streamUri.basePath || DEFAULT_STREAM_URI.basePath);
        const path = `${basePath}/${active.streamId}`;
        const raw = this.streamUri.port
            ? `${scheme}://${host}:${this.streamUri.port}${path}`
            : `${scheme}://${host}${path}`;
        return {
            raw,
            scheme,
            host,
            path,
            fragment: '',
            query: {},
        };
    }
    buildStreamStatus(active) {
        const properties = this.getStreamProperties(active);
        const playbackStatus = properties.playbackStatus ?? 'stopped';
        return {
            id: active.streamId,
            status: playbackStatus === 'playing' ? 'playing' : 'idle',
            properties,
            uri: this.buildStreamUri(active),
        };
    }
    buildStreamStatusList() {
        const activeStreams = Array.from(this.streams.values()).map((stream) => this.buildStreamStatus(stream));
        const rpcOnly = Array.from(this.rpcStreams.values())
            .filter((stream) => !this.streams.has(stream.id))
            .map((stream) => this.buildRpcStreamStatus(stream));
        return [...activeStreams, ...rpcOnly];
    }
    buildRpcStreamStatus(stream) {
        const uri = this.parseStreamUri(stream.uri);
        return {
            id: stream.id,
            status: 'idle',
            properties: {
                canControl: false,
                canGoNext: false,
                canGoPrevious: false,
                canPause: false,
                canPlay: false,
                canSeek: false,
                loopStatus: 'none',
                shuffle: false,
                volume: 100,
                playbackStatus: 'stopped',
                position: undefined,
                metadata: undefined,
            },
            uri: uri
                ? {
                    raw: stream.uri,
                    scheme: uri.scheme,
                    host: uri.host,
                    path: uri.path,
                    fragment: uri.fragment,
                    query: uri.query,
                }
                : {
                    raw: stream.uri,
                    scheme: '',
                    host: '',
                    path: '',
                    fragment: '',
                    query: {},
                },
        };
    }
    buildGroupStatus(active) {
        const group = this.findGroupByStreamId(active.streamId);
        if (group) {
            return this.buildGroupStatusFromGroup(group);
        }
        return null;
    }
    buildGroupStatusList() {
        return Array.from(this.groupConfigs.values())
            .map((group) => this.buildGroupStatusFromGroup(group))
            .filter(Boolean);
    }
    buildGroupStatusFromGroup(group) {
        const clients = Array.from(group.clientIds).map((id) => {
            const live = this.findClientById(id);
            if (live) {
                return this.buildClientStatus(live, this.isClientOpen(live));
            }
            return this.buildClientStatusFromConfig(id, false);
        });
        return {
            id: group.id,
            name: group.name,
            muted: group.muted,
            stream_id: group.streamId,
            clients,
        };
    }
    buildClientStatus(client, connected) {
        const clientId = client.clientId ?? 'unknown';
        const config = this.getClientConfig(clientId);
        return {
            id: clientId,
            connected,
            config: {
                instance: config.instance,
                latency: config.latency,
                name: config.name,
                volume: { muted: config.volume.muted, percent: config.volume.percent },
            },
            host: {
                arch: config.host.arch || 'web',
                ip: config.host.ip,
                mac: config.host.mac,
                name: config.host.name || config.name || clientId,
                os: config.host.os,
            },
            snapclient: {
                name: config.snapclient.name || 'snapclient',
                protocolVersion: config.snapclient.protocolVersion || 2,
                version: config.snapclient.version || '0.0.0',
            },
            lastSeen: { sec: Math.floor(Date.now() / 1000), usec: 0 },
        };
    }
    buildClientStatusFromConfig(clientId, connected) {
        const config = this.getClientConfig(clientId);
        return {
            id: clientId,
            connected,
            config: {
                instance: config.instance,
                latency: config.latency,
                name: config.name,
                volume: { muted: config.volume.muted, percent: config.volume.percent },
            },
            host: {
                arch: config.host.arch || 'web',
                ip: config.host.ip,
                mac: config.host.mac,
                name: config.host.name || config.name || clientId,
                os: config.host.os,
            },
            snapclient: {
                name: config.snapclient.name || 'snapclient',
                protocolVersion: config.snapclient.protocolVersion || 2,
                version: config.snapclient.version || '0.0.0',
            },
            lastSeen: { sec: Math.floor(Date.now() / 1000), usec: 0 },
        };
    }
    pickLocalAddress() {
        const nets = networkInterfaces();
        for (const name of Object.keys(nets)) {
            for (const net of nets[name] || []) {
                if (net.family === 'IPv4' && !net.internal && net.address) {
                    return net.address;
                }
            }
        }
        return '127.0.0.1';
    }
    ensureClientConfig(clientId, instance) {
        const parsedInstance = this.parseInstance(clientId, instance);
        const existing = this.clientConfigs.get(clientId);
        if (existing) {
            existing.instance = parsedInstance;
            return existing;
        }
        const config = {
            instance: parsedInstance,
            latency: 0,
            name: '',
            volume: { muted: false, percent: 100 },
            host: {
                arch: '',
                ip: '',
                mac: '',
                name: '',
                os: '',
            },
            snapclient: {
                name: 'snapclient',
                protocolVersion: 2,
                version: '0.0.0',
            },
        };
        this.clientConfigs.set(clientId, config);
        return config;
    }
    getClientConfig(clientId) {
        return this.ensureClientConfig(clientId);
    }
    getClientVolume(clientId) {
        if (!clientId) {
            return { muted: false, percent: 100 };
        }
        return this.ensureClientConfig(clientId).volume;
    }
    setClientVolume(clientId, volume) {
        const config = this.ensureClientConfig(clientId);
        config.volume = volume;
    }
    parseInstance(clientId, instance) {
        if (typeof instance === 'number' && instance > 0) {
            return Math.floor(instance);
        }
        const match = /#(\d+)$/.exec(clientId);
        if (match) {
            const parsed = Number(match[1]);
            if (Number.isFinite(parsed) && parsed > 0) {
                return parsed;
            }
        }
        return 1;
    }
    findClientById(clientId) {
        for (const client of this.clients) {
            if (client.clientId === clientId) {
                return client;
            }
        }
        return null;
    }
    updateClientStream(client, streamId) {
        if (client.streamId === streamId) {
            return;
        }
        const previous = client.streamId;
        client.streamId = streamId;
        this.updateFlowControl(previous);
        this.updateFlowControl(streamId);
    }
    ensureGroupForClient(clientId, streamId) {
        const existing = this.findGroupByClientId(clientId);
        if (existing) {
            existing.clientIds.add(clientId);
            return;
        }
        const groupId = randomUUID();
        const group = this.getOrCreateGroup(groupId, streamId);
        group.clientIds.add(clientId);
        this.clientToGroup.set(clientId, groupId);
    }
    removeClientFromGroup(clientId) {
        const group = this.findGroupByClientId(clientId);
        if (!group) {
            return;
        }
        group.clientIds.delete(clientId);
        this.clientToGroup.delete(clientId);
        if (group.clientIds.size === 0) {
            this.groupConfigs.delete(group.id);
        }
    }
    findGroupByStreamId(streamId) {
        for (const group of this.groupConfigs.values()) {
            if (group.streamId === streamId) {
                return group;
            }
        }
        return null;
    }
    findGroupByClientId(clientId) {
        if (!clientId) {
            return null;
        }
        const groupId = this.clientToGroup.get(clientId);
        if (groupId) {
            const group = this.groupConfigs.get(groupId);
            if (group) {
                return group;
            }
        }
        for (const group of this.groupConfigs.values()) {
            if (group.clientIds.has(clientId)) {
                this.clientToGroup.set(clientId, group.id);
                return group;
            }
        }
        return null;
    }
    getOrCreateGroup(id, streamId) {
        const existing = this.groupConfigs.get(id);
        if (existing) {
            return existing;
        }
        const group = {
            id,
            name: '',
            muted: false,
            streamId,
            clientIds: new Set(),
        };
        this.groupConfigs.set(id, group);
        return group;
    }
    sendClientNotification(method, params) {
        if (this.rpcClients.size === 0)
            return;
        const payload = JSON.stringify({ jsonrpc: '2.0', method, params });
        for (const client of Array.from(this.rpcClients)) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        }
    }
    sendServerUpdate() {
        if (this.rpcClients.size === 0)
            return;
        const status = this.buildStatus();
        const payload = JSON.stringify({
            jsonrpc: '2.0',
            method: 'Server.OnUpdate',
            params: { server: status },
        });
        for (const client of Array.from(this.rpcClients)) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        }
    }
}
