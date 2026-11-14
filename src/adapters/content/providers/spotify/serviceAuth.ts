import crypto from 'crypto';
import { createLogger } from '@/shared/logging/logger';
import { safeReadText } from '@/shared/bestEffort';
import type { AudioServerConfig, SpotifyAccountConfig } from '@/domain/config/types';
import type { ContentManager } from '@/adapters/content/contentManager';
import { consumePkceVerifier } from '@/adapters/content/providers/spotify/pkce';
import { resolveSpotifyClientId } from '@/adapters/content/providers/spotify/utils';
import { createPkcePair } from '@/adapters/content/providers/spotify/pkce';
import type { NotifierPort } from '@/ports/NotifierPort';
import type { SpotifyInputService } from '@/adapters/inputs/spotify/spotifyInputService';
import type { ConfigPort } from '@/ports/ConfigPort';
import { loadEnvironment } from '@/config/environment';
import { resolveCoverHost } from '@/shared/utils/net';

const log = createLogger('Content', 'SpotifyAuth');

interface BuildLinkParams {
  /** Origin the admin UI was opened on, including port (`http://host:7090`). */
  callbackOrigin: string;
}

/** Prefer the host the browser actually used. Fall back to the configured LAN address. */
export function spotifyCallbackOrigin(hostHeader: string | undefined, configuredIp?: string): string {
  const headerHost = hostHeader?.split(',')[0]?.trim();
  if (headerHost) {
    return `http://${headerHost}`;
  }
  const host = resolveCoverHost(configuredIp);
  return `http://${host}:${loadEnvironment().httpPort}`;
}

export function resolveSpotifyRedirectUri(cfg: AudioServerConfig, callbackOrigin: string): string {
  const fromEnv = process.env.SPOTIFY_REDIRECT_URI?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const fromCfg = cfg.content?.spotify?.redirectUri?.trim();
  if (fromCfg) {
    return fromCfg;
  }
  return `${callbackOrigin.replace(/\/$/, '')}/callbacks/spotify/`;
}

export function buildSpotifyAuthLink(params: BuildLinkParams, configPort: ConfigPort): string {
  const cfg = configPort.getConfig();
  const clientId = resolveSpotifyClientId(cfg.content?.spotify);
  if (!clientId) {
    throw new Error('spotify-client-id-required');
  }
  const redirectUri = resolveSpotifyRedirectUri(cfg, params.callbackOrigin);

  const stateKey = `content:spotify:${crypto.randomBytes(8).toString('hex')}`;
  const { codeChallenge } = createPkcePair(stateKey, redirectUri);

  const localCallbackUrl = `${params.callbackOrigin.replace(/\/$/, '')}/admin/api/spotify/auth/callback?state=${stateKey}`;

  // `streaming` and `app-remote-control` belong to the Web Playback SDK. Playback
  // here is Soloist, and requesting those scopes makes Spotify reject the login
  // for an application that does not have that quota.
  const scope = [
    'playlist-read-private',
    'playlist-read-collaborative',
    'playlist-modify-private',
    'playlist-modify-public',
    'user-library-read',
    'user-library-modify',
    'user-follow-read',
    'user-follow-modify',
    'user-read-email',
    'user-read-private',
    'user-read-currently-playing',
    'user-modify-playback-state',
    'user-read-playback-state',
  ].join(' ');

  const paramsStr = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    state: encodeURIComponent(localCallbackUrl),
    // Without this, Spotify silently reuses the browser's existing session and hands back a
    // code for the account that is already linked, so a second account can only be added from
    // a private window. The dialog is where the user picks or switches account.
    show_dialog: 'true',
  });

  const link = `https://accounts.spotify.com/authorize?${paramsStr.toString()}`;
  log.debug('Built Spotify auth link');
  return link;
}

/**
 * Handle the OAuth callback from Spotify (PKCE flow).
 *
 * - Exchanges the authorization code for a refresh token
 * - Fetches the /me profile to populate display information
 * - Persists/merges the account into cfg.content.spotify.accounts
 * - Triggers an in-memory reload of the content manager
 */
