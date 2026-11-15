import assert from 'node:assert/strict';
import { test } from './testHarness';
import {
  discoveryPortFree,
  pairingSeesVirtualNetworks,
} from '../src/adapters/inputs/spotify/soloist/soloistPairing';
import { ifaceFilterActive } from '../src/adapters/inputs/spotify/soloist/soloistProcess';

test('spotify discovery: the mDNS port check settles instead of hanging', async () => {
  const free = await discoveryPortFree();
  assert.equal(typeof free, 'boolean');
});

test('spotify discovery: virtual networks are a yes or a no', () => {
  assert.equal(typeof pairingSeesVirtualNetworks(), 'boolean');
  assert.equal(typeof ifaceFilterActive(), 'boolean');
});
