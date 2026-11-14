import { ContainerType, MusicService, PlaybackActions, PlayModes } from './types';
export declare class PlaybackActionsWrapper {
    private raw;
    constructor(raw: PlaybackActions);
    get canSkipForward(): boolean;
    get canSkipBackward(): boolean;
    get canPlay(): boolean;
    get canPause(): boolean;
    get canStop(): boolean;
}
export declare class PlayModesWrapper {
    raw: PlayModes;
    constructor(raw: PlayModes);
    get crossfade(): boolean | undefined;
    get repeat(): boolean | undefined;
    get repeatOne(): boolean | undefined;
    get shuffle(): boolean | undefined;
}
export declare function normalizeContainerType(containerType?: string): ContainerType | string | null;
export declare function normalizeMusicService(serviceId?: string): MusicService | string | null;
