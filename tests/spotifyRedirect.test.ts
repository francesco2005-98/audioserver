import assert from 'node:assert/strict';
import { test } from './testHarness';
import {
  loadSpotifyProfile,
  resolveSpotifyRedirectUri,
  spotifyRedirectOrigin,
} from '../src/adapters/content/providers/spotify/serviceAuth';
import type { AudioServerConfig } from '../src/domain/config/types';

test('spotify redirect: a LAN address over http goes to https on the same port', () => {
  assert.equal(spotifyRedirectOrigin('http://192.168.2.44:7090'), 'https://192.168.2.44:7090');
  assert.equal(spotifyRedirectOrigin('http://audioserver.fritz.box:7090'), 'https://audioserver.fritz.box:7090');
  assert.equal(spotifyRedirectOrigin('http://192.168.2.44'), 'https://192.168.2.44:80');
});

test('spotify redirect: loopback stays http, localhost becomes 127.0.0.1', () => {
  assert.equal(spotifyRedirectOrigin('http://127.0.0.1:7090'), 'http://127.0.0.1:7090');
  assert.equal(spotifyRedirectOrigin('http://[::1]:7090'), 'http://[::1]:7090');
  assert.equal(spotifyRedirectOrigin('http://localhost:7090'), 'http://127.0.0.1:7090');
});

test('spotify profile: a 502 from Spotify is tried again and then accepted', async () => {
  const bodies = [
    '{"error":{"status":502,"message":"An unexpected error occurred. Please try again later."}}',
    '{"id":"user-1","display_name":"Luca","email":"luca@example.com"}',
  ];
  const fetchImpl: typeof fetch = async () => {
    const body = bodies.shift() ?? '';
    return new Response(body, {
      status: body.includes('"error"') ? 502 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const profile = await loadSpotifyProfile('token', fetchImpl);
  assert.equal(profile.id, 'user-1');
  assert.equal(profile.display_name, 'Luca');
});

test('spotify redirect: https and an explicit redirect are kept as they are', () => {
  assert.equal(spotifyRedirectOrigin('https://music.example.com'), 'https://music.example.com');
  const cfg = { content: { spotify: { redirectUri: 'https://music.example.com/callbacks/spotify/' } } };
  assert.equal(
    resolveSpotifyRedirectUri(cfg as AudioServerConfig, 'http://192.168.2.44:7090'),
    'https://music.example.com/callbacks/spotify/',
  );
  assert.equal(
    resolveSpotifyRedirectUri({ content: {} } as AudioServerConfig, 'http://192.168.2.44:7090'),
    'https://192.168.2.44:7090/callbacks/spotify/',
  );
});
