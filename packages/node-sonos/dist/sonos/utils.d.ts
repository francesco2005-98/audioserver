import { Agent } from 'undici';
import { DiscoveryInfo } from './types';
export interface DiscoveryOptions {
    dispatcher?: Agent;
}
export declare function getDiscoveryInfo(playerIp: string, options?: DiscoveryOptions): Promise<DiscoveryInfo>;