export async function handleSpotifyOAuthCallback(
  req: { url?: string },
  res: { writeHead: (code: number, headers: Record<string, string>) => void; end: (body?: string) => void },
  notifier: NotifierPort,
  configPort: ConfigPort,
  contentManager: ContentManager,
  spotifyInputService: SpotifyInputService,
): Promise<void> {
  const { searchParams } = new URL(req.url ?? '', 'http://localhost');
  let code = searchParams.get('code') ?? '';
  let state = searchParams.get('state') ?? '';
  const error = searchParams.get('error');

  if (error) {
    return renderError(res, 400, 'Spotify authentication failed', error);
  }

  ({ code, state } = extractCodeAndState(code, state));
  if (!code || !state) {
    return renderError(res, 400, 'Invalid Spotify callback');
  }

  const pkce = consumePkceVerifier(state);
  if (!pkce) {
    return renderError(res, 400, 'Spotify authentication session expired');
  }

  try {
    const cfg = configPort.getConfig();
    const clientId = resolveSpotifyClientId(cfg.content?.spotify);
    if (!clientId) {
      return renderError(res, 400, 'Spotify client id is not configured');
    }

    const tokens = await exchangeCodeForToken({
      code,
      clientId,
      redirectUri: pkce.redirectUri,
      codeVerifier: pkce.verifier,
    });

    const refreshToken = tokens.refresh_token?.trim();
    const accessToken = tokens.access_token?.trim();
    if (!refreshToken || !accessToken) {
      return renderError(res, 400, 'Spotify did not return a refresh token');
    }

    const profile = await loadSpotifyProfile(accessToken);
    const accountId = profile.account_id?.trim() || profile.id?.trim();
    if (!accountId) {
      return renderError(res, 400, 'Spotify profile has no account id');
    }
    // Soloist directories are named after the Spotify user id (`id`), not the
    // stable account_id and not the display name. The display name is only a label:
    // it can contain "/" and it can change, which broke delete and pairing.
    const spotifyId = profile.id?.trim() || accountId;
    const displayName = profile.display_name?.trim() || profile.email?.trim() || spotifyId;

    await persistAccount(configPort, {
      id: accountId,
      spotifyId,
      user: spotifyId,
      email: profile.email,
      country: profile.country,
      clientId,
      product: profile.product,
      displayName,
      name: displayName,
      refreshToken,
    });

    // Nothing to mint here any more. Signing in is a separate, deliberate step: the account's
    // Soloist store is signed in once from a Spotify app, which is the only login Spotify still
    // accepts and the only thing a playback run restores from.

    // Make the new account immediately available without restart
    contentManager.refreshFromConfig();
    notifier.notifyReloadMusicApp('useradd', 'spotify', accountId);
    reinitializeSpotifyInputs(configPort, spotifyInputService, 'account_created', accountId);

    return renderSuccess(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return renderError(res, 500, 'Spotify authentication error', message);
  }
}

export async function deleteSpotifyAccount(
  configPort: ConfigPort,
  userId: string,
  notifier: NotifierPort,
  contentManager: ContentManager,
  spotifyInputService: SpotifyInputService,
): Promise<void> {
  if (!userId) {
    return;
  }

  await configPort.updateConfig((cfg) => {
    const accounts = cfg.content.spotify.accounts || [];
    const next: SpotifyAccountConfig[] = accounts.filter(
      (acc) =>
        !(
          acc &&
          ((acc.id && acc.id === userId) ||
            (acc.user && acc.user === userId) ||
            (acc.email && acc.email === userId))
        ),
    );

    if (next.length !== accounts.length) {
      cfg.content.spotify.accounts = next;
      log.info('Removed Spotify account from config', { userId });
    }
  });

  // Refresh runtime providers and notify clients
  contentManager.refreshFromConfig();
  notifier.notifyReloadMusicApp('userdel', 'spotify', userId);
  reinitializeSpotifyInputs(configPort, spotifyInputService, 'account_deleted', userId);
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
};

async function exchangeCodeForToken(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.codeVerifier,
  });

  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!resp.ok) {
    const detail = await safeReadText(resp, '', {
      onError: 'debug',
      log,
      label: 'spotify token response read failed',
      context: { status: resp.status },
    });
    throw new Error(`Spotify token exchange failed: ${detail.slice(0, 400)}`);
  }

  return (await resp.json()) as TokenResponse;
}

