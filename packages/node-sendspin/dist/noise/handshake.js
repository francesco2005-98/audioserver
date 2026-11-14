/**
 * Server-side driver for the cleartext init exchange and the KKpsk2 handshake.
 *
 * The sequence, all of it before a single application message:
 *
 *   1. client -> `client/init`  {client_id, version, suite}   (cleartext TEXT)
 *   2. server -> `server/init`  {server_id, version}          (cleartext TEXT)
 *   3. server -> `noise/handshake` message 1, payload {psk_id, psk_category}
 *   4. client -> `noise/handshake` message 2, payload {}
 *   5. transport mode: binary frames only
 *
 * The two init frames are concatenated verbatim into the Noise prologue, so a
 * tampered suite or identity fails the handshake rather than silently downgrading
 * anything. Steps 2 and 3 go out back-to-back — the spec has the server wait for
 * nothing in between.
 */
import { b64urlDecode, b64urlEncode, NOISE_PROTOCOL_VERSION, peerIdToPublicKey, PSK_SIZE, SENTINEL_PSK, SENTINEL_PSK_ID, pskIdFor, } from './keys.js';
import { NoiseSession, SUPPORTED_SUITES } from './session.js';
import { NoiseTransport } from './wire.js';
/** Raised when the handshake cannot complete. The caller closes the socket silently. */
export class HandshakeAbortedError extends Error {
}
/**
 * A `client/init` this server cannot accept. Unlike a silent failure, the server
 * answers it with `server/error {reason}` in place of `server/init`, then closes
 * (connection.md "Failure Handling", #265).
 */
export class InitRejectedError extends HandshakeAbortedError {
    constructor(reason, message) {
        super(message);
        this.reason = reason;
    }
}
/** The `server/error` frame for `reason`, sent as cleartext TEXT. */
export function serverErrorFrame(reason) {
    return JSON.stringify({ type: 'server/error', payload: { reason } });
}
/**
 * Validate a `client/init` in the spec's order (envelope, version, suite, then the
 * remaining fields), so the first failure decides the `server/error` reason, as
 * aiosendspin's `_parse_client_init` does. A version that is not an integer is
 * malformed; an integer other than 1 is unsupported.
 */
function parseClientInit(text) {
    let decoded;
    try {
        decoded = JSON.parse(text);
    }
    catch {
        throw new InitRejectedError('malformed', 'malformed client/init: not JSON');
    }
    const envelope = decoded;
    const payload = envelope && typeof envelope === 'object' ? envelope.payload : undefined;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || envelope?.type !== 'client/init') {
        throw new InitRejectedError('malformed', 'malformed client/init: not a client/init envelope');
    }
    const fields = payload;
    if (typeof fields.version !== 'number' || !Number.isInteger(fields.version)) {
        throw new InitRejectedError('malformed', `malformed client/init version ${String(fields.version)}`);
    }
    if (fields.version !== NOISE_PROTOCOL_VERSION) {
        throw new InitRejectedError('unsupported_version', `unsupported protocol version ${fields.version}`);
    }
    if (typeof fields.suite !== 'string') {
        throw new InitRejectedError('malformed', 'malformed client/init suite');
    }
    if (!SUPPORTED_SUITES.includes(fields.suite)) {
        throw new InitRejectedError('unsupported_suite', `unsupported suite ${fields.suite}`);
    }
    if (typeof fields.client_id !== 'string') {
        throw new InitRejectedError('malformed', 'malformed client/init client_id');
    }
    let clientStaticPub;
    try {
        clientStaticPub = peerIdToPublicKey(fields.client_id, 'client_id');
    }
    catch (error) {
        throw new InitRejectedError('malformed', error?.message ?? 'malformed client/init client_id');
    }
    return { clientId: fields.client_id, suite: fields.suite, clientStaticPub };
}
/** How a connection was admitted, which is what its trust ultimately rests on. */
export var PskCategory;
(function (PskCategory) {
    /** The published Sentinel PSK: authenticates nothing. Unpaired playback only. */
    PskCategory["SENTINEL"] = "sentinel";
    /** A stored per-client credential from a completed pairing. */
    PskCategory["LONG_TERM"] = "long_term";
    /** A Pairing PSK distributed out of band to admit a new client. */
    PskCategory["PAIRING"] = "pairing";
})(PskCategory || (PskCategory = {}));
/**
 * The two-letter code a category travels under in Noise message 1's
 * `psk_category`. It binds both sides to the same use of the PSK, so a client
 * holding the matched PSK under another category falls back to the Sentinel.
 */
