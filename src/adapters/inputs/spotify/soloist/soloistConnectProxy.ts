import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLogger } from '@/shared/logging/logger';

const log = createLogger('Input', 'SoloistConnectProxy');

/**
 * Spotify Connect through the gateway port.
 *
 * Soloist opens its Zeroconf service on a new random port every start, and has no flag to pin
 * it. A host firewall such as UFW blocks that port, so the phone sees the announcement, cannot
 * reach the device behind it and leaves it out of the list. The gateway port is already open,
 * so the announcement names it and a path per device, and the request is passed on here.
 */
const PREFIX = '/spotify-connect/';
const PATH_RE = /^\/spotify-connect\/(\d+)\/zc\/?$/;

const allowed = new Set<number>();
let gatewayPort = 0;

export function setConnectGatewayPort(port: number): void {
  gatewayPort = port;
}

/** The port the announcement names, or 0 while the gateway is not up. */
export function connectGatewayPort(): number {
  return gatewayPort;
}

/** The path the announcement names for one Soloist, as its `CPath`. */
export function connectPathFor(localPort: number): string {
  return `${PREFIX}${localPort}/zc`;
}

/** Open the path for one running Soloist. Only these ports are reachable through it. */
export function allowConnectPort(localPort: number): () => void {
  allowed.add(localPort);
  return () => {
    allowed.delete(localPort);
  };
}

export function matchesConnectProxy(pathname: string): boolean {
  return pathname.startsWith(PREFIX);
}

export function handleConnectProxy(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  const localPort = Number(PATH_RE.exec(pathname)?.[1] ?? 0);
  if (!localPort || !allowed.has(localPort)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  const query = (req.url ?? '').split('?')[1];
  const headers = { ...req.headers, host: `127.0.0.1:${localPort}` };
  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: localPort,
      method: req.method,
      path: query ? `/zc?${query}` : '/zc',
      headers,
      timeout: 15_000,
    },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
  upstream.on('error', (error) => {
    log.debug('spotify connect request failed', { localPort, message: error.message });
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
    }
    res.end();
  });
  req.pipe(upstream);
}
