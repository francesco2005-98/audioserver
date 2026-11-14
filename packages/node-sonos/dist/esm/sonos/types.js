"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContainerType = exports.MusicService = exports.SonosCapability = exports.PlayBackState = void 0;
var PlayBackState;
(function (PlayBackState) {
    PlayBackState["IDLE"] = "PLAYBACK_STATE_IDLE";
    PlayBackState["BUFFERING"] = "PLAYBACK_STATE_BUFFERING";
    PlayBackState["PAUSED"] = "PLAYBACK_STATE_PAUSED";
    PlayBackState["PLAYING"] = "PLAYBACK_STATE_PLAYING";
})(PlayBackState || (exports.PlayBackState = PlayBackState = {}));
var SonosCapability;
(function (SonosCapability) {
    SonosCapability["CLOUD"] = "CLOUD";
    SonosCapability["PLAYBACK"] = "PLAYBACK";
    SonosCapability["AIRPLAY"] = "AIRPLAY";
    SonosCapability["LINE_IN"] = "LINE_IN";
    SonosCapability["VOICE"] = "VOICE";
    SonosCapability["AUDIO_CLIP"] = "AUDIO_CLIP";
    SonosCapability["MICROPHONE_SWITCH"] = "MICROPHONE_SWITCH";
    SonosCapability["HT_PLAYBACK"] = "HT_PLAYBACK";
})(SonosCapability || (exports.SonosCapability = SonosCapability = {}));
var MusicService;
(function (MusicService) {
    MusicService["SPOTIFY"] = "9";
    MusicService["MUSIC_ASSISTANT"] = "mass";
    MusicService["TUNEIN"] = "303";
    MusicService["QOBUZ"] = "31";
    MusicService["YOUTUBE_MUSIC"] = "284";
    MusicService["LOCAL_LIBRARY"] = "local-library";
})(MusicService || (exports.MusicService = MusicService = {}));
var ContainerType;
(function (ContainerType) {
    ContainerType["LINEIN"] = "linein";
    ContainerType["STATION"] = "station";
    ContainerType["PLAYLIST"] = "playlist";
    ContainerType["AIRPLAY"] = "linein.airplay";
    ContainerType["PODCAST"] = "podcast";
    ContainerType["BOOK"] = "book";
    ContainerType["ARTIST"] = "artist";
    ContainerType["ALBUM"] = "album";
    ContainerType["ARTIST_LOCAL"] = "artist.local";
    ContainerType["ALBUM_LOCAL"] = "album.local";
    ContainerType["HOME_THEATER_SPDIF"] = "linein.homeTheater.spdif";
    ContainerType["HOME_THEATER_HDMI"] = "linein.homeTheater.hdmi";
    // fallbacks for unknown types will be treated as strings
})(ContainerType || (exports.ContainerType = ContainerType = {}));
