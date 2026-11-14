import { MetadataStatus } from '../../types';
import { SonosNamespace, SubscribeCallback, UnsubscribeCallback } from '../namespace';
export declare class PlaybackMetadataNamespace extends SonosNamespace<MetadataStatus> {
    constructor(api: any);
    getMetadataStatus(groupId: string): Promise<MetadataStatus>;
    subscribe(groupId: string, callback: SubscribeCallback<MetadataStatus>): Promise<UnsubscribeCallback>;
}