type SpotifyProfile = {
  id?: string;
  account_id?: string;
  display_name?: string;
  email?: string;
  product?: string;
  country?: string;
};

async function loadSpotifyProfile(accessToken: string): Promise<SpotifyProfile> {
  const resp = await fetch('https://api.spotify.com/v1/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  const detail = await safeReadText(resp, '', {
    onError: 'debug',
    log,
    label: 'spotify profile response read failed',
    context: { status: resp.status },
  });
  if (!resp.ok) {
    throw new Error(`Spotify profile request failed (${resp.status}): ${detail.slice(0, 200)}`);
  }
  try {
    return JSON.parse(detail) as SpotifyProfile;
  } catch {
    throw new Error('Spotify profile response was not JSON');
  }
}

async function persistAccount(configPort: ConfigPort, account: SpotifyAccountConfig): Promise<void> {
  await configPort.updateConfig((cfg) => {
    const accounts = cfg.content.spotify.accounts ?? [];
    const idx = accounts.findIndex(
      (acc) =>
        (acc.id && account.id && acc.id === account.id) ||
        (acc.spotifyId && account.spotifyId && acc.spotifyId === account.spotifyId) ||
        (acc.email && account.email && acc.email === account.email) ||
        (acc.user && account.user && acc.user === account.user),
    );

    if (idx >= 0) {
      accounts[idx] = { ...accounts[idx], ...account };
    } else {
      accounts.push(account);
    }

    cfg.content.spotify.accounts = accounts;
  });
}

function reinitializeSpotifyInputs(
  configPort: ConfigPort,
  spotifyInputService: SpotifyInputService,
  reason: string,
  accountId?: string,
): void {
  try {
    const cfg = configPort.getConfig();
    const zones = cfg.zones ?? [];
    const spotifyCfg = cfg.inputs?.spotify ?? null;
    // Nothing per-account to hand out: Soloist keeps each account's session in its own store,
    // signed in once from the Spotify app rather than pushed to anything from here.
    spotifyInputService.syncZones(zones, spotifyCfg);
    log.info('spotify inputs reinitialized', { reason, accountId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('spotify inputs reinit failed', { reason, accountId, message });
  }
}

function extractCodeAndState(code: string, state: string): { code: string; state: string } {
  let normalizedCode = code?.trim() ?? '';
  let normalizedState = state?.trim() ?? '';

  // Some redirect flows append ?code=... directly onto state
  const stateQueryIdx = normalizedState.indexOf('?code=');
  if (stateQueryIdx >= 0) {
    const embedded = normalizedState.slice(stateQueryIdx + '?code='.length);
    const [codeFromState] = embedded.split('&');
    if (!normalizedCode && codeFromState) {
      normalizedCode = decodeURIComponent(codeFromState);
    }
    normalizedState = normalizedState.slice(0, stateQueryIdx);
  }

  // state may contain the local callback URL; peel off nested params if present
  try {
    const decoded = decodeURIComponent(normalizedState);
    if (decoded.startsWith('http')) {
      const nested = new URL(decoded);
      normalizedState = nested.searchParams.get('state') ?? normalizedState;
      if (!normalizedCode) {
        normalizedCode = nested.searchParams.get('code') ?? normalizedCode;
      }
    }
  } catch {
    /* ignore */
  }

  return { code: normalizedCode, state: normalizedState };
}

function renderError(
  res: { writeHead: (code: number, headers: Record<string, string>) => void; end: (body?: string) => void },
  status: number,
  title: string,
  detail = '',
) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<h1>${escapeHtml(title)}</h1><pre>${escapeHtml(detail)}</pre>`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSuccess(res: { writeHead: (code: number, headers: Record<string, string>) => void; end: (body?: string) => void }) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Spotify Account Linked</title>
</head>
<body style="background:#000;color:#fff;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;">
  <div style="text-align:center;">
    <p>Spotify account linked. You can close this window.</p>
  </div>
  <script>
    window.open('', '_self'); window.close();
    setTimeout(() => { document.querySelector('p').textContent = 'You can close this window.'; }, 300);
  </script>
</body>
</html>`,
  );
}
