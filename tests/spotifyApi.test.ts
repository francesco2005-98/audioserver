import assert from 'node:assert/strict';
import { test } from './testHarness';
import {
  SpotifyAccountProvider,
  spotifyPublicUserId,
} from '../src/adapters/content/providers/spotify/spotifyAccountProvider';
import { parseSpotifyItemId } from '../src/adapters/content/providers/spotifyServiceManager';

test('a rejected Spotify token is refreshed and the call is retried', async () => {
  const originalFetch = global.fetch;
  const tokens: string[] = [];
  const bearers: string[] = [];
  global.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('accounts.spotify.com/api/token')) {
      const access = tokens.length === 0 ? 'fresh-token' : 'second-token';
      tokens.push(access);
      return new Response(JSON.stringify({ access_token: access, expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const auth = new Headers(init?.headers).get('authorization') ?? '';
    bearers.push(auth);
    if (bearers.length === 1) {
      return new Response('expired', { status: 401 });
    }
    return new Response(JSON.stringify({ id: 'track-1', name: 'After Refresh', duration_ms: 1000 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const provider = new SpotifyAccountProvider({
      providerId: 'spotify@ada',
      account: {
        id: 'account-stable',
        spotifyId: 'ada',
        user: 'ada',
        refreshToken: 'refresh-1',
        clientId: 'client-1',
      },
      persistAccount: async () => null,
    });
    (provider as unknown as { accessToken: string }).accessToken = 'stale-token';
    (provider as unknown as { tokenExpiresAt: number }).tokenExpiresAt = Date.now() + 60_000;

    const track = await provider.getTrack('track-1');
    assert.equal(track?.name, 'After Refresh');
    assert.deepEqual(bearers, ['Bearer stale-token', 'Bearer fresh-token']);
    assert.equal(tokens.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('followed artists continue on the next cursor page', async () => {
  const originalFetch = global.fetch;
  global.fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    const after = url.searchParams.get('after');
    if (after === 'a2') {
      return new Response(
        JSON.stringify({
          artists: {
            items: [{ id: 'a3', name: 'Third' }],
            total: 3,
            next: null,
            cursors: {},
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({
        artists: {
          items: [
            { id: 'a1', name: 'First' },
            { id: 'a2', name: 'Second' },
          ],
          total: 3,
          next: 'https://api.spotify.com/v1/me/following?after=a2',
          cursors: { after: 'a2' },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const provider = new SpotifyAccountProvider({
      providerId: 'spotify@ada',
      account: { id: 'ada', user: 'ada', refreshToken: 'refresh-1' },
      persistAccount: async () => null,
    });
    (provider as unknown as { accessToken: string }).accessToken = 'token';
    (provider as unknown as { tokenExpiresAt: number }).tokenExpiresAt = Date.now() + 60_000;

    const page = await provider.getFolder('artists', 2, 2);
    assert.deepEqual(
      (page?.items ?? []).map((item) => item.name),
      ['Third'],
    );
    assert.equal(page?.totalitems, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('follow checks use the public Spotify user id and accept a spotify uri', () => {
  assert.equal(spotifyPublicUserId({ id: 'account-stable', spotifyId: 'ada', user: 'ada' }), 'ada');
  assert.equal(spotifyPublicUserId({ id: 'legacy-name', user: 'legacy-name' }), 'legacy-name');
  assert.deepEqual(parseSpotifyItemId('spotify:playlist:37i9'), { type: 'playlist', id: '37i9' });
  assert.deepEqual(parseSpotifyItemId('spotify@ada:episode:ep1'), { type: 'show', id: 'ep1' });
  assert.equal(parseSpotifyItemId('applemusic:track:abc'), null);
});
