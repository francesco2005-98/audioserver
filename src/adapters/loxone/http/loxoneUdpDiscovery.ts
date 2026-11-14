import dgram from 'node:dgram';
import type { LoxoneHttpConfig } from '@/config/loxone';
import { createLogger } from '@/shared/logging/logger';
import type { ConfigPort } from '@/ports/ConfigPort';
import {
  loxoneAnnouncementHostname,
  loxoneAnnouncementMac,
  loxoneAnnouncementName,
} from '@/adapters/loxone/discoveryIdentity';

const DEFAULT_PORT = 7070;

export interface LoxoneDiscoveryFields {
  name: string;
  mac: string;
  firmware: string;
  port: number;
  hostname: string;
}

/**
 * The JSON body a Loxone search gets back. Built from the current config so a
 * rename or a MAC learned after startup is visible on the next probe.
 */
export function buildLoxoneDiscoveryPayload(fields: LoxoneDiscoveryFields): string {
  return JSON.stringify({
    t: 'Audioserver',
    tv: '3',
    n: fields.name,
    s: fields.mac,
    v: fields.firmware,
    p: String(fields.port),
    hn: fields.hostname,
    di: '1',
  });
}

export function loxoneDiscoveryFields(
  config: LoxoneHttpConfig,
  configPort: ConfigPort,
): LoxoneDiscoveryFields {
  const systemConfig = configPort.getSystemConfig();
  const name = loxoneAnnouncementName(
    systemConfig?.audioserver?.name,
    config.mdns.name || 'audioserver',
  );
  const mac = loxoneAnnouncementMac(
    systemConfig?.audioserver?.macId,
    config.macAddress,
  );
  const port = resolveDiscoveryPort(config);
  return {
    name,
    mac,
    firmware: config.firmwareVersionNumber,
    port,
    hostname: loxoneAnnouncementHostname(name, mac),
  };
}

function resolveDiscoveryPort(config: LoxoneHttpConfig): number {
  const appServer = config.servers.find((server) => server.name === 'appHttp');
  return appServer?.port ?? config.mdns.port;
}

export class LoxoneUdpDiscovery {
  private readonly log = createLogger('Loxone', 'UDPDiscovery');
  private socket: dgram.Socket | null = null;
  private responder: dgram.Socket | null = null;
  private config: LoxoneHttpConfig | null = null;
  private configPort: ConfigPort | null = null;

  public start(config: LoxoneHttpConfig, configPort: ConfigPort, port: number = DEFAULT_PORT): void {
    if (this.socket) {
      return;
    }

    this.config = config;
    this.configPort = configPort;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const responder = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;
    this.responder = responder;

    socket.on('error', (error) => this.fail('listener', error));
    responder.on('error', (error) => this.fail('responder', error));

    socket.on('message', (_msg, rinfo) => {
      const payload = Buffer.from(this.currentPayload(), 'utf8');
      this.log.info('udp discovery probe received', {
        from: `${rinfo.address}:${rinfo.port}`,
      });
      responder.send(payload, rinfo.port, rinfo.address, (err) => {
        if (err) {
          this.log.warn('udp discovery response failed', {
            message: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        this.log.info('udp discovery response sent', {
          to: `${rinfo.address}:${rinfo.port}`,
          length: payload.length,
        });
      });
    });

    const responsePort = resolveDiscoveryPort(config);
    responder.bind(responsePort, () => {
      this.log.info('udp discovery responder ready', { port: responsePort });
    });
    socket.bind(port, () => {
      this.log.info('udp discovery listener started', { port });
    });
  }

  public stop(): void {
    const socket = this.socket;
    const responder = this.responder;
    this.socket = null;
    this.responder = null;
    this.config = null;
    this.configPort = null;
    socket?.close(() => {
      this.log.info('udp discovery listener stopped');
    });
    responder?.close(() => {
      this.log.info('udp discovery responder stopped');
    });
  }

  private currentPayload(): string {
    if (!this.config || !this.configPort) {
      return buildLoxoneDiscoveryPayload({
        name: 'audioserver',
        mac: '',
        firmware: '',
        port: 0,
        hostname: 'audioserver',
      });
    }
    return buildLoxoneDiscoveryPayload(loxoneDiscoveryFields(this.config, this.configPort));
  }

  /**
   * A missing error listener crashes the process. Drop both sockets so the next
   * start() can bind again instead of treating a dead socket as "already up".
   */
  private fail(role: 'listener' | 'responder', error: Error): void {
    const socket = this.socket;
    const responder = this.responder;
    if (!socket && !responder) {
      return;
    }
    this.log.warn('udp discovery socket failed', { role, message: error.message });
    this.socket = null;
    this.responder = null;
    socket?.close();
    if (responder && responder !== socket) {
      responder.close();
    }
  }
}
