"use strict";
// S1-backed equivalent of SonosGroup.
//
// The state controller in a consumer app reads a small slice of SonosGroup
// (playbackState, playbackMetadataStatus, positionSeconds, activeService,
// transport commands). This adapter answers those from the speaker state the
// client keeps current, and routes commands to the group's coordinator.
Object.defineProperty(exports, "__esModule", { value: true });
exports.S1SonosGroup = void 0;
const constants_1 = require("../../constants");
const types_1 = require("../../types");
const didl_1 = require("./didl");
const models_1 = require("./models");
class S1SonosGroup {
    client;
    seed;
    // Track metadata mirrored from the speaker's events, in the shape the
    // MetadataStatus consumers expect.
    currentTrack = null;
    enqueuedTrack = null;
    currentTrackUri = '';
    enqueuedTrackUri = '';
    positionAtUpdate = 0;
    updatedAtMs = Date.now();
    constructor(client, seed) {
        this.client = client;
        this.seed = seed;
    }
    // ----- topology -----
    get id() {
        return this.seed.id;
    }
    get coordinatorId() {
        return this.seed.coordinatorId;
    }
    get playerIds() {
        return this.seed.playerIds;
    }
    get name() {
        return this.seed.name;
    }
    get areaIds() {
        return [];
    }
    updateSeed(seed) {
        let changed = false;
        if (this.seed.coordinatorId !== seed.coordinatorId) {
            this.seed.coordinatorId = seed.coordinatorId;
            changed = true;
        }
        if (this.seed.playerIds.join(',') !== seed.playerIds.join(',')) {
            this.seed.playerIds = seed.playerIds;
            changed = true;
        }
        if (this.seed.name !== seed.name && seed.name) {
            this.seed.name = seed.name;
            changed = true;
        }
        return changed;
    }
    // ----- state derived from the speaker -----
    get playbackState() {
        switch (this.client.currentTransportState) {
            case models_1.UpnpTransportState.Playing:
                return types_1.PlayBackState.PLAYING;
            case models_1.UpnpTransportState.PausedPlayback:
                return types_1.PlayBackState.PAUSED;
            case models_1.UpnpTransportState.Transitioning:
                return types_1.PlayBackState.BUFFERING;
            default:
                return types_1.PlayBackState.IDLE;
        }
    }
    get positionSeconds() {
        if (this.playbackState === types_1.PlayBackState.PLAYING) {
            const elapsed = (Date.now() - this.updatedAtMs) / 1000;
            return Math.max(0, this.positionAtUpdate + elapsed);
        }
        return Math.max(0, this.positionAtUpdate);
    }
    setPosition(seconds) {
        if (seconds === null || !Number.isFinite(seconds))
            return;
        this.positionAtUpdate = Math.max(0, seconds);
        this.updatedAtMs = Date.now();
    }
    get isDucking() {
        return false;
    }
    get activeService() {
        return inferActiveService(this.currentTrackUri);
    }
    get containerType() {
        return inferContainerType(this.currentTrackUri, this.enqueuedTrackUri, this.currentTrack);
    }
    get playbackMetadataStatus() {
        return this.buildMetadataStatus();
    }
    get volume() {
        return this.client.currentVolume ?? null;
    }
    get muted() {
        return this.client.currentMuted ?? null;
    }
    // ----- transport commands (route to coordinator) -----
    async play() {
        await this.client.runTransportCommand(this.id, 'Play');
    }
    async pause() {
        await this.client.runTransportCommand(this.id, 'Pause');
    }
    async stop() {
        await this.client.runTransportCommand(this.id, 'Stop');
    }
    async togglePlayPause() {
        // AVTransport has no toggle; pick the command from what the speaker is doing.
        const playing = this.playbackState === types_1.PlayBackState.PLAYING;
        await this.client.runTransportCommand(this.id, playing ? 'Pause' : 'Play');
    }
    async skipToNextTrack() {
        await this.client.runTransportCommand(this.id, 'Next');
    }
    async skipToPreviousTrack() {
        await this.client.runTransportCommand(this.id, 'Previous');
    }
    // ----- updates from the event stream -----
    applyCurrentTrack(track) {
        this.currentTrack = track;
        this.emitUpdated();
    }
    applyCurrentTrackUri(uri) {
        this.currentTrackUri = uri ?? '';
        this.emitUpdated();
    }
    applyEnqueuedTrack(track) {
        this.enqueuedTrack = track;
        this.emitUpdated();
    }
    applyEnqueuedTrackUri(uri) {
        this.enqueuedTrackUri = uri ?? '';
        this.emitUpdated();
    }
    emitUpdated() {
        this.client.signalEvent({
            eventType: constants_1.EventType.GROUP_UPDATED,
            objectId: this.id,
            data: this,
        });
    }
    // ----- helpers -----
    buildMetadataStatus() {
        const track = this.currentTrack;
        const container = buildContainer(this.currentTrackUri, this.enqueuedTrackUri, this.enqueuedTrack);
        if (!track && !this.currentTrackUri && !container) {
            return {
                _objectType: 'metadataStatus',
                currentItem: undefined,
                container: undefined,
                streamInfo: undefined,
            };
        }
        const durationSec = (0, didl_1.parseClockToSec)(track?.duration);
        const currentItem = track
            ? {
                _objectType: 'queueItem',
                id: `${this.id}:current`,
                track: {
                    _objectType: 'track',
                    type: track.upnpClass ?? 'audioItem',
                    name: track.title ?? '',
                    mediaUrl: track.trackUri || this.currentTrackUri || undefined,
                    artist: track.artist ? { _objectType: 'artist', name: track.artist } : undefined,
                    album: track.album ? { _objectType: 'album', name: track.album } : undefined,
                    durationMillis: durationSec !== null ? durationSec * 1000 : undefined,
                    images: track.albumArtUri ? [{ _objectType: 'image', url: track.albumArtUri }] : undefined,
                },
            }
            : undefined;
        return {
            _objectType: 'metadataStatus',
            currentItem,
            container,
            // Radio carries its now-playing line out-of-band, in Sonos's r:streamContent,
            // while dc:title stays on the station name.
            streamInfo: track?.streamContent,
        };
    }
}
exports.S1SonosGroup = S1SonosGroup;
function buildContainer(currentUri, enqueuedUri, enqueuedTrack) {
    const containerType = inferContainerType(currentUri, enqueuedUri, enqueuedTrack);
    if (!enqueuedUri && !enqueuedTrack)
        return undefined;
    return {
        _objectType: 'container',
        name: enqueuedTrack?.title ?? '',
        type: containerType ?? 'unknown',
        images: enqueuedTrack?.albumArtUri
            ? [{ _objectType: 'image', url: enqueuedTrack.albumArtUri }]
            : undefined,
    };
}
function inferContainerType(currentUri, enqueuedUri, track) {
    const probe = `${currentUri} ${enqueuedUri}`.toLowerCase();
    if (probe.includes('x-rincon-stream:'))
        return types_1.ContainerType.LINEIN;
    if (probe.includes('x-sonos-htastream:'))
        return types_1.ContainerType.HOME_THEATER_SPDIF;
    if (probe.includes('x-rincon-mp3radio:') || probe.includes('x-sonosapi-stream:')) {
        return types_1.ContainerType.STATION;
    }
    if (probe.includes('x-sonos-vli:'))
        return types_1.ContainerType.AIRPLAY;
    if (probe.includes('x-sonos-spotify:'))
        return 'spotify';
    const upnpClass = track?.upnpClass?.toLowerCase() ?? '';
    if (upnpClass.includes('audiobroadcast'))
        return types_1.ContainerType.STATION;
    if (upnpClass.includes('musictrack'))
        return types_1.ContainerType.PLAYLIST;
    return null;
}
function inferActiveService(currentUri) {
    const uri = (currentUri ?? '').toLowerCase();
    if (uri.includes('spotify'))
        return types_1.MusicService.SPOTIFY;
    if (uri.includes('tunein') || uri.startsWith('x-sonosapi-stream:'))
        return types_1.MusicService.TUNEIN;
    if (uri.startsWith('x-rincon-stream:'))
        return 'linein';
    if (uri.startsWith('x-sonos-vli:'))
        return 'airplay';
    return null;
}
