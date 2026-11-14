import assert from 'node:assert/strict';
import { test } from './testHarness';
import { loadEnvironment } from '../src/config/environment';
import { buildLoxoneHttpConfig } from '../src/config/loxone';
import {
  buildLoxoneDiscoveryPayload,
  loxoneDiscoveryFields,
} from '../src/adapters/loxone/http/loxoneUdpDiscovery';
import { miniserverStartupUrl } from '../src/adapters/loxone/miniserverStartup';
import { createSecureHandlers } from '../src/adapters/loxone/commands/handlers/secureHandlers';
import { createConfigHandlers } from '../src/adapters/loxone/commands/handlers/configHandlers';
import { serializeResult } from '../src/adapters/loxone/commands/responses';
import { ServerHeartbeat } from '../src/adapters/loxone/ws/serverHeartbeat';
import type { ConfigPort } from '../src/ports/ConfigPort';
import type { ConnectionRegistry } from '../src/adapters/loxone/ws/connectionRegistry';
import type { AudioServerConfig } from '../src/domain/config/types';

const config = buildLoxoneHttpConfig(loadEnvironment(), '504F94FF1BB3');

test('both Loxone listeners greet as this Audioserver', () => {
  const [app, miniserver] = config.servers;
  assert.equal(app?.identification, miniserver?.identification);
  assert.match(miniserver?.identification ?? '', /^LWSS V 17\.1\.05\.05 \| ~API:1\.6~ \| Session-Token: /);
  assert.equal(miniserver?.identification.includes('MINISERVER V'), false);
  assert.equal(config.mdns.version, '17.01.05.05');
  assert.equal(config.mdns.txtVersion, '3');
  assert.equal(config.mdns.deviceInstance, '1');
});

test('the Loxone search answer follows the current name and a unique hostname', () => {
  const port = (name: string, mac = '504F94FF1BB3'): ConfigPort =>
    ({
      getSystemConfig: () => ({ audioserver: { name, macId: mac } }),
    }) as unknown as ConfigPort;
  const first = JSON.parse(buildLoxoneDiscoveryPayload(loxoneDiscoveryFields(config, port('Wohnzimmer'))));
  assert.equal(first.n, 'Wohnzimmer');
  assert.equal(first.hn, 'Wohnzimmer');
  assert.equal(first.s, '50:4F:94:FF:1B:B3');
  assert.equal(first.v, '17.1.05.05');
  assert.equal(first.p, '7091');
  assert.equal(first.di, '1');
  assert.equal(first.tv, '3');

  const unnamed = JSON.parse(
    buildLoxoneDiscoveryPayload(loxoneDiscoveryFields(config, port('Unconfigured', 'AABBCCDDEEFF'))),
  );
  assert.equal(unnamed.hn, 'audioserver-eeff');
});

test('the Miniserver startup ping uses the saved scheme, port and uuid', () => {
  const https = miniserverStartupUrl({
    system: {
      miniserver: { ip: '2001:db8::5', port: 8443, protocol: 'https', serial: 'ABC' },
      audioserver: { uuid: 'zone-1', macId: '504F94FF1BB3' },
    },
  } as AudioServerConfig);
  assert.equal(https, 'https://[2001:db8::5]:8443/dev/sps/devicestartup/zone-1');

  const plain = miniserverStartupUrl({
    system: {
      miniserver: { ip: '192.168.1.5', port: 80, protocol: 'http', serial: '' },
      audioserver: { uuid: '', macId: '504F94FF1BB3' },
    },
    rawAudioConfig: { raw: [{ '504F94FF1BB3': { uuid: 'from-raw' } }] },
  } as AudioServerConfig);
  assert.equal(plain, 'http://192.168.1.5/dev/sps/devicestartup/from-raw');
});

test('setconfig answers with setconfig_result and wakes the connection', async () => {
  let woke = 0;
  const handlers = createConfigHandlers(config, {
    notifier: {} as never,
    configService: {
      async setRawAudioConfig() {
        return 'abc';
      },
      getCurrentConfigInfo() {
        return { crc32: 'abc', extensions: [] };
      },
    } as never,
    configPort: {} as never,
    contentManager: {} as never,
    spotifyInputService: {} as never,
    onConfigured() {
      woke += 1;
    },
  });
  const body = Buffer.from('[]').toString('base64');
  const result = await handlers.setConfig(`audio/cfg/setconfig/${body}`);
  assert.ok(result);
  assert.equal(result.name, 'setconfig');
  assert.equal(woke, 1);
  const wire = JSON.parse(serializeResult(result)) as { setconfig_result: { crc32: string } };
  assert.equal(wire.setconfig_result.crc32, 'abc');
});

test('the secure handshake offers this server key and a session that has not expired', async () => {
  const unpaired = createSecureHandlers(
    { getSystemConfig: () => ({ miniserver: { serial: '' } }) } as ConfigPort,
    config.sessionToken,
  );
  const hello = await unpaired.hello('secure/hello/CLIENT-PUBLIC-KEY');
  const helloPayload = hello?.payload as { public_key: string; error: number };
  assert.equal(helloPayload.error, 0);
  assert.equal(helloPayload.public_key.includes('BEGIN'), true);
  assert.equal(helloPayload.public_key.includes('CLIENT-PUBLIC-KEY'), false);

  const pairing = await unpaired.infoPairing('secure/infopairing');
  assert.equal((pairing?.payload as { error: number }).error, -81);

  const paired = createSecureHandlers(
    { getSystemConfig: () => ({ miniserver: { serial: '504f94111111' } }) } as ConfigPort,
    config.sessionToken,
  );
  const known = await paired.infoPairing('secure/infopairing');
  const knownPayload = known?.payload as { error: number; master: string };
  assert.equal(knownPayload.error, 0);
  assert.equal(knownPayload.master, '504F94111111');

  const init = await paired.init('secure/init');
  const jwt = (init?.payload as { jwt: string }).jwt;
  const claims = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
    exp: number;
    session_token: string;
  };
  assert.ok(claims.exp > Math.floor(Date.now() / 1000) + 60 * 60 * 24);
  assert.equal(claims.session_token, config.sessionToken);
});

test('the hardware heartbeat stays quiet until paired and then repeats', async () => {
  const sent: string[] = [];
  const registry = {
    broadcastMessage(payload: string) {
      sent.push(payload);
    },
  } as unknown as ConnectionRegistry;
  let paired = false;
  const configPort = {
    getSystemConfig: () => ({
      audioserver: { paired, macId: '504F94FF1BB3', extensions: [] },
    }),
  } as unknown as ConfigPort;
  const heartbeat = new ServerHeartbeat(registry, 30);
  heartbeat.emit(configPort);
  assert.equal(sent.length, 0);
  paired = true;
  heartbeat.start(configPort);
  await new Promise((resolve) => setTimeout(resolve, 80));
  heartbeat.stop();
  assert.ok(sent.length >= 2);
  const event = JSON.parse(sent[0] ?? '{}') as { hw_event: Array<{ client_id: string }> };
  assert.equal(event.hw_event[0]?.client_id, '504F94FF1BB3#1');
});
