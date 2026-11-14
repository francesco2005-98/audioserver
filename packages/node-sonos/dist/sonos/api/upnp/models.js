"use strict";
// Wire-level shapes for the S1 (UPnP/SOAP) backend.
//
// These mirror what a Sonos speaker actually puts on the wire — DIDL-Lite track
// metadata and the ZoneGroupState topology document — and stay separate from the
// neutral `Track`/`Group` types in ../../types that both backends translate into.
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpnpTransportState = void 0;
/** Raw UPnP AVTransport states, as they appear in a LastChange event. */
var UpnpTransportState;
(function (UpnpTransportState) {
    UpnpTransportState["Stopped"] = "STOPPED";
    UpnpTransportState["Playing"] = "PLAYING";
    UpnpTransportState["PausedPlayback"] = "PAUSED_PLAYBACK";
    UpnpTransportState["Transitioning"] = "TRANSITIONING";
    UpnpTransportState["NoMediaPresent"] = "NO_MEDIA_PRESENT";
})(UpnpTransportState || (exports.UpnpTransportState = UpnpTransportState = {}));
