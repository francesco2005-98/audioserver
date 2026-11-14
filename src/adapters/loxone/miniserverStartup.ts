import { createLogger } from '@/shared/logging/logger';
import type { AudioServerConfig } from '@/domain/config/types';

const log = createLogger('Server');

/**
 * URL the Audioserver calls so the Miniserver reloads this device.
 * Uses the saved scheme, port and uuid. A missing piece means "not paired yet".
 */
export function miniserverStartupUrl(config: AudioServerConfig): string | null {
  const ip = config.system?.miniserver?.ip?.trim();
  const macId = config.system?.audioserver?.macId?.trim().toUpperCase();
  if (!ip || !macId) {
    return null;
  }
  const uuid =
    normalizeString(config.system?.audioserver?.uuid) ??
    normalizeString(findServerSection(config.rawAudioConfig?.raw, macId)?.uuid) ??
    normalizeString(findServerSection(config.rawAudioConfig?.rawString, macId)?.uuid);
  if (!uuid) {
    return null;
  }
  const protocol = config.system.miniserver.protocol === 'https' ? 'https' : 'http';
  const port = config.system.miniserver.port;
  const host = ip.includes(':') && !ip.startsWith('[') ? `[${ip}]` : ip;
  const defaultPort = protocol === 'https' ? 443 : 80;
  const withPort =
    typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65535 && port !== defaultPort
      ? `:${port}`
      : '';
  return `${protocol}://${host}${withPort}/dev/sps/devicestartup/${encodeURIComponent(uuid)}`;
}

export async function notifyMiniserverStartup(config: AudioServerConfig): Promise<void> {
  const url = miniserverStartupUrl(config);
  if (!url) {
    log.debug('miniserver startup ping skipped (missing ip, mac or uuid)');
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  timeout.unref?.();
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    if (!response.ok) {
      log.warn('miniserver startup ping failed', { status: response.status, url });
    } else {
      log.info('miniserver startup ping sent', { url });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('miniserver startup ping failed', { message, url });
  } finally {
    clearTimeout(timeout);
  }
}

function findServerSection(raw: unknown, macId: string): Record<string, unknown> | undefined {
  if (!raw || !macId) {
    return undefined;
  }
  const normalizedMacId = macId.trim().toUpperCase();
  let parsed = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return undefined;
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(parsed)) {
    return undefined;
  }
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const matchKey = Object.keys(entry).find((key) => key.trim().toUpperCase() === normalizedMacId);
    if (matchKey) {
      return (entry as Record<string, unknown>)[matchKey] as Record<string, unknown>;
    }
  }
  return undefined;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
