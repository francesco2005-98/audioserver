import { GroupInfo, Groups } from '../../types';
import { SonosNamespace, SubscribeCallback, UnsubscribeCallback } from '../namespace';
export declare class GroupsNamespace extends SonosNamespace<Groups> {
    constructor(api: any);
    modifyGroupMembers(groupId: string, playerIdsToAdd: string[], playerIdsToRemove: string[]): Promise<GroupInfo>;
    setGroupMembers(groupId: string, playerIds: string[], areaIds?: string[]): Promise<GroupInfo>;
    getGroups(householdId: string, includeDeviceInfo?: boolean): Promise<Groups>;
    createGroup(householdId: string, playerIds: string[], musicContextGroupId?: string): Promise<GroupInfo>;
    subscribe(householdId: string, callback: SubscribeCallback<Groups>): Promise<UnsubscribeCallback>;
}
