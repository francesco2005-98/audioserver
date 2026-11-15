import assert from 'node:assert/strict';
import { test } from './testHarness';
import { applyTimezone, isValidTimezone, localIsoTimestamp, utcOffset } from '../src/shared/time/timezone';
import { createConfigHandlers } from '../src/adapters/loxone/commands/handlers/configHandlers';
import { buildLoxoneHttpConfig } from '../src/config/loxone';
import { loadEnvironment } from '../src/config/environment';
import type { AudioServerConfig } from '../src/domain/config/types';
import type { ConfigPort } from '../src/ports/ConfigPort';

function withZone<T>(zone: string | undefined, fn: () => T): T {
  const previous = process.env.TZ;
  try {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
    return fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test('time zone: only real IANA zones are accepted', () => {
  assert.equal(isValidTimezone('Europe/Berlin'), true);
  assert.equal(isValidTimezone('Europe/Atlantis'), false);
  assert.equal(isValidTimezone(''), false);
  assert.equal(isValidTimezone(undefined), false);
});

test('time zone: applying one changes the clock without a restart', () => {
  withZone('UTC', () => {
    assert.equal(applyTimezone('Europe/Berlin'), 'Europe/Berlin');
    const winter = new Date(Date.UTC(2026, 10, 15, 8, 0, 0));
    assert.equal(winter.getHours(), 9);
    assert.equal(utcOffset(winter), '+01:00');
    assert.equal(localIsoTimestamp(winter), '2026-11-15T09:00:00.000+01:00');
    assert.equal(utcOffset(new Date(Date.UTC(2026, 6, 1, 8, 0, 0))), '+02:00');
    assert.equal(applyTimezone('Not/AZone'), 'Europe/Berlin', 'an unknown zone leaves the clock alone');
  });
});

test('time zone: the Miniserver zone is stored and applied', async () => {
  const previous = process.env.TZ;
  process.env.TZ = 'UTC';
  try {
    const state = {
      system: { audioserver: { macId: '504F94FF1BB3' } },
    } as unknown as AudioServerConfig;
    const configPort = {
      getConfig: () => state,
      getSystemConfig: () => state.system,
      async updateConfig(mutator: (cfg: AudioServerConfig) => void | Promise<void>) {
        await mutator(state);
      },
    } as unknown as ConfigPort;
    const handlers = createConfigHandlers(buildLoxoneHttpConfig(loadEnvironment(), '504F94FF1BB3'), {
      notifier: {} as never,
      configService: {} as never,
      configPort,
      contentManager: {} as never,
      spotifyInputService: {} as never,
    });
    const result = await handlers.timezone('audio/cfg/timezone/Europe/Vienna');
    assert.deepEqual(result?.payload, { timezone: 'Europe/Vienna' });
    assert.equal(state.system.audioserver.timezone, 'Europe/Vienna');
    assert.equal(process.env.TZ, 'Europe/Vienna');

    const bad = await handlers.timezone('audio/cfg/timezone/Mars/Olympus');
    assert.equal((bad?.payload as { error?: string }).error, 'invalid-timezone');
    assert.equal(state.system.audioserver.timezone, 'Europe/Vienna');
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
