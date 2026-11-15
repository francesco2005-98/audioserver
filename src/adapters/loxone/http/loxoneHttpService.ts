import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  connection as WebSocketConnection,
  Message,
  server as WebSocketServer,
} from 'websocket';
import { createLogger } from '@/shared/logging/logger';
import { loxoneIdentification, type LoxoneHttpConfig } from '@/config/loxone';
import { LoxoneCommandProcessor } from '@/adapters/loxone/http/commandProcessor';
import { LoxoneUdpDiscovery } from '@/adapters/loxone/http/loxoneUdpDiscovery';
import { createDualProtocolServer } from '@/adapters/loxone/http/protocolDispatcher';
import { loadOrGenerateSelfSignedTls, type TlsContext } from '@/adapters/loxone/http/tlsContext';
import type { LoxoneServerOptions } from '@/adapters/loxone/http/types';
import { formatCommand } from '@/adapters/loxone/commands/utils/commandFormatter';
import type { ConnectionRegistry } from '@/adapters/loxone/ws/connectionRegistry';
import type { ServerHeartbeat } from '@/adapters/loxone/ws/serverHeartbeat';
import { describePayload, loxonePairingMonitor } from '@/adapters/loxone/pairingMonitor';
import type { LoxoneWsNotifier } from '@/adapters/loxone/ws/notifier';
import type { ZoneManagerFacade } from '@/application/zones/createZoneManager';
import type { ConfigPort } from '@/ports/ConfigPort';

const LOXONE_MAX_COMMAND_BYTES = 16 * 1024 * 1024;

interface ServerRuntime {
  definition: LoxoneServerOptions;
  httpServer: http.Server;
  listener: net.Server;
  wsServer: WebSocketServer;
  tlsEnabled: boolean;
  /** Live sockets, so stop() can force the port free instead of waiting them out. */
  sockets: Set<net.Socket>;
}

export interface LoxoneHttpServiceOptions {
  host: string;
  processor: LoxoneCommandProcessor;
  connectionRegistry: ConnectionRegistry;
  serverHeartbeat: ServerHeartbeat;
  /** Shapes zone state into the Loxone payload, so the connect snapshot below
   *  sends exactly what the steady-state broadcast does. */
  notifier: LoxoneWsNotifier;
  zoneManager: ZoneManagerFacade;
  configPort: ConfigPort;
  /** Pushes the current group list. The boot restore broadcasts before any client exists. */
  groupSync?: { broadcastGroupState: () => void };
}

/**
 * Hosts both Loxone HTTP/WebSocket endpoints (app + miniserver ports).
 */
export class LoxoneHttpService {
  private readonly log = createLogger('LoxoneHttp');
  private readonly processor: LoxoneCommandProcessor;
  private readonly servers: ServerRuntime[] = [];
  private readonly udpDiscovery = new LoxoneUdpDiscovery();

  constructor(
    private readonly config: LoxoneHttpConfig,
    private readonly options: LoxoneHttpServiceOptions,
  ) {
    this.processor = options.processor;
  }

  public async start(): Promise<void> {
    const tls = await loadOrGenerateSelfSignedTls();
    for (const definition of this.config.servers) {
      const runtime = this.createServer(definition, tls);
      await this.listen(runtime);
      this.servers.push(runtime);
    }

    this.udpDiscovery.start(this.config, this.options.configPort);

    this.log.info('loxone servers ready', {
      ports: this.config.servers.map((s) => s.port).join(', '),
      tls: tls ? 'enabled' : 'disabled',
      serial: this.currentSerial(),
    });
  }

  public async stop(): Promise<void> {
    this.udpDiscovery.stop();
    const runtimes = [...this.servers];
    this.servers.length = 0;
    // Drop live sessions BEFORE closing: the Loxone app holds a WebSocket open and
    // the Miniserver keeps HTTP sockets alive, so close() would wait for them, hit
    // the shutdown timeout, and leave the port bound — the next connect then fails
    // with EADDRINUSE on 7091/7095.
    await Promise.all(
      runtimes.map(async (runtime) => {
        runtime.wsServer.closeAllConnections();
        runtime.httpServer.closeAllConnections?.();
        for (const socket of runtime.sockets) {
          socket.destroy();
        }
        runtime.sockets.clear();
        await new Promise<void>((resolve) => runtime.listener.close(() => resolve()));
        runtime.httpServer.close();
      }),
    );
  }

