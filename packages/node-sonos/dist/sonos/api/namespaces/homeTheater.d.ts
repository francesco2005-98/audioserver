import { SonosNamespace } from '../namespace';
export declare class HomeTheaterNamespace extends SonosNamespace<any> {
    constructor(api: any);
    loadHomeTheaterPlayback(playerId: string): Promise<void>;
}
