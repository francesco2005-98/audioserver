import type { EnvironmentConfig } from '@/config/environment';
import { DEFAULT_MAC_ID } from '@/shared/utils/mac';

export type LoxoneServerName = 'appHttp' | 'msHttp';

export interface LoxoneHttpServerConfig {
  name: LoxoneServerName;
  port: number;
  identification: string;
}

export interface LoxoneMdnsConfig {
  name: string;
  type: string;
  host?: string;
  hostname: string;
  deviceType: string;
  version: string;
  txtVersion: string;
  deviceInstance: string;
  port: number;
}

export interface LoxoneHttpConfig {
  firmwareVersion: string;
  firmwareVersionNumber: string;
  apiVersion: string;
  sessionToken: string;
  macAddress: string;
  servers: LoxoneHttpServerConfig[];
  mdns: LoxoneMdnsConfig;
}

// Single source of truth for the emulated Audioserver version strings.
// FIRMWARE_VERSION_NUMBER is the LWSS / UDP discovery firmware string.
// MDNS_VERSION is the same release in the zero-padded Bonjour form.
const FIRMWARE_VERSION_NUMBER = '17.1.05.05';
const MDNS_VERSION = '17.01.05.05';

const DEFAULT_FIRMWARE_VERSION = `LWSS V ${FIRMWARE_VERSION_NUMBER}`;
const DEFAULT_API_VERSION = '~API:1.6~';
const DEFAULT_SESSION = '8WahwAfULwEQce9Yu0qIE9L7QMkXFHbi0M9ch9vKcgYArPPojXHpSiNcq0fT3lqL';
const DEFAULT_MDNS_NAME = 'audioserver';
const DEFAULT_MDNS_HOSTNAME = 'audioserver';
const DEFAULT_MDNS_TYPE = 'http';
const DEFAULT_MDNS_DEVICE_TYPE = 'Audioserver';
// Same generation the UDP announcement reports (tv / di), so Bonjour and the
// broadcast describe one device.
const DEFAULT_MDNS_TXT_VERSION = '3';
const DEFAULT_MDNS_DEVICE_INSTANCE = '1';

/**
 * Builds the configuration for the emulated Loxone HTTP servers.
 */
export function buildLoxoneHttpConfig(
  env: EnvironmentConfig,
  macAddress?: string,
): LoxoneHttpConfig {
  const firmwareVersion = DEFAULT_FIRMWARE_VERSION;
  const apiVersion = DEFAULT_API_VERSION;
  const sessionToken = DEFAULT_SESSION;
  const resolvedMacAddress = macAddress?.trim() || DEFAULT_MAC_ID;

  return {
    firmwareVersion,
    firmwareVersionNumber: FIRMWARE_VERSION_NUMBER,
    apiVersion,
    sessionToken,
    macAddress: resolvedMacAddress,
    servers: [
      {
        name: 'appHttp',
        port: env.loxoneAppPort,
        identification: formatIdentification(firmwareVersion, apiVersion, sessionToken),
      },
      {
        name: 'msHttp',
        port: env.loxoneMiniserverPort,
        identification: formatIdentification(firmwareVersion, apiVersion, sessionToken),
      },
    ],
    mdns: buildLoxoneMdnsConfig(env),
  };
}

function buildLoxoneMdnsConfig(env: EnvironmentConfig): LoxoneMdnsConfig {
  return {
    name: DEFAULT_MDNS_NAME,
    type: DEFAULT_MDNS_TYPE,
    host: env.hostname,
    hostname: DEFAULT_MDNS_HOSTNAME,
    deviceType: DEFAULT_MDNS_DEVICE_TYPE,
    version: MDNS_VERSION,
    txtVersion: DEFAULT_MDNS_TXT_VERSION,
    deviceInstance: DEFAULT_MDNS_DEVICE_INSTANCE,
    port: env.loxoneAppPort,
  };
}

function formatIdentification(firmware: string, api: string, session: string): string {
  // Both listeners are this Audioserver. The Miniserver port used to prefix
  // this with "MINISERVER V", which turned the greeting into
  // "MINISERVER V LWSS V …" and is not an identity the Miniserver accepts.
  return `${firmware} | ${api} | Session-Token: ${session}`;
}
