"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HomeTheaterNamespace = void 0;
const namespace_1 = require("../namespace");
class HomeTheaterNamespace extends namespace_1.SonosNamespace {
    constructor(api) {
        super(api, 'homeTheater', 'homeTheaterStatus', 'playerId');
    }
    async loadHomeTheaterPlayback(playerId) {
        await this.api.sendCommand(this.namespace, 'loadHomeTheaterPlayback', undefined, { playerId });
    }
}
exports.HomeTheaterNamespace = HomeTheaterNamespace;
