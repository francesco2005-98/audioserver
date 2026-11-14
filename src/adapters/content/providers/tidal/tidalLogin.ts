import { randomUUID } from 'node:crypto';

const DEVICE_URL = 'https://auth.tidal.com/v1/oauth2/device_authorization';
const TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';
const SESSIONS_URL = 'https://api.tidal.com/v1/sessions';
const SCOPE = 'r_usr w_usr w_sub';

export type TidalLoginResult = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  clientId: string;
  clientSecret: string;
  userId?: string;
  userName?: string;
  countryCode?: string;
};

export type TidalLoginStatus =
  | { state: 'pending' }
  | { state: 'done'; userId?: string; userName?: string; countryCode?: string }
  | { state: 'error'; error: string; message: string };

type Session = {
  id: string;
  deviceCode: string;
  clientId: string;
  clientSecret: string;
  intervalMs: number;
  expiresAt: number;
  nextPollAt: number;
  status: TidalLoginStatus;
  result?: TidalLoginResult;
};

const sessions = new Map<string, Session>();

export function describeTidalClient(): { envConfigured: boolean; source: 'env' | null } {
  const creds = envCredentials();
  return { envConfigured: Boolean(creds), source: creds ? 'env' : null };
}

export function resolveTidalClient(input?: {
  clientId?: string;
  clientSecret?: string;
}): { clientId: string; clientSecret: string } | null {
  const fromEnv = envCredentials();
  if (fromEnv) return fromEnv;
  const clientId = input?.clientId?.trim() ?? '';
  const clientSecret = input?.clientSecret?.trim() ?? '';
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function envCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.AUDIOSERVER_TIDAL_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.AUDIOSERVER_TIDAL_CLIENT_SECRET?.trim() ?? '';
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export async function startTidalDeviceLogin(input: {
  clientId: string;
  clientSecret: string;
}): Promise<
  | {
      ok: true;
      loginId: string;
      mode: 'device';
      userCode: string;
      verificationUri: string;
      verificationUriComplete: string;
      expiresIn: number;
      interval: number;
    }
  | { ok: false; message: string }
> {
  prune();
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    scope: SCOPE,
  });
  const response = await fetch(DEVICE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !payload) {
    const detail = typeof payload?.error_description === 'string' ? payload.error_description : '';
    return {
      ok: false,
      message: detail || 'Tidal refused this client. Check the client id and secret.',
    };
  }
  const deviceCode = typeof payload.deviceCode === 'string' ? payload.deviceCode : '';
  const userCode = typeof payload.userCode === 'string' ? payload.userCode : '';
  if (!deviceCode || !userCode) {
    return { ok: false, message: 'Tidal did not return a sign-in code.' };
  }
  const expiresIn = numberOr(payload.expiresIn, 300);
  const interval = numberOr(payload.interval, 2);
  const loginId = randomUUID();
  const now = Date.now();
  sessions.set(loginId, {
    id: loginId,
    deviceCode,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    intervalMs: Math.max(1, interval) * 1000,
    expiresAt: now + expiresIn * 1000,
    nextPollAt: 0,
    status: { state: 'pending' },
  });
  const verificationUri =
    typeof payload.verificationUri === 'string' && payload.verificationUri
      ? payload.verificationUri
      : 'https://link.tidal.com';
  const verificationUriComplete =
    typeof payload.verificationUriComplete === 'string' && payload.verificationUriComplete
      ? payload.verificationUriComplete
      : `${verificationUri.replace(/\/$/, '')}/${userCode}`;
  return {
    ok: true,
    loginId,
    mode: 'device',
    userCode,
    verificationUri,
    verificationUriComplete,
    expiresIn,
    interval,
  };
}

