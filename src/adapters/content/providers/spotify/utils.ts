type ClientIdSource =
  | {
      clientId?: string | null;
    }
  | {
      client_id?: string | null;
    }
  | null
  | undefined;

/**
 * The Spotify application id configured for this server.
 *
 * There is no built-in application. Each install registers its own at the Spotify
 * developer dashboard and saves the client id here.
 */
export function resolveSpotifyClientId(source?: ClientIdSource): string {
  if (source) {
    const src = source as { clientId?: string | null; client_id?: string | null };
    const raw =
      typeof src.clientId === 'string'
        ? src.clientId
        : typeof src.client_id === 'string'
          ? src.client_id
          : undefined;

    if (raw && raw.trim()) {
      return raw.trim();
    }
  }

  return '';
}
