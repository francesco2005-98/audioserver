import { createLogger } from '@/shared/logging/logger';
import { getGroupByZone, onGroupChanged } from '@/application/groups/groupTracker';
import type { GroupRecord } from '@/application/groups/types/groupRecord';

export type SonosGroupParticipant = {
  getZoneId(): number;
  ensureDeviceInfo(): Promise<string | null>;
  getDeviceUdn(): string | null;
  getS2GroupId(): string | null;
  joinToLeader(leaderUdn: string): Promise<boolean>;
  joinToLeaderS2(groupId: string): Promise<boolean>;
  leaveGroup(): Promise<void>;
};

export type SonosGroupCoordinator = {
  register: (zoneId: number, output: SonosGroupParticipant) => void;
  unregister: (zoneId: number) => void;
  tryJoinLeader: (output: SonosGroupParticipant) => Promise<boolean>;
  syncGroupMembers: (leader: SonosGroupParticipant) => Promise<void>;
};

class SonosGroupController {
  private readonly log = createLogger('Output', 'SonosGroups');
  private readonly outputs = new Map<number, SonosGroupParticipant>();
  private readonly lastMembersByLeader = new Map<number, Set<number>>();

  constructor() {
    onGroupChanged((event, _leader, record) => {
      if (event === 'remove' && record) {
        void this.handleGroupRemoved(record);
        return;
      }
      if ((event === 'new' || event === 'update') && record) {
        void this.syncGroup(record);
      }
    });
  }

  public register(zoneId: number, output: SonosGroupParticipant): void {
    this.outputs.set(zoneId, output);
  }

  public unregister(zoneId: number): void {
    this.outputs.delete(zoneId);
    this.lastMembersByLeader.delete(zoneId);
  }

  public async tryJoinLeader(output: SonosGroupParticipant): Promise<boolean> {
    const group = getGroupByZone(output.getZoneId());
    if (!group || group.leader === output.getZoneId()) {
      return false;
    }
    const leader = this.outputs.get(group.leader);
    if (!leader) {
      return false;
    }
    const leaderUdn = await leader.ensureDeviceInfo();
    const leaderS2GroupId = leader.getS2GroupId();
    return joinMember(output, leaderUdn, leaderS2GroupId);
  }

  public async syncGroupMembers(leader: SonosGroupParticipant): Promise<void> {
    const group = getGroupByZone(leader.getZoneId());
    if (!group || group.leader !== leader.getZoneId()) {
      return;
    }
    const leaderUdn = await leader.ensureDeviceInfo();
    const leaderS2GroupId = leader.getS2GroupId();
    if (!leaderUdn && !leaderS2GroupId) {
      return;
    }
    const members = new Set<number>(group.members);
    members.delete(group.leader);
    for (const memberId of members) {
      const output = this.outputs.get(memberId);
      if (!output) continue;
      await this.joinLogged(group.leader, memberId, output, leaderUdn, leaderS2GroupId);
    }
  }

  private async syncGroup(record: GroupRecord): Promise<void> {
    const leader = this.outputs.get(record.leader);
    if (!leader) {
      return;
    }
    const leaderUdn = await leader.ensureDeviceInfo();
    const leaderS2GroupId = leader.getS2GroupId();
    if (!leaderUdn && !leaderS2GroupId) {
      return;
    }
    const members = new Set<number>(record.members);
    members.delete(record.leader);
    const previous = this.lastMembersByLeader.get(record.leader) ?? new Set<number>();
    // Only members that actually joined are remembered. A failed join used to be
    // recorded too, so the next group update skipped it and the speaker stayed alone.
    const joined = new Set<number>();

    for (const memberId of members) {
      if (previous.has(memberId)) {
        joined.add(memberId);
        continue;
      }
      const output = this.outputs.get(memberId);
      if (!output) continue;
      if (await this.joinLogged(record.leader, memberId, output, leaderUdn, leaderS2GroupId)) {
        joined.add(memberId);
      }
    }
    this.lastMembersByLeader.set(record.leader, joined);

    for (const memberId of previous) {
      if (members.has(memberId)) {
        continue;
      }
      const output = this.outputs.get(memberId);
      if (!output) continue;
      try {
        await output.leaveGroup();
      } catch (err) {
        this.log.debug('sonos leave failed', {
          leader: record.leader,
          member: memberId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async joinLogged(
    leaderId: number,
    memberId: number,
    output: SonosGroupParticipant,
    leaderUdn: string | null,
    leaderS2GroupId: string | null,
  ): Promise<boolean> {
    try {
      return await joinMember(output, leaderUdn, leaderS2GroupId);
    } catch (err) {
      this.log.debug('sonos join failed', {
        leader: leaderId,
        member: memberId,
        message: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  private async handleGroupRemoved(record: GroupRecord): Promise<void> {
    const previous = this.lastMembersByLeader.get(record.leader);
    this.lastMembersByLeader.delete(record.leader);
    const members = previous ?? new Set<number>(record.members);
    members.delete(record.leader);
    for (const memberId of members) {
      const output = this.outputs.get(memberId);
      if (!output) continue;
      try {
        await output.leaveGroup();
      } catch (err) {
        this.log.debug('sonos leave failed', {
          leader: record.leader,
          member: memberId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

/**
 * Prefer the speaker's own group API, and fall back to the UPnP join when that
 * is unavailable. An S2 group id that the member cannot use must not be the end
 * of the attempt: the SOAP `x-rincon` join still works on the same speaker.
 */
async function joinMember(
  output: SonosGroupParticipant,
  leaderUdn: string | null,
  leaderS2GroupId: string | null,
): Promise<boolean> {
  if (leaderS2GroupId) {
    const joined = await output.joinToLeaderS2(leaderS2GroupId);
    if (joined) {
      return true;
    }
  }
  if (leaderUdn) {
    return output.joinToLeader(leaderUdn);
  }
  return false;
}

export const sonosGroupController: SonosGroupCoordinator = new SonosGroupController();
