import assert from 'node:assert/strict';
import { test } from './testHarness';
import {
  pairingSeesVirtualNetworks,
  soloistMdnsLine,
} from '../src/adapters/inputs/spotify/soloist/soloistPairing';
import { ifaceFilterActive } from '../src/adapters/inputs/spotify/soloist/soloistProcess';

test('spotify discovery: only Soloist’s own mdns lines count', () => {
  assert.equal(soloistMdnsLine('mdns created successfully'), 'ready');
  assert.equal(soloistMdnsLine('Failed to initialize mdns'), 'blocked');
  assert.equal(soloistMdnsLine('ready, device_name=Kitchen'), null);
});

test('spotify discovery: virtual networks are a yes or a no', () => {
  assert.equal(typeof pairingSeesVirtualNetworks(), 'boolean');
  assert.equal(typeof ifaceFilterActive(), 'boolean');
});
