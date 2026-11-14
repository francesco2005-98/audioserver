import assert from 'node:assert/strict';
import { test } from './testHarness';
import { sonosGroupController, type SonosGroupParticipant } from '../src/application/outputs/sonosGroupController';
import { removeGroupByLeader, upsertGroup } from '../src/application/groups/groupTracker';

const LEADER = 9101;
const MEMBER = 9102;

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

test('a Sonos member falls back to the UPnP join when the group API refuses', async () => {
  const calls: string[] = [];
  const leader: SonosGroupParticipant = {
    getZoneId: () => LEADER,
    ensureDeviceInfo: async () => 'RINCON_LEADER',
    getDeviceUdn: () => 'RINCON_LEADER',
    getS2GroupId: () => 'group-leader',
    joinToLeader: async () => false,
    joinToLeaderS2: async () => false,
    leaveGroup: async () => undefined,
  };
  const member: SonosGroupParticipant = {
    getZoneId: () => MEMBER,
    ensureDeviceInfo: async () => 'RINCON_MEMBER',
    getDeviceUdn: () => 'RINCON_MEMBER',
    getS2GroupId: () => null,
    joinToLeaderS2: async () => {
      calls.push('s2');
      return false;
    },
    joinToLeader: async (udn) => {
      calls.push(`soap:${udn}`);
      return true;
    },
    leaveGroup: async () => {
      calls.push('leave');
    },
  };
  sonosGroupController.register(LEADER, leader);
  sonosGroupController.register(MEMBER, member);
  try {
    upsertGroup({
      leader: LEADER,
      members: [LEADER, MEMBER],
      backend: 'Unknown',
      externalId: 'sonos-group-test',
      source: 'manual',
    });
    await flush();
    assert.deepEqual(calls, ['s2', 'soap:RINCON_LEADER']);

    upsertGroup({
      leader: LEADER,
      members: [LEADER],
      backend: 'Unknown',
      externalId: 'sonos-group-test',
      source: 'manual',
    });
    await flush();
    assert.deepEqual(calls, ['s2', 'soap:RINCON_LEADER', 'leave']);
  } finally {
    removeGroupByLeader(LEADER);
    sonosGroupController.unregister(LEADER);
    sonosGroupController.unregister(MEMBER);
  }
});

test('a failed Sonos join is tried again the next time the group is saved', async () => {
  const calls: string[] = [];
  let accept = false;
  const leader: SonosGroupParticipant = {
    getZoneId: () => LEADER,
    ensureDeviceInfo: async () => 'RINCON_LEADER',
    getDeviceUdn: () => 'RINCON_LEADER',
    getS2GroupId: () => null,
    joinToLeader: async () => false,
    joinToLeaderS2: async () => false,
    leaveGroup: async () => undefined,
  };
  const member: SonosGroupParticipant = {
    getZoneId: () => MEMBER,
    ensureDeviceInfo: async () => null,
    getDeviceUdn: () => null,
    getS2GroupId: () => null,
    joinToLeaderS2: async () => false,
    joinToLeader: async () => {
      calls.push('soap');
      return accept;
    },
    leaveGroup: async () => undefined,
  };
  sonosGroupController.register(LEADER, leader);
  sonosGroupController.register(MEMBER, member);
  try {
    upsertGroup({
      leader: LEADER,
      members: [LEADER, MEMBER],
      backend: 'Unknown',
      externalId: 'sonos-retry',
      source: 'manual',
    });
    await flush();
    assert.deepEqual(calls, ['soap']);

    accept = true;
    upsertGroup({
      leader: LEADER,
      members: [LEADER, MEMBER],
      backend: 'Unknown',
      externalId: 'sonos-retry-again',
      source: 'manual',
    });
    await flush();
    assert.deepEqual(calls, ['soap', 'soap']);
  } finally {
    removeGroupByLeader(LEADER);
    sonosGroupController.unregister(LEADER);
    sonosGroupController.unregister(MEMBER);
  }
});
