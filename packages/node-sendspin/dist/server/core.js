import { URL } from 'node:url';
import { ConnectionReason, } from '../types.js';
import { SendspinSession, } from './session.js';
import { SENTINEL_RESOLVED } from '../noise/handshake.js';
/**
 * Core Sendspin session manager: tracks WebSocket sessions and routes server-driven messages.
 */
/** Ping every connected socket on this cadence; a socket that doesn't pong
 *  before the next sweep is considered dead and terminated (so ≈30–60s to
 *  reap). Mirrors the reference server's aiohttp `heartbeat=30`. Browsers (and
 *  the node `ws` client) reply to control-frame pings automatically, so a live
 *  tab stays alive without any client code — only genuinely-dead sockets
 *  (crashed tab, vanished network, force-quit) fail to pong and get reaped. */
const HEARTBEAT_INTERVAL_MS = 30000;
/** A stored goodbye reason older than this is treated as stale and ignored, so
 *  an ancient goodbye can never be mistaken for the reason behind a much later,
 *  unclean disconnect. The poller consumes it within one cycle (~2s). */
const GOODBYE_TTL_MS = 10000;
export class SendspinCore {
    /**
     * Name this server to its clients.
     *
     * Call this before accepting connections. `serverId` should be something stable
     * and unique to this machine — a MAC-derived id, not a constant — because a
     * client with more than one server on the network tells them apart by it.
     */
    configureServer(info) {
        this.serverInfo = { ...this.serverInfo, ...info };
    }
    /**
     * Turn on the encrypted path.
     *
     * `identity` must be persisted and reloaded: it is this server's `server_id`
     * under encryption, so a fresh one on every boot looks like a different server.
     * With no `pskProvider` every client is admitted with the published Sentinel
     * PSK — encrypted against a passive listener, authenticating nothing, which is
     * what unpaired playback means.
     */
    enableEncryption(identity, pskProvider, options = {}) {
        this.security = {
            identity,
            pskProvider: pskProvider ?? (() => SENTINEL_RESOLVED),
            ...(options.isApprovedUnpaired ? { isApprovedUnpaired: options.isApprovedUnpaired } : {}),
        };
        this.serverInfo = { ...this.serverInfo, serverId: identity.peerId };
    }
    /** Whether the encrypted path is available. */
    isEncryptionEnabled() {
        return this.security !== null;
    }
    /** This server's `server_id`: its public key when encrypted, else the configured id. */
    getServerId() {
        return this.serverInfo.serverId;
    }
    constructor() {
        this.sessionsBySocket = new Map();
        this.hooksByClientId = new Map();
        this.leadStatsByClientId = new Map();
        // Liveness flag per socket; flipped false before each ping, true on pong.
        this.aliveBySocket = new Map();
        // Last goodbye reason per clientId, captured at close so callers can tell an
        // intentional leave (user_request/shutdown) from a dropped socket afterwards.
        this.recentGoodbyeByClientId = new Map();
        this.security = null;
        this.serverInfo = { serverId: 'server', name: 'Sendspin Server' };
        this.heartbeatTimer = setInterval(() => this.sweepHeartbeats(), HEARTBEAT_INTERVAL_MS);
        // Don't keep the process alive just for the heartbeat.
        this.heartbeatTimer.unref?.();
    }
    /** Terminate sockets that didn't pong since the last sweep; ping the rest.
     *  `terminate()` fires `'close'`, which runs the normal session cleanup. */
    sweepHeartbeats() {
        for (const ws of this.sessionsBySocket.keys()) {
            if (this.aliveBySocket.get(ws) === false) {
                ws.terminate();
                continue;
            }
            this.aliveBySocket.set(ws, false);
            try {
                ws.ping();
            }
            catch {
                // Socket already closing; the next sweep (or 'close') cleans it up.
            }
        }
    }
    handleConnection(ws, req, connectionReason = ConnectionReason.DISCOVERY) {
        const meta = this.extractConnectionMetadata(req);
        const session = new SendspinSession(ws, req ?? null, connectionReason, {
            zoneId: meta.zoneId,
            playerId: meta.playerId,
            remote: req?.socket?.remoteAddress ?? null,
        }, {}, this.security, this.serverInfo);
        this.sessionsBySocket.set(ws, session);
        this.aliveBySocket.set(ws, true);
        ws.on('pong', () => {
            this.aliveBySocket.set(ws, true);
        });
        ws.on('message', (data, isBinary) => {
            /*
             * Nothing a peer sends may throw out of here: an exception escaping a socket
             * handler is uncaught, and a host that treats those as fatal (Audioserver
             * shuts down) would let any peer stop the server with one message. The
             * session already refuses malformed input; this is the backstop for a bug.
             */
            try {
                if (isBinary) {
                    session.handleBinary(data);
                }
                else {
                    session.handleText(data.toString());
                    const info = session.getClientId();
                    if (info && !session.hasHooksAttached()) {
                        const entry = this.hooksByClientId.get(info);
                        if (entry) {
                            session.setHooks(entry.hooks, entry.context);
                        }
                    }
                }
            }
            catch {
                try {
                    ws.close(1011, 'internal error');
                }
                catch {
                    /* ignore */
                }
            }
        });
        ws.on('close', () => {
            this.sessionsBySocket.delete(ws);
            this.aliveBySocket.delete(ws);
            const clientId = session.getClientId();
            const reason = session.getLastGoodbyeReason();
            if (clientId && reason) {
                this.recentGoodbyeByClientId.set(clientId, { reason, at: Date.now() });
            }
            session.destroy();
        });
        ws.on('error', () => {
            // Ignore; close will clean up.
        });
    }
    registerHooks(clientId, hooks, context) {
        this.hooksByClientId.set(clientId, { hooks, context });
        const session = this.getSession(clientId);
        if (session) {
            session.setHooks(hooks, context);
        }
    }
    unregisterHooks(clientId) {
        this.hooksByClientId.delete(clientId);
        const session = this.getSession(clientId);
        if (session) {
            session.setHooks({});
        }
    }
    listClients() {
        const items = [];
        for (const session of this.sessionsBySocket.values()) {
            const sourceStatus = session.getSourceStatus();
            items.push({
                clientId: session.getClientId(),
                name: session.getClientName(),
                roles: session.getRoles(),
                remote: session.getRemoteAddress(),
                playbackState: session.getDescriptor().playbackState,
                sourceState: sourceStatus.state ?? null,
                sourceSignal: sourceStatus.signal ?? null,
            });
        }
        return items;
    }
    listDescriptors() {
        const items = [];
        for (const session of this.sessionsBySocket.values()) {
            items.push(session.getDescriptor());
        }
        return items;
    }
    getSessionBySocket(ws) {
        return this.sessionsBySocket.get(ws);
    }
    getSessions() {
        return this.sessionsBySocket.values();
    }
    /** Read and clear the goodbye reason a client reported as it last left.
     *  Returns null if it dropped without a goodbye (unclean disconnect) or the
     *  recorded reason is stale. Lets callers skip the reconnect grace for an
     *  intentional `user_request`/`shutdown` leave. */
    takeGoodbyeReason(clientId) {
        const entry = this.recentGoodbyeByClientId.get(clientId);
        if (!entry)
            return null;
        this.recentGoodbyeByClientId.delete(clientId);
        return Date.now() - entry.at <= GOODBYE_TTL_MS ? entry.reason : null;
    }
    sendPcmFrameToClient(clientId, frame) {
        this.getSession(clientId)?.sendPcmAudioFrame(frame);
    }
    sendStreamStart(clientId, format) {
        this.getSession(clientId)?.sendStreamStart(format);
    }
    sendStreamClear(clientId, roles) {
        this.getSession(clientId)?.sendStreamClear(roles);
    }
    sendStreamEnd(clientId, roles) {
        this.getSession(clientId)?.sendStreamEnd(roles);
    }
    /**
     * Why this client's encrypted session is held idle ("pairing required"), or null
     * when it may play or is not connected. See `SendspinSession.getPairingRequired`.
     */
    getPairingRequired(clientId) {
        return this.getSession(clientId)?.getPairingRequired() ?? null;
    }
    /**
     * Declare or drop `'playback'` on this client's encrypted rc1 connection. Drop it
     * when its group stops so another server may take the client (spec #314); a later
     * stream start raises it again by itself.
     */
    setPlaybackActive(clientId, active) {
        this.getSession(clientId)?.setPlaybackActive(active);
    }
    /** End only the player and visualizer streams, keeping the artwork up: a pause (spec #346). */
    endPlaybackStreams(clientId) {
        this.getSession(clientId)?.endPlaybackStreams();
    }
    sendGroupUpdate(clientId, playbackState, groupId, groupName) {
        this.getSession(clientId)?.sendGroupUpdate(playbackState, groupId, groupName);
    }
    sendMetadata(clientId, payload) {
        this.getSession(clientId)?.sendMetadata(payload);
    }
    setClientMetadata(clientId, payload) {
        this.sendMetadata(clientId, payload);
    }
    sendServerCommand(clientId, payload) {
        this.getSession(clientId)?.sendServerCommand(payload);
    }
    sendArtworkStreamStart(clientId, channels) {
        this.getSession(clientId)?.sendArtworkStreamStart(channels);
    }
    sendArtwork(clientId, channel, imageData) {
        this.getSession(clientId)?.sendArtwork(channel, imageData);
    }
    /**
     * Header bytes in front of each player audio chunk for this client (13 for an
     * rc1 peer, 9 for a legacy one), or null when it is not connected. A count of
     * bytes against the player's `buffer_capacity` must include them.
     */
    getAudioHeaderSize(clientId) {
        return this.getSession(clientId)?.getAudioHeaderSize() ?? null;
    }
    /** Bytes this client's player holds against its `buffer_capacity` (rc1 accounting), or null. */
    getPlayerBufferedBytes(clientId) {
        return this.getSession(clientId)?.getPlayerBufferedBytes() ?? null;
    }
    /** Microseconds until `bytes` more audio fit in this client's player buffer, or null. */
    timeUntilPlayerCapacityUs(clientId, bytes) {
        return this.getSession(clientId)?.timeUntilPlayerCapacityUs(bytes) ?? null;
    }
    sendVisualizerStreamStart(clientId, config) {
        this.getSession(clientId)?.sendVisualizerStreamStart(config);
    }
    sendVisualizerFrame(clientId, data, timestampUs) {
        this.getSession(clientId)?.sendVisualizerFrame(data, timestampUs);
    }
    // visualizer@v1 (per-type frames).
    /** `device_info` this client reported in its hello, or null. */
    getDeviceInfo(clientId) {
        return this.getSession(clientId)?.getDeviceInfo() ?? null;
    }
    getVisualizerSupport(clientId) {
        return this.getSession(clientId)?.getVisualizerSupport() ?? null;
    }
    sendVisualizerStreamStartV1(clientId, config) {
        this.getSession(clientId)?.sendVisualizerStreamStartV1(config);
    }
    sendVisualizerLoudness(clientId, loudness, timestampUs) {
        this.getSession(clientId)?.sendVisualizerLoudness(loudness, timestampUs);
    }
    sendVisualizerSpectrum(clientId, bins, timestampUs) {
        this.getSession(clientId)?.sendVisualizerSpectrum(bins, timestampUs);
    }
    sendVisualizerFpeak(clientId, freqHz, amplitude, timestampUs) {
        this.getSession(clientId)?.sendVisualizerFpeak(freqHz, amplitude, timestampUs);
    }
    sendVisualizerPeak(clientId, strength, timestampUs) {
        this.getSession(clientId)?.sendVisualizerPeak(strength, timestampUs);
    }
    sendVisualizerPitch(clientId, midiQ88, confidence, timestampUs) {
        this.getSession(clientId)?.sendVisualizerPitch(midiQ88, confidence, timestampUs);
    }
    sendVisualizerBeat(clientId, downbeat, timestampUs) {
        this.getSession(clientId)?.sendVisualizerBeat(downbeat, timestampUs);
    }
    sendControllerState(clientId, payload) {
        this.getSession(clientId)?.sendControllerState(payload);
    }
    sendColor(clientId, payload) {
        this.getSession(clientId)?.sendColor(payload);
    }
    setClientControllerState(clientId, payload) {
        this.sendControllerState(clientId, payload);
    }
    setClientPlaybackState(clientId, playbackState, groupId, groupName) {
        this.sendGroupUpdate(clientId, playbackState, groupId, groupName);
    }
    getSessionByClientId(clientId) {
        return this.getSession(clientId);
    }
    getStreamFormat(clientId) {
        return this.getSession(clientId)?.getStreamFormat() ?? null;
    }
    getPlayerBufferCapacity(clientId) {
        const cap = this.getSession(clientId)?.getPlayerBufferCapacity() ?? 0;
        return cap > 0 ? cap : null;
    }
    setLeadStats(clientId, stats) {
        if (!clientId)
            return;
        this.leadStatsByClientId.set(clientId, {
            leadUs: stats.leadUs,
            targetLeadUs: stats.targetLeadUs,
            bufferedBytes: stats.bufferedBytes,
            updatedAt: Date.now(),
        });
    }
    clearLeadStats(clientId) {
        if (!clientId)
            return;
        this.leadStatsByClientId.delete(clientId);
    }
    getLeadStats(clientId) {
        return this.leadStatsByClientId.get(clientId) ?? null;
    }
    getArtworkChannels(clientId) {
        return this.getSession(clientId)?.getArtworkChannels() ?? null;
    }
    getBackpressureStats(clientId) {
        return this.getSession(clientId)?.getBackpressureStats() ?? null;
    }
    getSession(clientId) {
        let preferred;
        let fallback;
        for (const session of this.sessionsBySocket.values()) {
            if (session.getClientId() === clientId) {
                if (session.getConnectionReason() === ConnectionReason.PLAYBACK && !preferred) {
                    preferred = session;
                }
                else if (!fallback) {
                    fallback = session;
                }
            }
        }
        return preferred ?? fallback;
    }
    extractConnectionMetadata(req) {
        if (!req?.url) {
            return {};
        }
        try {
            const url = new URL(req.url, 'http://localhost');
            const zoneStr = url.searchParams.get('zone');
            const zoneId = zoneStr && Number.isFinite(Number(zoneStr)) ? Number(zoneStr) : undefined;
            const playerId = url.searchParams.get('player') ?? undefined;
            return { zoneId, playerId };
        }
        catch {
            return {};
        }
    }
}
