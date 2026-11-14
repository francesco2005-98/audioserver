export interface SonosDeviceDescription {
    /** RINCON_… — the stable player id, with the UDN's `uuid:` prefix stripped. */
    uuid: string;
    /** The room the speaker is assigned to; what a user calls this player. */
    name: string;
    host: string;
    port: number;
    modelName?: string;
}
export interface LoadDescriptionOptions {
    port?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
}
export declare function loadDeviceDescription(host: string, options?: LoadDescriptionOptions): Promise<SonosDeviceDescription>;
