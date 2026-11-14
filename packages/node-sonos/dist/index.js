"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpnpTransportState = exports.detectGeneration = exports.S1SonosPlayer = exports.S1SonosGroup = exports.S1Client = exports.SonosPlayer = exports.SonosGroup = exports.SonosClient = void 0;
var client_1 = require("./sonos/client");
Object.defineProperty(exports, "SonosClient", { enumerable: true, get: function () { return client_1.SonosClient; } });
var group_1 = require("./sonos/group");
Object.defineProperty(exports, "SonosGroup", { enumerable: true, get: function () { return group_1.SonosGroup; } });
var player_1 = require("./sonos/player");
Object.defineProperty(exports, "SonosPlayer", { enumerable: true, get: function () { return player_1.SonosPlayer; } });
__exportStar(require("./sonos/models"), exports);
__exportStar(require("./sonos/types"), exports);
__exportStar(require("./sonos/constants"), exports);
__exportStar(require("./sonos/errors"), exports);
// S1 (legacy / Sonos OS 1 firmware) support.
var client_2 = require("./sonos/api/upnp/client");
Object.defineProperty(exports, "S1Client", { enumerable: true, get: function () { return client_2.S1Client; } });
var group_2 = require("./sonos/api/upnp/group");
Object.defineProperty(exports, "S1SonosGroup", { enumerable: true, get: function () { return group_2.S1SonosGroup; } });
var player_2 = require("./sonos/api/upnp/player");
Object.defineProperty(exports, "S1SonosPlayer", { enumerable: true, get: function () { return player_2.S1SonosPlayer; } });
var discovery_1 = require("./sonos/api/upnp/discovery");
Object.defineProperty(exports, "detectGeneration", { enumerable: true, get: function () { return discovery_1.detectGeneration; } });
var models_1 = require("./sonos/api/upnp/models");
Object.defineProperty(exports, "UpnpTransportState", { enumerable: true, get: function () { return models_1.UpnpTransportState; } });
