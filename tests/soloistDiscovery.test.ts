import assert from 'node:assert/strict';
import { test } from './testHarness';
import {
  noteSoloistLine,
  shouldRepublishConnect,
} from '../src/adapters/inputs/spotify/soloist/soloistAnnouncement';
import {
  pairingSeesVirtualNetworks,
  soloistMdnsLine,
} from '../src/adapters/inputs/spotify/soloist/soloistPairing';
import { ifaceFilterActive } from '../src/adapters/inputs/spotify/soloist/soloistProcess';
import { trackFinished } from '../src/adapters/inputs/spotify/soloist/soloistTrackRun';
import {
  allowConnectPort,
  connectPathFor,
  handleConnectProxy,
  matchesConnectProxy,
} from '../src/adapters/inputs/spotify/soloist/soloistConnectProxy';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

test('spotify connect: the gateway passes getInfo on to an announced soloist only', async () => {
  const soloist = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path: req.url, remoteName: 'Audioserver — Küche' }));
  });
  await new Promise<void>((resolve) => soloist.listen(0, '127.0.0.1', resolve));
  const localPort = (soloist.address() as AddressInfo).port;
  const gateway = http.createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0] ?? '/';
    if (matchesConnectProxy(pathname)) handleConnectProxy(req, res, pathname);
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const gatewayPort = (gateway.address() as AddressInfo).port;
  const get = (path: string): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: gatewayPort, path }, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        })
        .on('error', reject);
    });
  try {
    assert.equal((await get(`${connectPathFor(localPort)}?action=getInfo`)).status, 404);
    const unlock = allowConnectPort(localPort);
    const open = await get(`${connectPathFor(localPort)}?action=getInfo`);
    assert.equal(open.status, 200);
    assert.deepEqual(JSON.parse(open.body), { path: '/zc?action=getInfo', remoteName: 'Audioserver — Küche' });
    unlock();
    assert.equal((await get(`${connectPathFor(localPort)}?action=getInfo`)).status, 404);
  } finally {
    gateway.close();
    soloist.close();
  }
});

test('spotify discovery: only Soloist’s own mdns lines count', () => {
  assert.equal(soloistMdnsLine('mdns created successfully'), 'ready');
  assert.equal(soloistMdnsLine('Failed to initialize mdns'), 'blocked');
  assert.equal(soloistMdnsLine('ready, device_name=Kitchen'), null);
});

test('spotify discovery: virtual networks are a yes or a no', () => {
  assert.equal(typeof pairingSeesVirtualNetworks(), 'boolean');
  assert.equal(typeof ifaceFilterActive(), 'boolean');
});

test('spotify discovery: a docker address is announced again on the lan', () => {
  const seen = [
    'Reachability changed to ethernet (IP [172.17.0.1, 192.168.10.25], roaming false)',
    'ready, device_name=Audioserver — Küche device_id=abc',
    'Started ZeroConf service on port 43210 path /zc',
    'mdns created successfully',
  ].reduce(noteSoloistLine, {});
  assert.equal(seen.deviceName, 'Audioserver — Küche');
  assert.equal(seen.port, 43210);
  assert.equal(shouldRepublishConnect(seen, ['192.168.10.25']), true);
  assert.equal(shouldRepublishConnect(seen, []), false);
});

test('spotify discovery: a failed mdns init is announced from here', () => {
  const seen = [
    'ready, device_name=Wohnzimmer device_id=abc',
    'Started ZeroConf service on port 9 path /zc',
    'Failed to initialize mdns',
  ].reduce(noteSoloistLine, {});
  assert.equal(shouldRepublishConnect(seen, ['192.168.10.25']), true);
  assert.equal(shouldRepublishConnect(seen, []), false);
});

test('spotify playback: a pause in the middle is not the end of the track', () => {
  const uri = 'spotify:track:abc';
  assert.equal(trackFinished({ type: 'playback_state', status: 'paused', position: { position_ms: 10_000 }, item: { uri, decorations: { playback: { duration_ms: 180_000 } } } }, uri, true), false);
  assert.equal(trackFinished({ type: 'playback_state', status: 'paused', position: { position_ms: 179_000 }, item: { uri, decorations: { playback: { duration_ms: 180_000 } } } }, uri, true), true);
  assert.equal(trackFinished({ type: 'playback_state', status: 'stopped', item: { uri } }, uri, true), true);
  assert.equal(trackFinished({ type: 'playback_state', status: 'stopped', item: { uri } }, uri, false), false);
  assert.equal(trackFinished({ type: 'playback_state', item: { uri: 'spotify:track:other' } }, uri, true), true);
});
