import type { S1Client } from './client';
import type { S1SonosGroup } from './group';
export interface S1PlayerSeed {
    id: string;
    name: string;
    host: string;
}
export declare class S1SonosPlayer {
    private readonly client;
    private seed;
    private activeGroup;
    constructor(client: S1Client, seed: S1PlayerSeed);
    get id(): string;
    get name(): string;
    get host(): string;
    get icon(): string;
    get group(): S1SonosGroup | null;
    get groupMembers(): string[];
    get isCoordinator(): boolean;
    get isPassive(): boolean;
    leaveGroup(): Promise<void>;
    joinGroup(groupId: string): Promise<void>;
    setVolume(_volume?: number, _muted?: boolean): Promise<void>;
    updateSeed(seed: S1PlayerSeed): boolean;
    setActiveGroup(group: S1SonosGroup | null): void;
    notifyUpdated(): void;
}
