import assert from 'node:assert/strict';
import { test } from './testHarness';
import { classifyTidalPoll } from '../src/adapters/content/providers/tidal/tidalLogin';

test('a Tidal poll that is still waiting stays pending', () => {
  assert.deepEqual(classifyTidalPoll(400, { error: 'authorization_pending' }), { kind: 'pending' });
  assert.deepEqual(classifyTidalPoll(400, { error: 'slow_down' }), { kind: 'slow' });
});

test('an expired or declined Tidal code is an error the screen can show', () => {
  assert.equal(classifyTidalPoll(400, { error: 'expired_token' }).kind, 'error');
  const denied = classifyTidalPoll(400, { error: 'access_denied' });
  assert.equal(denied.kind, 'error');
  if (denied.kind === 'error') {
    assert.equal(denied.error, 'access_denied');
  }
});

test('a finished Tidal poll keeps the tokens and the account name', () => {
  const done = classifyTidalPoll(200, {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_in: 86400,
    user: { userId: 42, username: 'Ada', countryCode: 'DE' },
  });
  assert.equal(done.kind, 'done');
  if (done.kind === 'done') {
    assert.equal(done.accessToken, 'access');
    assert.equal(done.refreshToken, 'refresh');
    assert.equal(done.user.userName, 'Ada');
    assert.equal(done.user.countryCode, 'DE');
    assert.equal(done.user.userId, '42');
  }
});
