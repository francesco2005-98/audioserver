import { Agent } from 'undici';
export type SonosGeneration = 'S1' | 'S2' | 'unknown';
export interface DetectGenerationOptions {
    signal?: AbortSignal;
    s2TimeoutMs?: number;
    s1TimeoutMs?: number;
    dispatcher?: Agent;
}
export declare function detectGeneration(host: string, options?: DetectGenerationOptions): Promise<SonosGeneration>;
