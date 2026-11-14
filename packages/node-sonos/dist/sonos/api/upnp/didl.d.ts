import type { UpnpTrack } from './models';
export interface ParseTrackOptions {
    /** Speaker that reported the metadata; relative album art is resolved against it. */
    host?: string;
    port?: number;
}
export declare function parseTrackMetadata(metadata: string | undefined | null, options?: ParseTrackOptions): UpnpTrack | null;
/** UPnP clock strings (H:MM:SS[.ms]) to whole seconds. */
export declare function parseClockToSec(clock: string | undefined | null): number | null;
