import { SonosNamespace, SubscribeCallback, UnsubscribeCallback } from '../namespace';
import { AudioClipStatusEvent } from '../../types';
export declare class AudioClipNamespace extends SonosNamespace<AudioClipStatusEvent> {
    constructor(api: any);
    loadAudioClip(playerId: string, options: {
        name: string;
        appId: string;
        streamUrl?: string;
        volume?: number;
        priority?: string;
        clipType?: string;
        httpAuthorization?: string;
        clipLEDBehavior?: string;
    }): Promise<any>;
    subscribe(playerId: string, callback: SubscribeCallback<AudioClipStatusEvent>): Promise<UnsubscribeCallback>;
}