  private createServer(
    definition: LoxoneServerOptions,
    tlsContext: TlsContext | null,
  ): ServerRuntime {
    const log = this.log;
    const requestListener = (req: IncomingMessage, res: ServerResponse): void => {
      this.handleHttp(definition, req, res).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        log.error('loxone http handler failed', {
          name: definition.name,
          message,
        });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'loxone-http-internal-error' }));
      });
    };

    // The project arrives as one base64 command. Node's 16 KB header limit and the
    // WebSocket library's 64 KB frame limit both cut it off on a real installation.
    const httpServer = http.createServer({ maxHeaderSize: LOXONE_MAX_COMMAND_BYTES }, requestListener);
    const httpsServer = tlsContext
      ? https.createServer(
          { cert: tlsContext.cert, key: tlsContext.key, maxHeaderSize: LOXONE_MAX_COMMAND_BYTES },
          requestListener,
        )
      : null;
    const listener = createDualProtocolServer(httpServer, httpsServer);

    const wsTargets: http.Server[] = httpsServer
      ? [httpServer, httpsServer as unknown as http.Server]
      : [httpServer];
    const wsServer = new WebSocketServer({
      httpServer: wsTargets,
      autoAcceptConnections: true,
      maxReceivedFrameSize: LOXONE_MAX_COMMAND_BYTES,
      maxReceivedMessageSize: LOXONE_MAX_COMMAND_BYTES,
    });

    wsServer.on('connect', (connection) =>
      this.handleWebSocket(definition, connection),
    );

    const sockets = new Set<net.Socket>();
    listener.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });

    return { definition, httpServer, listener, wsServer, tlsEnabled: !!httpsServer, sockets };
  }

  private listen(runtime: ServerRuntime): Promise<void> {
    const { name, port } = runtime.definition;
    return new Promise((resolve, reject) => {
      runtime.listener
        .listen(port, this.options.host, () => {
          this.log.info('loxone server listening', {
            name,
            port,
            tls: runtime.tlsEnabled ? 'dual' : 'plain',
          });
          loxonePairingMonitor.listener(name, port);
          resolve();
        })
        .on('error', (error) => {
          this.log.error('loxone server could not listen', {
            name,
            port,
            message: error instanceof Error ? error.message : String(error),
          });
          loxonePairingMonitor.listener(name, port, error);
          reject(error);
        });
    });
  }

  private currentSerial(): string {
    const stored = this.options.configPort.getSystemConfig()?.audioserver?.macId;
    return stored?.trim().toUpperCase() || this.config.macAddress;
  }

  private async handleHttp(
    definition: LoxoneServerOptions,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    this.log.debug('loxone http request received', {
      name: definition.name,
      method: req.method,
      url: req.url,
      remote: req.socket.remoteAddress,
    });

    const url = req.url ?? '/';
    if (req.method === 'OPTIONS') {
      this.sendOptions(res);
      return;
    }
    loxonePairingMonitor.command(definition.name, req.socket.remoteAddress ?? null, url);

    const body = await this.readBody(req);
    const response = await this.processor.execute(url, body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(response);

    this.log.debug('handled loxone http command', {
      name: definition.name,
      url: formatCommand(url),
    });
  }

  private handleWebSocket(
    definition: LoxoneServerOptions,
    connection: WebSocketConnection,
  ): void {
    const serial = this.currentSerial();
    connection.sendUTF(loxoneIdentification(this.config, definition.name, serial));
    this.options.connectionRegistry.registerConnection(connection);
    loxonePairingMonitor.connection(definition.name, connection.socket.remoteAddress ?? null);
    if (definition.name === 'msHttp') {
      this.log.info('miniserver connected', {
        remote: connection.socket.remoteAddress,
        serial,
      });
      this.options.serverHeartbeat.emit(this.options.configPort);
    }

    // A client sees nothing until something changes, and an idle zone never
    // changes — so send the current state of every zone on connect. It goes
    // through the same projection as the steady-state broadcast: spreading
    // ZoneState directly (as this once did) skipped the sync-group fields and the
    // audiopath/title/station guards, so a reconnect during grouped playback
    // showed ungrouped zones, and a raw service-native id could surface in a
    // field the native client renders verbatim.
    for (const state of this.options.zoneManager.getAllZoneStates()) {
      try {
        connection.sendUTF(
          JSON.stringify({ audio_event: [this.options.notifier.projectForLoxone(state)] }),
        );
      } catch {
        // connection will be cleaned up via the error/close event
        break;
      }
    }

    // Groups restored at boot were broadcast before this socket existed, and a
    // later per-zone audio_event does not carry the group list. Send it now.
    try {
      this.options.groupSync?.broadcastGroupState();
    } catch {
      // a missing zone manager must not drop the connection
    }

    connection.on('message', (message) =>
      this.handleWebSocketMessage(message, connection, definition),
    );

    connection.on('close', () => this.options.connectionRegistry.unregisterConnection(connection));
    connection.on('error', () => this.options.connectionRegistry.unregisterConnection(connection));
  }

  private async handleWebSocketMessage(
    message: Message,
    connection: WebSocketConnection,
    definition: LoxoneServerOptions,
  ): Promise<void> {
    if (message.type !== 'utf8') {
      if (loxonePairingMonitor.capturing) {
        loxonePairingMonitor.record(
          definition.name,
          connection.socket.remoteAddress ?? null,
          `binary frame, ${describePayload(message.binaryData)}`,
        );
      }
      return;
    }

    const command = message.utf8Data ?? '';
    loxonePairingMonitor.command(definition.name, connection.socket.remoteAddress ?? null, command);
    this.log.spam('loxone ws message received', {
      name: definition.name,
      command: formatCommand(command),
      remote: connection.socket.remoteAddress,
    });
    try {
      const response = await this.processor.execute(command);
      connection.sendUTF(response);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log.error('ws handler error', { name: definition.name, msg });
      connection.sendUTF('');
    }
  }

  private sendOptions(res: ServerResponse): void {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
  }

  private async readBody(req: IncomingMessage): Promise<Buffer | undefined> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }

    return chunks.length ? Buffer.concat(chunks) : undefined;
  }
}
