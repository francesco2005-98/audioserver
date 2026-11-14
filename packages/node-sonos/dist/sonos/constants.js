"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventType = exports.API_VERSION = exports.LOG_LEVEL_VERBOSE = exports.LOCAL_API_TOKEN = void 0;
exports.LOCAL_API_TOKEN = '123e4567-e89b-12d3-a456-426655440000';
exports.LOG_LEVEL_VERBOSE = 5;
exports.API_VERSION = 1;
var EventType;
(function (EventType) {
    EventType["GROUP_ADDED"] = "group_added";
    EventType["GROUP_UPDATED"] = "group_updated";
    EventType["GROUP_REMOVED"] = "group_removed";
    EventType["PLAYER_ADDED"] = "player_added";
    EventType["PLAYER_UPDATED"] = "player_updated";
    EventType["PLAYER_REMOVED"] = "player_removed";
    EventType["CONNECTED"] = "connected";
    EventType["DISCONNECTED"] = "disconnected";
    EventType["MATCH_ALL"] = "match_all";
})(EventType || (exports.EventType = EventType = {}));
