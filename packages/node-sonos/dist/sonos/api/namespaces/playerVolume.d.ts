import { PlayerVolume } from '../../types';
import { SonosNamespace, SubscribeCallback, UnsubscribeCallback } from '../namespace';
export declare class PlayerVolumeNamespace extends SonosNamespace<PlayerVolume> {
    constructor(api: any);
    setVolume(playerId: string, volume?: number, muted?: boolean): Promise<void>;
    getVolume(playerId: string): Promise<PlayerVolume>;
    duck(playerId: string, durationMillis?: number): Promise<void>;
    unduck(playerId: string): Promise<void>;
    setMute(playerId: string, muted: boolean): Promise<void>;
    setRelativeVolume(playerId: string, volumeDelta?: number, muted?: boolean): Promise<void>;
    subscribe(playerId: string, callback: SubscribeCallback<PlayerVolume>): Promise<UnsubscribeCallback>;
}
