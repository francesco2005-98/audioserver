import { SonosClient } from './client';
import { SonosGroup } from './group';
import { Player } from './types';
export declare class SonosPlayer {
    private client;
    private data;
    private volumeData;
    private activeGroup;
    constructor(client: SonosClient, data: Player);
    init(): Promise<void>;
    get id(): string;
    get name(): string;
    get icon(): string;
    get volumeLevel(): number | undefined;
    get volumeMuted(): boolean | undefined;
    get hasFixedVolume(): boolean | undefined;
    get group(): SonosGroup | null;
    get groupMembers(): string[];
    get isCoordinator(): boolean;
    get isPassive(): boolean;
    setVolume(volume?: number, muted?: boolean): Promise<void>;
    duck(durationMillis?: number): Promise<void>;
    leaveGroup(): Promise<void>;
    joinGroup(groupId: string): Promise<void>;
    playAudioClip(url: string, options?: {
        volume?: number;
        name?: string;
    }): Promise<void>;
    loadHomeTheaterPlayback(): Promise<void>;
    updateData(newData: Player): void;
    checkActiveGroup(): void;
    private handleVolumeUpdate;
}