export const PSK_CATEGORY_CODE = {
    [PskCategory.SENTINEL]: 'sn',
    [PskCategory.LONG_TERM]: 'lt',
    [PskCategory.PAIRING]: 'pr',
};
/** The category a wire code names, or null for a code this side does not know. */
export function pskCategoryFromCode(code) {
    for (const [category, value] of Object.entries(PSK_CATEGORY_CODE)) {
        if (value === code)
            return category;
    }
    return null;
}
/** The Sentinel PSK as a resolved record, which is what unpaired access admits with. */
export const SENTINEL_RESOLVED = {
    pskId: SENTINEL_PSK_ID,
    psk: SENTINEL_PSK,
    category: PskCategory.SENTINEL,
};
function parseJson(text, what) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new HandshakeAbortedError(`malformed ${what}`);
    }
    if (!parsed || typeof parsed !== 'object')
        throw new HandshakeAbortedError(`malformed ${what}`);
    return parsed;
}
/** Whether a first frame is the start of an encrypted connection. */
export function isClientInit(text) {
    try {
        return JSON.parse(text)?.type === 'client/init';
    }
    catch {
        return false;
    }
}
/**
 * Begin the server-side handshake from the client's `client/init` frame.
 *
 * Split into "what to send" and a `finish` callback rather than owning the socket,
 * so the session keeps one place where bytes go out and the whole exchange stays
 * testable without a WebSocket.
 */
export async function beginServerHandshake(options) {
    const { clientInitText, identity, pskProvider } = options;
    const { clientId, suite, clientStaticPub } = parseClientInit(clientInitText);
    // Resolve the PSK and build message 1 before sending anything, so a client we
    // will not admit is dropped without ever seeing server/init.
    const resolved = await pskProvider(clientId);
    if (!resolved)
        throw new HandshakeAbortedError(`no PSK admits client_id=${clientId}`);
    if (resolved.psk.length !== PSK_SIZE)
        throw new HandshakeAbortedError('PSK must be 32 bytes');
    const serverInitText = JSON.stringify({
        type: 'server/init',
        payload: { server_id: identity.peerId, version: NOISE_PROTOCOL_VERSION },
    });
    const prologue = Buffer.concat([
        Buffer.from(clientInitText, 'utf8'),
        Buffer.from(serverInitText, 'utf8'),
    ]);
    const session = NoiseSession.asInitiator({
        suite,
        localStaticPriv: identity.privateBytes,
        remoteStaticPub: clientStaticPub,
        prologue,
        psk: resolved.psk,
    });
    const message1 = session.writeMessage(Buffer.from(JSON.stringify({ psk_id: resolved.pskId, psk_category: PSK_CATEGORY_CODE[resolved.category] }), 'utf8'));
    return {
        send: [serverInitText, packHandshake(message1)],
        finish: (message2Text) => {
            const parsed = parseJson(message2Text, 'noise/handshake');
            if (parsed.type !== 'noise/handshake') {
                throw new HandshakeAbortedError(`expected noise/handshake, got ${String(parsed.type)}`);
            }
            const data = (parsed.payload ?? {}).data;
            if (typeof data !== 'string') {
                throw new HandshakeAbortedError('malformed noise/handshake payload');
            }
            let ciphertext;
            try {
                ciphertext = b64urlDecode(data);
            }
            catch {
                throw new HandshakeAbortedError('malformed Noise message 2 encoding');
            }
            // Taken before the first attempt mutates the session (see forkWithPsk).
            const fallback = resolved.category === PskCategory.SENTINEL ? null : session.forkWithPsk(SENTINEL_PSK);
            let plaintext;
            let finished = session;
            let credentialMismatch = false;
            try {
                plaintext = session.readMessage(ciphertext);
            }
            catch {
                if (!fallback)
                    throw new HandshakeAbortedError('Noise message 2 failed authentication');
                try {
                    plaintext = fallback.readMessage(ciphertext);
                }
                catch {
                    throw new HandshakeAbortedError('Noise message 2 failed authentication');
                }
                finished = fallback;
                credentialMismatch = true;
            }
            // The payload is an empty object; anything else means we are not talking to
            // what we think we are.
            parseJson(plaintext.toString('utf8'), 'Noise message 2 payload');
            return {
                transport: new NoiseTransport(finished),
                session: finished,
                clientId,
                suite,
                psk: credentialMismatch ? SENTINEL_RESOLVED : resolved,
                handshakeHash: finished.handshakeHash,
                prologue,
                ...(credentialMismatch ? { credentialMismatch: true } : {}),
            };
        },
    };
}
/** Recognise the Sentinel PSK and nothing else: unpaired access, no stored credentials. */
export const defaultClientPskResolver = (pskId, category) => pskId === SENTINEL_PSK_ID && (category === null || category === PskCategory.SENTINEL)
    ? SENTINEL_RESOLVED
    : null;
