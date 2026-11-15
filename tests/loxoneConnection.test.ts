import assert from 'node:assert/strict';
import { test } from './testHarness';
import { loadEnvironment } from '../src/config/environment';
import { buildLoxoneHttpConfig, loxoneIdentification } from '../src/config/loxone';
import {
  LoxoneConfigService,
  nextExtensionSerial,
  onExtensionsChanged,
} from '../src/adapters/loxone/services/loxoneConfigService';
import { loxonePairingMonitor } from '../src/adapters/loxone/pairingMonitor';
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

test('the Miniserver port greets as a Miniserver and Bonjour keeps its own version', () => {
  const [app, miniserver] = config.servers;
  assert.match(app?.identification ?? '', /^LWSS V 17\.1\.05\.05 \| ~API:1\.6~ \| Session-Token: /);
  assert.match(
    miniserver?.identification ?? '',
    /^MINISERVER V LWSS V 17\.1\.05\.05 504F94FF1BB3 \| ~API:1\.6~ \| Session-Token: /,
  );
  assert.equal(config.mdns.version, '16.00.09.16');
  assert.equal(config.mdns.txtVersion, '2');
  assert.equal(config.mdns.deviceInstance, '2');
});

test('the Loxone search answer follows the current name and serial', () => {
  const port = (name: string, mac = '504F94FF1BB3'): ConfigPort =>
    ({
      getSystemConfig: () => ({ audioserver: { name, macId: mac } }),
    }) as unknown as ConfigPort;
  const first = JSON.parse(buildLoxoneDiscoveryPayload(loxoneDiscoveryFields(config, port('Wohnzimmer'))));
  assert.equal(first.n, 'Wohnzimmer');
  assert.equal(first.hn, 'audioserver');
  assert.equal(first.s, '50:4F:94:FF:1B:B3');
  assert.equal(first.v, '17.1.05.05');
  assert.equal(first.p, '7091');
  assert.equal(first.di, '1');
  assert.equal(first.tv, '3');

  const unnamed = JSON.parse(
    buildLoxoneDiscoveryPayload(loxoneDiscoveryFields(config, port('Unconfigured', 'AABBCCDDEEFF'))),
  );
  assert.equal(unnamed.hn, 'audioserver');
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

test('setconfig answers under the segment the Miniserver sent and wakes the connection', async () => {
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
  assert.equal(result.name, body);
  assert.equal(woke, 1);
  const wire = JSON.parse(serializeResult(result)) as Record<string, { crc32: string }>;
  assert.equal(wire[`${body}_result`]?.crc32, 'abc');
});

test('setconfig keeps a base64 body that contains slashes', async () => {
  let stored: unknown = null;
  const handlers = createConfigHandlers(config, {
    notifier: {} as never,
    configService: {
      async setRawAudioConfig(payload: { raw: unknown }) {
        stored = payload.raw;
        return 'abc';
      },
      getCurrentConfigInfo() {
        return { crc32: 'abc', extensions: [] };
      },
    } as never,
    configPort: {} as never,
    contentManager: {} as never,
    spotifyInputService: {} as never,
  });
  // '???' encodes to 'Pz8/', so the body carries a '/' the way real projects do.
  const project = [{ '504F94FF1BB3': { name: '???', players: [] } }];
  const body = Buffer.from(JSON.stringify(project)).toString('base64');
  assert.ok(body.includes('/'));
  await handlers.setConfig(`audio/cfg/setconfig/${body}`);
  assert.deepEqual(stored, project);
});

test('the pairing monitor names the step the Miniserver reached', () => {
  loxonePairingMonitor.reset();
  loxonePairingMonitor.started();
  loxonePairingMonitor.connection('msHttp', '192.168.1.10');
  loxonePairingMonitor.command('msHttp', '192.168.1.10', 'secure/hello/KEY');
  loxonePairingMonitor.command('appHttp', '192.168.1.20', 'audio/7/recent');
  loxonePairingMonitor.getConfig(null);
  const snapshot = loxonePairingMonitor.snapshot();
  assert.equal(snapshot.running, true);
  assert.equal(snapshot.lastConnection?.remote, '192.168.1.10');
  assert.equal(snapshot.lastGetConfig?.crc32, null);
  assert.deepEqual(
    snapshot.steps.map((step) => step.command),
    ['secure/hello/[1 segment(s), 3 chars]'],
    'app traffic does not crowd out the pairing steps',
  );
  loxonePairingMonitor.reset();
});

test('the secure handshake echoes the client key and stays ready to pair', async () => {
  const handlers = createSecureHandlers(
    { getSystemConfig: () => ({ miniserver: { serial: '504f94111111' } }) } as ConfigPort,
  );
  const hello = await handlers.hello('secure/hello/MINISERVER-ID/PUBLIC%2BKEY');
  const helloPayload = hello?.payload as { public_key: string; error: number };
  assert.equal(helloPayload.error, 0);
  assert.equal(helloPayload.public_key, 'PUBLIC%2BKEY');

  const pairing = await handlers.infoPairing('secure/infopairing');
  const pairingPayload = pairing?.payload as { error: number; master: string };
  assert.equal(pairingPayload.error, -81);
  assert.equal(pairingPayload.master, '504F94111111');

  const init = await handlers.init('secure/init');
  const jwt = (init?.payload as { jwt: string }).jwt;
  const claims = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64').toString('utf8')) as {
    session_token: string;
  };
  assert.equal(claims.session_token, config.sessionToken);
});

test('the hardware heartbeat stays quiet until paired', () => {
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
  const heartbeat = new ServerHeartbeat(registry);
  heartbeat.emit(configPort);
  assert.equal(sent.length, 0);
  paired = true;
  heartbeat.emit(configPort);
  assert.equal(sent.length, 1);
  const event = JSON.parse(sent[0] ?? '{}') as { hw_event: Array<{ client_id: string }> };
  assert.equal(event.hw_event[0]?.client_id, '504F94FF1BB3#1');
});

test('the Miniserver greeting carries the serial the server holds now', () => {
  assert.match(
    loxoneIdentification(config, 'msHttp', 'bc241107fd5b'),
    /^MINISERVER V LWSS V 17\.1\.05\.05 BC241107FD5B \| /,
  );
  assert.match(loxoneIdentification(config, 'msHttp', ''), / 504F94FF1BB3 \| /);
  assert.match(loxoneIdentification(config, 'appHttp', 'BC241107FD5B'), /^LWSS V 17\.1\.05\.05 \| /);
});

function fakeConfigStore(initial: AudioServerConfig): ConfigPort {
  const state = initial;
  return {
    getConfig: () => state,
    getSystemConfig: () => state.system,
    async updateConfig(mutator: (cfg: AudioServerConfig) => void | Promise<void>) {
      await mutator(state);
    },
  } as unknown as ConfigPort;
}

function pairingConfig(macId: string): AudioServerConfig {
  return {
    system: {
      miniserver: { ip: '', serial: '', port: 80, protocol: 'http' },
      audioserver: { macId, name: 'Unconfigured', uuid: '', paired: false, extensions: [] },
    },
    rawAudioConfig: { raw: null, rawString: '', crc32: null },
    zones: [],
    inputs: {},
    groups: { mixedGroupEnabled: false, powerGroups: [], audioGroups: [] },
  } as unknown as AudioServerConfig;
}

const zonesStub = { replaceAll: async () => undefined } as never;
const contentStub = { refreshFromConfig: () => undefined } as never;

test('a pushed project for the stored serial pairs the server', async () => {
  const store = fakeConfigStore(pairingConfig('504F94FF1BB3'));
  const service = new LoxoneConfigService(zonesStub, store, contentStub, {} as never);
  const project = [{ '504F94FF1BB3': { name: 'Wohnzimmer', uuid: 'uuid-1', players: [] } }];
  await service.setRawAudioConfig({ raw: project, rawString: JSON.stringify(project) });
  const system = store.getSystemConfig();
  assert.equal(system.audioserver.paired, true);
  assert.equal(system.audioserver.name, 'Wohnzimmer');
  assert.equal(system.audioserver.uuid, 'uuid-1');
});

test('a project pushed under the serial of an earlier installation is taken over', async () => {
  const store = fakeConfigStore(pairingConfig('0242AC110002'));
  const service = new LoxoneConfigService(zonesStub, store, contentStub, {} as never);
  const project = [{ BC241107FD5B: { name: 'Audioserver', uuid: 'uuid-2', players: [] } }];
  await service.setRawAudioConfig({ raw: project, rawString: JSON.stringify(project) });
  const system = store.getSystemConfig();
  assert.equal(system.audioserver.macId, 'BC241107FD5B');
  assert.equal(system.audioserver.paired, true);
});

test('an added extension gets the next serial and is reported to the Miniserver by serial', async () => {
  assert.equal(nextExtensionSerial('00D861FD1135', []), '00D861FD1136');
  assert.equal(nextExtensionSerial('00:D8:61:FD:11:35', ['00D861FD1136']), '00D861FD1137');
  const store = fakeConfigStore(pairingConfig('00D861FD1135'));
  const service = new LoxoneConfigService(zonesStub, store, contentStub, {} as never);
  let changes = 0;
  const stopListening = onExtensionsChanged(() => {
    changes += 1;
  });
  try {
    const created = await service.addExtension();
    assert.equal(created.mac, '00D861FD1136');
    assert.deepEqual(service.getCurrentConfigInfo().extensions, [
      { serial: '00D861FD1136', mac: '00D861FD1136', name: 'Stereo Extension 1' },
    ]);
    assert.equal(changes, 1, 'the Miniserver is told at once, not on the next reconnect');
  } finally {
    stopListening();
  }
});

test('the recording keeps every port while it runs, and nothing after', () => {
  loxonePairingMonitor.reset();
  loxonePairingMonitor.command('appHttp', '192.168.2.10', 'audio/cfg/before');
  loxonePairingMonitor.startCapture(60_000);
  loxonePairingMonitor.command('appHttp', '192.168.2.10', 'audio/cfg/treeturbo');
  loxonePairingMonitor.udpProbe('192.168.2.10', Buffer.from([0x00, 0x01, 0xff]));
  loxonePairingMonitor.stopCapture();
  loxonePairingMonitor.command('msHttp', '192.168.2.5', 'audio/cfg/after');
  const entries = loxonePairingMonitor.snapshot().capture.entries;
  assert.deepEqual(
    entries.map((entry) => [entry.source, entry.detail]),
    [
      ['appHttp', 'audio/cfg/treeturbo'],
      ['udp 7070', '3 bytes: 00 01 ff'],
    ],
  );
});

test('a command nothing answers is kept for the diagnosis', () => {
  loxonePairingMonitor.reset();
  loxonePairingMonitor.unhandled('audio/cfg/treeturbo/search');
  loxonePairingMonitor.unhandled('/audio/cfg/treeturbo/search');
  const [entry] = loxonePairingMonitor.snapshot().unhandled;
  assert.equal(entry?.command, 'audio/cfg/treeturbo/search');
  assert.equal(entry?.count, 2);
});

test('a project for several other audioservers is not claimed', async () => {
  const store = fakeConfigStore(pairingConfig('0242AC110002'));
  const service = new LoxoneConfigService(zonesStub, store, contentStub, {} as never);
  const project = [
    { BC241107FD5B: { name: 'Erdgeschoss', players: [] } },
    { BC241107FD5C: { name: 'Obergeschoss', players: [] } },
  ];
  await service.setRawAudioConfig({ raw: project, rawString: JSON.stringify(project) });
  const system = store.getSystemConfig();
  assert.equal(system.audioserver.macId, '0242AC110002');
  assert.equal(system.audioserver.paired, false);
});
