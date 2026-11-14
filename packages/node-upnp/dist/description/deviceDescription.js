"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEVICE_TYPES = exports.SERVICE_TYPES = void 0;
exports.buildDeviceDescription = buildDeviceDescription;
const soap_js_1 = require("../soap/soap.js");
const DEFAULTS = {
    manufacturer: 'node-upnp',
    manufacturerUrl: 'https://www.npmjs.com/package/@audioserver/node-upnp',
    modelName: 'node-upnp',
    modelNumber: '1',
    modelDescription: 'node-upnp device',
};
/** Build a root device description for a given device type + services + DLNA doc. */
function buildDeviceDescription(params) {
    const { deviceType, identity, services, urlBase, dlnaDoc } = params;
    const id = { ...DEFAULTS, ...identity };
    const urlBaseEl = urlBase ? `<URLBase>${(0, soap_js_1.escapeXml)(urlBase)}</URLBase>` : '';
    const dlnaEl = dlnaDoc
        ? `<dlna:X_DLNADOC xmlns:dlna="urn:schemas-dlna-org:device-1-0">${(0, soap_js_1.escapeXml)(dlnaDoc)}</dlna:X_DLNADOC>`
        : '';
    const serviceList = services.map(serviceElement).join('');
    return ('<?xml version="1.0" encoding="utf-8"?>' +
        '<root xmlns="urn:schemas-upnp-org:device-1-0">' +
        '<specVersion><major>1</major><minor>0</minor></specVersion>' +
        urlBaseEl +
        '<device>' +
        `<deviceType>${(0, soap_js_1.escapeXml)(deviceType)}</deviceType>` +
        `<friendlyName>${(0, soap_js_1.escapeXml)(id.friendlyName)}</friendlyName>` +
        `<manufacturer>${(0, soap_js_1.escapeXml)(id.manufacturer)}</manufacturer>` +
        `<manufacturerURL>${(0, soap_js_1.escapeXml)(id.manufacturerUrl)}</manufacturerURL>` +
        `<modelDescription>${(0, soap_js_1.escapeXml)(id.modelDescription)}</modelDescription>` +
        `<modelName>${(0, soap_js_1.escapeXml)(id.modelName)}</modelName>` +
        `<modelNumber>${(0, soap_js_1.escapeXml)(id.modelNumber)}</modelNumber>` +
        `<UDN>${(0, soap_js_1.escapeXml)(id.udn)}</UDN>` +
        dlnaEl +
        `<serviceList>${serviceList}</serviceList>` +
        '</device>' +
        '</root>');
}
function serviceElement(s) {
    return ('<service>' +
        `<serviceType>${(0, soap_js_1.escapeXml)(s.serviceType)}</serviceType>` +
        `<serviceId>${(0, soap_js_1.escapeXml)(s.serviceId)}</serviceId>` +
        `<SCPDURL>${(0, soap_js_1.escapeXml)(s.scpdUrl)}</SCPDURL>` +
        `<controlURL>${(0, soap_js_1.escapeXml)(s.controlUrl)}</controlURL>` +
        `<eventSubURL>${(0, soap_js_1.escapeXml)(s.eventSubUrl)}</eventSubURL>` +
        '</service>');
}
// Standard service type / id URNs for convenience.
exports.SERVICE_TYPES = {
    contentDirectory: 'urn:schemas-upnp-org:service:ContentDirectory:1',
    connectionManager: 'urn:schemas-upnp-org:service:ConnectionManager:1',
    avTransport: 'urn:schemas-upnp-org:service:AVTransport:1',
    renderingControl: 'urn:schemas-upnp-org:service:RenderingControl:1',
};
exports.DEVICE_TYPES = {
    mediaServer: 'urn:schemas-upnp-org:device:MediaServer:1',
    mediaRenderer: 'urn:schemas-upnp-org:device:MediaRenderer:1',
};
