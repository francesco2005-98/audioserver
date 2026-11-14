"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupsNamespace = void 0;
const namespace_1 = require("../namespace");
class GroupsNamespace extends namespace_1.SonosNamespace {
    constructor(api) {
        super(api, 'groups', 'groups', 'householdId');
    }
    async modifyGroupMembers(groupId, playerIdsToAdd, playerIdsToRemove) {
        return this.api.sendCommand(this.namespace, 'modifyGroupMembers', { playerIdsToAdd, playerIdsToRemove }, { groupId });
    }
    async setGroupMembers(groupId, playerIds, areaIds) {
        const options = { playerIds };
        if (areaIds)
            options.areaIds = areaIds;
        return this.api.sendCommand(this.namespace, 'setGroupMembers', options, { groupId });
    }
    async getGroups(householdId, includeDeviceInfo = false) {
        return this.api.sendCommand(this.namespace, 'getGroups', { includeDeviceInfo }, { householdId });
    }
    async createGroup(householdId, playerIds, musicContextGroupId) {
        const options = { playerIds };
        if (musicContextGroupId)
            options.musicContextGroupId = musicContextGroupId;
        return this.api.sendCommand(this.namespace, 'createGroup', options, { householdId });
    }
    async subscribe(householdId, callback) {
        return this.handleSubscribe(householdId, callback);
    }
}
exports.GroupsNamespace = GroupsNamespace;
