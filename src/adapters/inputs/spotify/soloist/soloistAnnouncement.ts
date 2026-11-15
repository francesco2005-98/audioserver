import { createLogger } from '@/shared/logging/logger';
import { advertisableIpv4Addresses } from '@/shared/utils/net';
import dgram from 'node:dgram';
import { decode, encode, type Record as DnsRecord } from 'dns-packet';

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
 * Soloist puts every address it can see into its own record, Docker bridges included, and a
 * phone that tries one of those never lists the device. The Zeroconf port is already open, so
 * a record that names only the LAN address is what the Spotify app can use.
 */
export function shouldRepublishConnect(sighting: ConnectSighting, lan: readonly string[]): boolean {
  return Boolean(sighting.deviceName && sighting.port && lan.length > 0);
}

const MULTICAST = '224.0.0.251';
const MDNS_PORT = 5353;
const SERVICE = '_spotify-connect._tcp.local';

type Live = { name: string; port: number; fqdn: string; host: string };

const live = new Map<string, Live>();
let socket: dgram.Socket | null = null;
let pulse: ReturnType<typeof setInterval> | null = null;

function instanceName(name: string): string {
  const cleaned = name.replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || 'Audioserver').slice(0, 63);
}

function recordsFor(entry: Live, addresses: readonly string[]): DnsRecord[] {
  const records: DnsRecord[] = [
    { name: SERVICE, type: 'PTR', ttl: 120, data: entry.fqdn },
    {
      name: entry.fqdn,
      type: 'SRV',
      ttl: 120,
      data: { priority: 0, weight: 0, port: entry.port, target: entry.host },
    },
    {
      name: entry.fqdn,
      type: 'TXT',
      ttl: 120,
      data: [Buffer.from('CPath=/zc'), Buffer.from('VERSION=1.0'), Buffer.from('Stack=SP')],
    },
  ];
  for (const address of addresses) {
    records.push({ name: entry.host, type: 'A', ttl: 120, data: address });
  }
  return records;
}

function announcement(): Buffer | null {
  const addresses = advertisableIpv4Addresses();
  const answers = [...live.values()].flatMap((entry) => recordsFor(entry, addresses));
  if (answers.length === 0) {
    return null;
  }
  return encode({ type: 'response', answers });
}

function sendOnLan(message: Buffer, toAddress: string, toPort: number): void {
  if (!socket) {
    return;
  }
  for (const address of advertisableIpv4Addresses()) {
    try {
      socket.setMulticastInterface(address);
    } catch {
      // This interface cannot send multicast. The others still can.
    }
    try {
      socket.send(message, toPort, toAddress);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log.debug('spotify connect announce failed', { address, detail });
    }
  }
}

function announce(): void {
  const message = announcement();
  if (!message) {
    return;
  }
  sendOnLan(message, MULTICAST, MDNS_PORT);
}

function wantsOurService(name: string | undefined): boolean {
  if (!name) {
    return false;
  }
  const plain = name.replace(/\.$/, '').toLowerCase();
  if (plain === SERVICE || plain === '_services._dns-sd._udp.local') {
    return true;
  }
  for (const entry of live.values()) {
    if (plain === entry.fqdn.toLowerCase() || plain === entry.host.toLowerCase()) {
      return true;
    }
  }
  return false;
}

function onQuery(message: Buffer, rinfo: dgram.RemoteInfo): void {
  let decoded: ReturnType<typeof decode>;
  try {
    decoded = decode(message);
  } catch {
    return;
  }
  if (decoded.type === 'response') {
    return;
  }
  const asked = (decoded.questions ?? []).some((question) => wantsOurService(question.name));
  if (!asked) {
    return;
  }
  const reply = announcement();
  if (!reply || !socket) {
    return;
  }
  // The phone asks for a direct answer. A multicast reply is easy to miss on wifi.
  try {
    socket.send(reply, rinfo.port, rinfo.address);
  } catch {
    // The multicast copy below is the other way the phone can hear it.
  }
  sendOnLan(reply, MULTICAST, MDNS_PORT);
}

function ensureSocket(): void {
  if (socket || live.size === 0) {
    return;
  }
  const opened = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  opened.on('error', (error) => {
    log.warn('spotify connect announce socket failed', { message: error.message });
  });
  opened.on('message', onQuery);
  opened.bind(MDNS_PORT, () => {
    for (const address of advertisableIpv4Addresses()) {
      try {
        opened.addMembership(MULTICAST, address);
      } catch {
        // Membership on one interface is enough when the others refuse it.
      }
    }
    try {
      opened.setMulticastTTL(255);
      opened.setMulticastLoopback(true);
    } catch {
      // TTL is a preference. The send still goes out.
    }
    announce();
  });
  socket = opened;
  pulse = setInterval(announce, 4_000);
  pulse.unref?.();
}

function closeSocket(): void {
  if (pulse) {
    clearInterval(pulse);
    pulse = null;
  }
  const opened = socket;
  socket = null;
  if (!opened) {
    return;
  }
  try {
    opened.close();
  } catch {
    // Already closed by the error that brought us here.
  }
}

/** Announce one Soloist on the LAN address, and stop when that process is gone. */
export function publishSoloistConnect(name: string, port: number): { stop: () => void } {
  const addresses = advertisableIpv4Addresses();
  const key = `${name}\n${port}`;
  const host = `audioserver-${port}.local`;
  live.set(key, { name, port, fqdn: `${instanceName(name)}.${SERVICE}`, host });
  log.info('announced spotify connect on the lan address', { name, port, addresses });
  ensureSocket();
  announce();
  return {
    stop: () => {
      live.delete(key);
      if (live.size === 0) {
        closeSocket();
      }
    },
  };
}