export async function readTidalLogin(loginId: string): Promise<TidalLoginStatus> {
  prune();
  const session = sessions.get(loginId);
  if (!session) {
    return { state: 'error', error: 'expired', message: 'This Tidal sign-in has expired. Start again.' };
  }
  if (session.status.state !== 'pending') {
    return session.status;
  }
  if (Date.now() > session.expiresAt) {
    session.status = { state: 'error', error: 'expired', message: 'The Tidal code expired. Start again.' };
    return session.status;
  }
  if (Date.now() < session.nextPollAt) {
    return { state: 'pending' };
  }
  session.nextPollAt = Date.now() + session.intervalMs;
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: session.clientId,
      client_secret: session.clientSecret,
      device_code: session.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      scope: SCOPE,
    }),
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const classified = classifyTidalPoll(response.status, payload);
  if (classified.kind === 'pending') {
    return { state: 'pending' };
  }
  if (classified.kind === 'slow') {
    session.nextPollAt = Date.now() + session.intervalMs * 2;
    return { state: 'pending' };
  }
  if (classified.kind === 'error') {
    session.status = { state: 'error', error: classified.error, message: classified.message };
    return session.status;
  }
  const profile = await loadTidalProfile(classified.accessToken, classified.user);
  const result: TidalLoginResult = {
    accessToken: classified.accessToken,
    refreshToken: classified.refreshToken,
    expiresAt: Date.now() + classified.expiresIn * 1000,
    clientId: session.clientId,
    clientSecret: session.clientSecret,
    ...profile,
  };
  session.result = result;
  session.status = {
    state: 'done',
    userId: result.userId,
    userName: result.userName,
    countryCode: result.countryCode,
  };
  return session.status;
}

/** Hands a finished sign-in to the service that is being saved, once. */
export function takeTidalLogin(loginId: string): TidalLoginResult | undefined {
  const session = sessions.get(loginId);
  if (!session?.result) return undefined;
  sessions.delete(loginId);
  return session.result;
}

export function discardTidalLogin(loginId: string): void {
  sessions.delete(loginId);
}

export async function refreshTidalAccessToken(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number } | null> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    }),
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !payload || typeof payload.access_token !== 'string') return null;
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined,
    expiresIn: numberOr(payload.expires_in, 3600),
  };
}

export function classifyTidalPoll(
  status: number,
  payload: Record<string, unknown> | null,
):
  | { kind: 'pending' }
  | { kind: 'slow' }
  | { kind: 'error'; error: string; message: string }
  | {
      kind: 'done';
      accessToken: string;
      refreshToken?: string;
      expiresIn: number;
      user: { userId?: string; userName?: string; countryCode?: string };
    } {
  if (status >= 200 && status < 300 && typeof payload?.access_token === 'string') {
    return {
      kind: 'done',
      accessToken: payload.access_token,
      refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined,
      expiresIn: numberOr(payload.expires_in, 3600),
      user: userFrom(payload.user),
    };
  }
  const error = typeof payload?.error === 'string' ? payload.error : '';
  if (error === 'authorization_pending') return { kind: 'pending' };
  if (error === 'slow_down') return { kind: 'slow' };
  if (error === 'expired_token' || error === 'expired') {
    return { kind: 'error', error: 'expired', message: 'The Tidal code expired. Start again.' };
  }
  if (error === 'access_denied') {
    return { kind: 'error', error: 'access_denied', message: 'Tidal sign-in was declined.' };
  }
  const description = typeof payload?.error_description === 'string' ? payload.error_description : '';
  return {
    kind: 'error',
    error: error || 'tidal-login-failed',
    message: description || 'Tidal did not accept this sign-in.',
  };
}

function userFrom(value: unknown): { userId?: string; userName?: string; countryCode?: string } {
  if (!value || typeof value !== 'object') return {};
  const user = value as Record<string, unknown>;
  const name = typeof user.username === 'string' ? user.username : typeof user.userName === 'string' ? user.userName : undefined;
  return {
    userId: user.userId != null ? String(user.userId) : undefined,
    userName: name,
    countryCode: typeof user.countryCode === 'string' ? user.countryCode : undefined,
  };
}

async function loadTidalProfile(
  accessToken: string,
  known: { userId?: string; userName?: string; countryCode?: string },
): Promise<{ userId?: string; userName?: string; countryCode?: string }> {
  if (known.userName && known.countryCode) return known;
  try {
    const response = await fetch(SESSIONS_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) return known;
    const body = (await response.json()) as Record<string, unknown>;
    return {
      userId: known.userId ?? (body.userId != null ? String(body.userId) : undefined),
      userName: known.userName,
      countryCode: known.countryCode ?? (typeof body.countryCode === 'string' ? body.countryCode : undefined),
    };
  } catch {
    return known;
  }
}

function prune(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    const keepUntil = session.status.state === 'done' ? session.expiresAt + 15 * 60_000 : session.expiresAt + 60_000;
    if (now > keepUntil) sessions.delete(id);
  }
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
