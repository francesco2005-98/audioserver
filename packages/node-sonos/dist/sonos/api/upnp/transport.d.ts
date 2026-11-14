import { type CallActionOptions } from './soap';
export type TransportCommand = 'Play' | 'Pause' | 'Stop' | 'Next' | 'Previous';
/**
 * Transport commands only take effect on a group's coordinator, so callers are
 * expected to have resolved that host first.
 */
export declare function sendTransportCommand(host: string, command: TransportCommand, options?: CallActionOptions): Promise<void>;
export interface PositionInfo {
    trackUri?: string;
    trackMetadata?: string;
    /** Elapsed time within the track, as a UPnP clock string. */
    relTime?: string;
    duration?: string;
}
export declare function getPositionInfo(host: string, options?: CallActionOptions): Promise<PositionInfo>;
export interface MediaInfo {
    currentUri?: string;
    currentUriMetadata?: string;
}
export declare function getMediaInfo(host: string, options?: CallActionOptions): Promise<MediaInfo>;
export declare function getTransportState(host: string, options?: CallActionOptions): Promise<string | undefined>;
export declare function getVolume(host: string, options?: CallActionOptions): Promise<number | undefined>;
export declare function getMute(host: string, options?: CallActionOptions): Promise<boolean | undefined>;
