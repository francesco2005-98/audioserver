/**
 * The server's wall-clock time zone.
 *
 * A container starts in UTC. The Miniserver says which zone the house is in
 * during pairing, and `TZ` can name one at start. Node picks up a change of
 * `process.env.TZ` at runtime, so applying one needs no restart.
 */
export function isValidTimezone(value: string | null | undefined): value is string {
  const zone = value?.trim();
  if (!zone) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Sets the process time zone when the value is a real IANA zone. Returns the zone in effect. */
export function applyTimezone(value: string | null | undefined): string {
  if (isValidTimezone(value)) {
    const zone = value.trim();
    if (process.env.TZ !== zone) {
      process.env.TZ = zone;
    }
  }
  return currentTimezone();
}

export function currentTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** `+01:00` for the given moment in the current zone. */
export function utcOffset(date: Date = new Date()): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** ISO 8601 in local time with its offset, e.g. `2026-11-15T09:10:00.123+01:00`. */
export function localIsoTimestamp(date: Date = new Date()): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${String(date.getMilliseconds()).padStart(3, '0')}${utcOffset(date)}`
  );
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
