"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayModesWrapper = exports.PlaybackActionsWrapper = void 0;
exports.normalizeContainerType = normalizeContainerType;
exports.normalizeMusicService = normalizeMusicService;
const types_1 = require("./types");
class PlaybackActionsWrapper {
    raw;
    constructor(raw) {
        this.raw = raw;
    }
    get canSkipForward() {
        return this.raw.canSkipForward ?? this.raw.canSkip ?? false;
    }
    get canSkipBackward() {
        return this.raw.canSkipBack ?? this.raw.canSkipToPrevious ?? false;
    }
    get canPlay() {
        return this.raw.canPlay ?? false;
    }
    get canPause() {
        return this.raw.canPause ?? false;
    }
    get canStop() {
        return this.raw.canStop ?? false;
    }
}
exports.PlaybackActionsWrapper = PlaybackActionsWrapper;
class PlayModesWrapper {
    raw;
    constructor(raw) {
        this.raw = raw;
    }
    get crossfade() {
        return this.raw.crossfade;
    }
    get repeat() {
        return this.raw.repeat;
    }
    get repeatOne() {
        return this.raw.repeatOne;
    }
    get shuffle() {
        return this.raw.shuffle;
    }
}
exports.PlayModesWrapper = PlayModesWrapper;
function normalizeContainerType(containerType) {
    if (!containerType)
        return null;
    if (Object.values(types_1.ContainerType).includes(containerType)) {
        return containerType;
    }
    return containerType;
}
function normalizeMusicService(serviceId) {
    if (!serviceId)
        return null;
    if (Object.values(types_1.MusicService).includes(serviceId)) {
        return serviceId;
    }
    return serviceId;
}
