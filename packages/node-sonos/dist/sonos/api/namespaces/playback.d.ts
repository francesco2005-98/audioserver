import { LoadContentRequest, PlaybackStatus, PlayModes } from '../../types';
import { SonosNamespace, SubscribeCallback, UnsubscribeCallback } from '../namespace';
export declare class PlaybackNamespace extends SonosNamespace<PlaybackStatus> {
    constructor(api: any);
    getPlaybackStatus(groupId: string): Promise<PlaybackStatus>;
    loadLineIn(groupId: string, deviceId?: string, playOnCompletion?: boolean): Promise<void>;
    loadContent(groupId: string, content: LoadContentRequest): Promise<void>;
    pause(groupId: string): Promise<void>;
    play(groupId: string): Promise<void>;
    togglePlayPause(groupId: string): Promise<void>;
    setPlayModes(groupId: string, playModes: PlayModes): Promise<void>;
    seek(groupId: string, positionMillis: number, itemId?: string): Promise<void>;
    seekRelative(groupId: string, deltaMillis: number, itemId?: string): Promise<void>;
    skipToNextTrack(groupId: string): Promise<void>;
    skipToPreviousTrack(groupId: string): Promise<void>;
    subscribe(groupId: string, callback: SubscribeCallback<PlaybackStatus>): Promise<UnsubscribeCallback>;
}
