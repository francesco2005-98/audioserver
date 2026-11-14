import { EventType } from '../../constants';
import type { SonosEvent } from '../../types';
import { S1SonosGroup } from './group';
import { UpnpTransportState } from './models';
import { S1SonosPlayer } from './player';
import { type TransportCommand } from './transport';
export interface S1ClientOptions {
    logger?: Console;
    /** Override the UPnP port (defaults to 1400). */
    port?: number;
    /**
     * How often to poll RelativeTimePosition while playing. AVTransport doesn't push
     * position, so we poll for it. Set to 0 to disable.
     */
    positionPollIntervalMs?: number;
    /**
     * Safety net behind the ZoneGroupTopology events, in case a NOTIFY is missed.
     * Set to 0 to rely on events alone.
     */
    topologyPollIntervalMs?: number;
}
export declare class S1Client {
    player: S1SonosPlayer | null;
    playerId: string;
    householdId: string;
    private readonly playerIp;
    private readonly port;
    private readonly logger;
    private readonly positionPollIntervalMs;
    private readonly topologyPollIntervalMs;
    private description;
    private events;
    private groupMap;
    private zoneGroups;
    private subscribers;
    private positionPollTimer;
    private topologyPollTimer;
    private stopRequested;
    private transportState;
    private volumeLevel;
    private mutedState;
    constructor(playerIp: string, options?: S1ClientOptions);
    get groups(): S1SonosGroup[];
    subscribe(cb: (event: SonosEvent) => void, eventFilter?: EventType | EventType[] | null, objectIdFilter?: string | string[] | null): () => void;
    signalEvent(event: SonosEvent): void;
    connect(): Promise<void>;
    /** Kept for parity with the S2 client, where it bootstraps the event listener. */
    start(): Promise<void>;
    disconnect(): Promise<void>;
    get currentTransportState(): UpnpTransportState | undefined;
    get currentVolume(): number | undefined;
    get currentMuted(): boolean | undefined;
    /**
     * Run a transport command against a group's coordinator. Only the coordinator
     * accepts them; sending to a joined member is silently ignored by the speaker.
     */
    runTransportCommand(groupId: string, command: TransportCommand): Promise<void>;
    /**
     * Where to send a group's commands. The topology carries each member's own
     * address, which is what to trust — a household is normally all on 1400, but
     * nothing about the protocol says it has to be.
     */
    private coordinatorEndpointFor;
    private refreshTopology;
    private applyTopology;
    private resolveActiveGroup;
    private startTopologyPolling;
    /**
     * Events only report *changes*, so a speaker that has been sitting still since
     * before we subscribed would tell us nothing. Read the current state once.
     */
    private primeState;
    private startEvents;
    private parseTrack;
    private startPositionPolling;
    private refreshPosition;
}
