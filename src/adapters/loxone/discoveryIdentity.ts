/**
 * Name and MAC shared by the UDP search answer and the Bonjour record.
 * The hostname stays the configured Bonjour host, which is what the Miniserver looks up.
 */
export function loxoneAnnouncementName(
  configuredName: string | undefined,
  fallbackName: string,
): string {
  const trimmed = configuredName?.trim();
  if (trimmed && trimmed.toLowerCase() !== 'unconfigured') {
    return trimmed;
  }
  const fallback = fallbackName.trim();
  return fallback || 'audioserver';
}

export function loxoneAnnouncementHostname(configured: string): string {
  const sanitized = sanitizeHostname(configured);
  return sanitized || 'audioserver';
}

export function loxoneAnnouncementMac(raw: string | undefined, fallback: string): string {
  const source = (raw?.trim() || fallback || '').trim();
  const normalized = source.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (normalized.length !== 12) {
    return source || fallback;
  }
  return normalized.match(/.{2}/g)?.join(':') ?? source;
}

function sanitizeHostname(value: string): string {
  const trimmed = value.trim();
  const withoutLocal = trimmed.toLowerCase().endsWith('.local')
    ? trimmed.slice(0, -6)
    : trimmed;
  return withoutLocal.replace(/\s+/g, '-').replace(/\./g, '-');
}
