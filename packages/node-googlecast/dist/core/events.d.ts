import type { DiscoveredDevice } from '../discovery/types.js';
import type { ReceiverStatus, MediaStatus } from '../protocol/messages.js';
import type { CastStatusModel, MediaStatusModel } from './models.js';
export interface CastDeviceEvents {
    connected: () => void;
    disconnected: (error?: Error) => void;
    connectionState: (state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected') => void;
    receiverStatus: (status: ReceiverStatus) => void;
    castStatus: (status: CastStatusModel) => void;
    mediaStatus: (status: MediaStatus) => void;
    mediaStatusModel: (status: MediaStatusModel) => void;
    volumeChanged: (volume: ReceiverStatus['status']['volume']) => void;
    error: (error: Error) => void;
}
export interface DiscoveryHandle {
    devices: DiscoveredDevice[];
    stop(): Promise<void>;
}
