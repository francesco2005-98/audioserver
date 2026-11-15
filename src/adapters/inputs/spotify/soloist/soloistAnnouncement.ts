import Bonjour from 'bonjour-service';
import { createLogger } from '@/shared/logging/logger';
import { advertisableIpv4Addresses } from '@/shared/utils/net';

const log = createLogger('Input', 'SoloistAnnounce');

/** Soloist colours its log lines. The marker is built here so the pattern stays a plain string. */
function stripAnsi(line: string): string {
  const marker = `${String.fromCharCode(27)}[`;
  return line
    .split(marker)
    .map((part, index) => (index === 0 ? part : part.replace(/^[0-9;]*m/, '')))
    .join('');
}

export type ConnectSighting = {
  deviceName?: string;
  port?: number;
  /** Addresses Soloist said it would announce, IPv4 only. */
  addresses?: string[];
  mdnsFailed?: boolean;
};

type AdvertisedRecord = { type: string; data?: unknown };

/**
 * What Soloist just said about the Connect service it opened, if this line is about that.
 *
 * The lines are the ones it prints at startup. The address list is how it will answer a phone,
 * which is not always an address the phone can reach.
 */
export function noteSoloistLine(sighting: ConnectSighting, line: string): ConnectSighting {
  const plain = stripAnsi(line).trim();
  const next: ConnectSighting = { ...sighting };
  const name = /device_name=(.*) device_id=/.exec(plain);
  if (name?.[1]) {
    next.deviceName = name[1].trim();
  }
  const port = /Started ZeroConf service on port (\d+)/.exec(plain);
  if (port?.[1]) {
    next.port = Number(port[1]);
  }
  const lists = [...plain.matchAll(/IP \[([^\]]*)\]/g)];
  const last = lists.at(-1)?.[1];
  if (last !== undefined) {
    next.addresses = last
      .split(',')
      .map((part) => part.trim().split('%')[0] ?? '')
      .filter((part) => /^\d+\.\d+\.\d+\.\d+$/.test(part));
  }
  if (/Failed to initialize mdns/i.test(plain)) {
    next.mdnsFailed = true;
  }
  return next;
}

/**
 * True when this server should announce the device itself.
 *
 * Soloist announces every address it can see, and the Docker bridge is often first. A phone
 * then looks there and the device never appears. It also stays silent when it cannot bind the
 * discovery port. Either way the Zeroconf port is already open, so announcing that port on the
 * LAN address is enough for the Spotify app to find it.
 */
export function shouldRepublishConnect(sighting: ConnectSighting, lan: readonly string[]): boolean {
  if (!sighting.deviceName || !sighting.port || lan.length === 0) {
    return false;
  }
  if (sighting.mdnsFailed) {
    return true;
  }
  const addresses = sighting.addresses ?? [];
  if (addresses.length === 0) {
    return false;
  }
  return addresses.some((address) => !lan.includes(address));
}

let bonjour: Bonjour | null = null;

function shared(): Bonjour {
  bonjour ??= new Bonjour();
  return bonjour;
}

function restrictToLan(service: { records?: () => AdvertisedRecord[] }): void {
  const original = service.records;
  if (typeof original !== 'function') {
    return;
  }
  service.records = () => {
    const allowed = new Set(advertisableIpv4Addresses());
    if (!allowed.size) {
      return original.call(service);
    }
    return original.call(service).filter((record) => {
      return record.type !== 'A' || (typeof record.data === 'string' && allowed.has(record.data));
    });
  };
}

/** Announce one Soloist on the LAN address, and stop when that process is gone. */
export function publishSoloistConnect(name: string, port: number): { stop: () => void } {
  const service = shared().publish({
    name,
    type: 'spotify-connect',
    protocol: 'tcp',
    port,
    txt: { CPath: '/zc', VERSION: '1.0', Stack: 'SP' },
  });
  restrictToLan(service as { records?: () => AdvertisedRecord[] });
  service.start?.();
  log.info('announced spotify connect on the lan address', { name, port });
  return {
    stop: () => {
      try {
        service.stop?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.debug('spotify connect unpublish failed', { name, message });
      }
    },
  };
}
