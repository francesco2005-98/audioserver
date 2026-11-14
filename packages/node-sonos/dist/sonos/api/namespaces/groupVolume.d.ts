import { GroupVolume } from '../../types';
import { SonosNamespace, SubscribeCallback, UnsubscribeCallback } from '../namespace';
export declare class GroupVolumeNamespace extends SonosNamespace<GroupVolume> {
    constructor(api: any);
    setVolume(groupId: string, volume: number): Promise<void>;
    getVolume(groupId: string): Promise<GroupVolume>;
    setMute(groupId: string, muted: boolean): Promise<void>;
    setRelativeVolume(groupId: string, volumeDelta?: number): Promise<void>;
    subscribe(groupId: string, callback: SubscribeCallback<GroupVolume>): Promise<UnsubscribeCallback>;
}
