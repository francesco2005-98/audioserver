import net from 'net';
import { EventType, MediaDetails, MediaMetadata, PlayerState, TransitionType } from './models.js';
type SlimClientCallback = (client: SlimClient, eventType: EventType, data?: unknown) => void | Promise<void>;
export declare class SlimClient {
    private readonly socket;
    private readonly callback;
    private readonly remoteAddress?;
    private readonly remotePort?;
    private readonly volumeControl;
    private buffer;
    private _connected;
    private _playerId;
    private _deviceType;
    private capabilities;
    private _deviceName;
    private _powered;
    private _muted;
    private _state;
    private _jiffies;
    private _lastTimestamp;
    private _elapsedMs;
    private _currentMedia;
    private _bufferingMedia;
    private _nextMedia;
    private _autoPlay;
    private _heartbeatTimer;
    private _heartbeatId;
    private readonly heartbeatSentAt;
    private pendingClockSync;
    private clockBase;
    constructor(socket: net.Socket, callback: SlimClientCallback);
    disconnect(): void;
    get connected(): boolean;
    get playerId(): string;
    get deviceType(): string;
    get name(): string;
    get deviceAddress(): string | undefined;
    get devicePort(): number | undefined;
    get state(): PlayerState;
    get currentMedia(): MediaDetails | null;
    get supportedCodecs(): string[];
    get maxSampleRate(): number;
    get firmware(): string;
    get volumeLevel(): number;
    get elapsedMilliseconds(): number;
    get jiffies(): number;
    get lastHeartbeatAt(): number | null;
    /**
     * Best-effort mapping between server wall clock time (ms) and player jiffies.
     * Derived from `strm t` / `stat STMt` heartbeat exchange.
     */
    get clockSync(): {
        serverTimeMs: number;
        jiffies: number;
        rttMs: number;
        updatedAtMs: number;
    } | null;
    /**
     * Estimate the player jiffies value at the given server time.
     * Returns a 32-bit unsigned timestamp suitable for `unpauseAt`.
     */
    estimateJiffiesAt(serverTimeMs: number): number;
    /**
     * Request an immediate clock sync sample (one `strm t` roundtrip).
     * Resolves true when the matching STMt arrives, false on timeout or disconnect.
     */
    requestClockSync(timeoutMs?: number): Promise<boolean>;
    stop(): Promise<void>;
    play(): Promise<void>;
    pause(): Promise<void>;
    pauseFor(millis: number): Promise<void>;
    skipOver(millis: number): Promise<void>;
    unpauseAt(timestamp: number): Promise<void>;
    power(powered?: boolean): Promise<void>;
    volumeSet(volumeLevel: number): Promise<void>;
    volumeUp(): Promise<void>;
    volumeDown(): Promise<void>;
    mute(muted?: boolean): Promise<void>;
    playUrl(url: string, mimeType?: string | null, metadata?: MediaMetadata, transition?: TransitionType, transitionDuration?: number, enqueue?: boolean, autostart?: boolean, sendFlush?: boolean): Promise<void>;
    private sendAudg;
    private sendFrame;
    private sendStrm;
    private handleDisconnect;
    private onData;
    private processHelo;
    private processButn;
    private processKnob;
    private processIr;
    private processDsco;
    private processStat;
    private processStatHeartbeat;
    private processResp;
    private processSetd;
    private parseCodc;
    private signalUpdate;
    private signalEvent;
    private startHeartbeat;
    private togglePower;
    private togglePause;
}
export {};