/**
 * Client-side (Noise responder) handshake.
 *
 * Mirror of the server driver: it returns the frames to send and a callback per
 * incoming frame, so the caller keeps ownership of the socket.
 *
 * `expectedServerId` is what turns encryption into authentication. Without it the
 * statics are only what this very connection claimed, so an active
 * man-in-the-middle can substitute its own in both directions; a caller that has
 * paired before should pass the id it stored.
 */
export function beginClientHandshake(options) {
    const { identity, suite, pskResolver = defaultClientPskResolver, expectedServerId } = options;
    if (!SUPPORTED_SUITES.includes(suite)) {
        throw new HandshakeAbortedError(`unsupported suite ${suite}`);
    }
    const clientInit = JSON.stringify({
        type: 'client/init',
        payload: { client_id: identity.peerId, version: NOISE_PROTOCOL_VERSION, suite },
    });
    let serverId = null;
    let prologue = null;
    let session = null;
    return {
        clientInit,
        onServerInit: (serverInitText) => {
            const init = parseJson(serverInitText, 'server/init');
            if (init.type === 'server/error') {
                // The server refused our client/init and closes after this (#265).
                const reason = String((init.payload ?? {}).reason ?? 'malformed');
                throw new InitRejectedError(reason, `server rejected client/init: ${reason}`);
            }
            if (init.type !== 'server/init') {
                throw new HandshakeAbortedError(`expected server/init, got ${String(init.type)}`);
            }
            const payload = (init.payload ?? {});
            if (payload.version !== NOISE_PROTOCOL_VERSION) {
                throw new HandshakeAbortedError(`unsupported protocol version ${String(payload.version)}`);
            }
            serverId = typeof payload.server_id === 'string' ? payload.server_id : '';
            if (expectedServerId !== undefined && serverId !== expectedServerId) {
                throw new HandshakeAbortedError(`server_id mismatch: expected ${expectedServerId}, got ${serverId}`);
            }
            const serverStaticPub = peerIdToPublicKey(serverId, 'server_id');
            prologue = Buffer.concat([
                Buffer.from(clientInit, 'utf8'),
                Buffer.from(serverInitText, 'utf8'),
            ]);
            // No PSK yet: KKpsk2 mixes it at message 2, and message 1 is what names it.
            session = NoiseSession.asResponder({
                suite,
                localStaticPriv: identity.privateBytes,
                remoteStaticPub: serverStaticPub,
                prologue,
            });
        },
        onMessage1: async (message1Text) => {
            if (!session || !prologue || serverId === null) {
                throw new HandshakeAbortedError('server/init has not been processed yet');
            }
            const parsed = parseJson(message1Text, 'noise/handshake');
            if (parsed.type !== 'noise/handshake') {
                throw new HandshakeAbortedError(`expected noise/handshake, got ${String(parsed.type)}`);
            }
            const data = (parsed.payload ?? {}).data;
            if (typeof data !== 'string') {
                throw new HandshakeAbortedError('malformed noise/handshake payload');
            }
            let plaintext;
            try {
                plaintext = session.readMessage(b64urlDecode(data));
            }
            catch {
                throw new HandshakeAbortedError('Noise message 1 failed authentication');
            }
            const named = parseJson(plaintext.toString('utf8'), 'Noise message 1 payload');
            const pskId = typeof named.psk_id === 'string' ? named.psk_id : '';
            // Absent: a server from before the field existed. Present but unknown: a
            // silent failure, so a category this side cannot honour is never guessed at.
            let category = null;
            if (named.psk_category !== undefined) {
                category = pskCategoryFromCode(named.psk_category);
                if (!category) {
                    throw new HandshakeAbortedError(`unknown psk_category ${String(named.psk_category)}`);
                }
            }
            // A miss completes the handshake under the Sentinel rather than failing, so
            // the server sees an authenticated credential-mismatch signal.
            const resolved = (await pskResolver(pskId, category)) ?? SENTINEL_RESOLVED;
            session.mixPsk(resolved.psk);
            const message2 = session.writeMessage(Buffer.from('{}', 'utf8'));
            return {
                send: packHandshake(message2),
                result: {
                    transport: new NoiseTransport(session),
                    session,
                    serverId,
                    suite,
                    psk: resolved,
                    handshakeHash: session.handshakeHash,
                    prologue,
                    pskCategoryNamed: named.psk_category !== undefined,
                },
            };
        },
    };
}
function packHandshake(noiseBytes) {
    return JSON.stringify({
        type: 'noise/handshake',
        payload: { data: b64urlEncode(noiseBytes) },
    });
}
export { pskIdFor };
