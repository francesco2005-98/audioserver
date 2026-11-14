import { ContainerType, MetadataStatus, MusicService, PlayBackState } from '../../types';
import type { S1Client } from './client';
import { type UpnpTrack } from './models';
export interface S1GroupSeed {
    id: string;
    coordinatorId: string;
    name: string;
    playerIds: string[];
}
export declare class S1SonosGroup {
    private readonly client;
    private seed;
    private currentTrack;
    private enqueuedTrack;
    private currentTrackUri;
    private enqueuedTrackUri;
    private positionAtUpdate;
    private updatedAtMs;
    constructor(client: S1Client, seed: S1GroupSeed);
    get id(): string;
    get coordinatorId(): string;
    get playerIds(): string[];
    get name(): string;
    get areaIds(): string[];
    updateSeed(seed: S1GroupSeed): boolean;
    get playbackState(): PlayBackState;
    get positionSeconds(): number;
    setPosition(seconds: number | null): void;
    get isDucking(): boolean;
    get activeService(): MusicService | string | null;
    get containerType(): ContainerType | string | null;
    get playbackMetadataStatus(): MetadataStatus | null;
    get volume(): number | null;
    get muted(): boolean | null;
    play(): Promise<void>;
    pause(): Promise<void>;
    stop(): Promise<void>;
    togglePlayPause(): Promise<void>;
    skipToNextTrack(): Promise<void>;
    skipToPreviousTrack(): Promise<void>;
    applyCurrentTrack(track: UpnpTrack | null): void;
    applyCurrentTrackUri(uri: string): void;
    applyEnqueuedTrack(track: UpnpTrack | null): void;
    applyEnqueuedTrackUri(uri: string): void;
    emitUpdated(): void;
    private buildMetadataStatus;
}
