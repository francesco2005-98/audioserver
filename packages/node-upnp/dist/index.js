"use strict";
/**
 * @audioserver/node-upnp — a UPnP AV toolkit for Node.
 *
 * Three frameworks a host app can drop into its own HTTP server, each free of the
 * app's content or playback model — you inject those through small interfaces:
 *
 *  - {@link UpnpMediaRenderer} — be a renderer: accept SetAVTransportURI/Play from
 *    any control point and drive your own engine via a {@link RendererHandler}.
 *  - {@link UpnpMediaServer} — be a server: answer Browse over your own catalogue
 *    mapped onto neutral DIDL shapes via a {@link ContentProvider}.
 *  - {@link DlnaControlPoint} — be a control point: push a stream URI + DIDL to an
 *    external renderer, with the device-quirk handling baked in.
 *
 * All three advertise themselves on one shared {@link SsdpAdvertiser} (a single
 * :1900 socket serves every device). The lower-level protocol helpers (SOAP,
 * DIDL-Lite, GENA, device/SCPD descriptions, ID3) are exported too, so you can
 * build a device shape the frameworks don't cover.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildId3v2Tag = exports.extractFaultCode = exports.buildSoapFault = exports.buildSoapRequest = exports.buildSoapResponse = exports.extractTag = exports.parseSoapAction = exports.unescapeXml = exports.escapeXml = exports.RENDERING_CONTROL_SCPD = exports.AV_TRANSPORT_SCPD = exports.CONNECTION_MANAGER_SINK_SCPD = exports.CONNECTION_MANAGER_SCPD = exports.CONTENT_DIRECTORY_SCPD = exports.DEVICE_TYPES = exports.SERVICE_TYPES = exports.buildDeviceDescription = exports.parseDidlObject = exports.readDidlDuration = exports.readDidlField = exports.buildDidl = exports.wrapDidl = exports.buildItemElement = exports.buildContainerElement = exports.DlnaEventSubscriber = exports.discoverDlnaDevices = exports.resolveDlnaEndpoints = exports.parseSinkContentTypes = exports.DlnaControlPoint = exports.parseSearchCriteria = exports.MEDIA_SERVER_PATHS = exports.ROOT_OBJECT_ID = exports.UpnpMediaServer = exports.RENDERER_PATHS = exports.UpnpMediaRenderer = exports.SsdpAdvertiser = exports.noopLogger = void 0;
var logger_js_1 = require("./logger.js");
Object.defineProperty(exports, "noopLogger", { enumerable: true, get: function () { return logger_js_1.noopLogger; } });
// ── SSDP (shared discovery/advertising) ─────────────────────────────────────────
var advertiser_js_1 = require("./ssdp/advertiser.js");
Object.defineProperty(exports, "SsdpAdvertiser", { enumerable: true, get: function () { return advertiser_js_1.SsdpAdvertiser; } });
// ── Frameworks ──────────────────────────────────────────────────────────────────
var mediaRenderer_js_1 = require("./renderer/mediaRenderer.js");
Object.defineProperty(exports, "UpnpMediaRenderer", { enumerable: true, get: function () { return mediaRenderer_js_1.UpnpMediaRenderer; } });
Object.defineProperty(exports, "RENDERER_PATHS", { enumerable: true, get: function () { return mediaRenderer_js_1.RENDERER_PATHS; } });
var mediaServer_js_1 = require("./mediaserver/mediaServer.js");
Object.defineProperty(exports, "UpnpMediaServer", { enumerable: true, get: function () { return mediaServer_js_1.UpnpMediaServer; } });
Object.defineProperty(exports, "ROOT_OBJECT_ID", { enumerable: true, get: function () { return mediaServer_js_1.ROOT_OBJECT_ID; } });
Object.defineProperty(exports, "MEDIA_SERVER_PATHS", { enumerable: true, get: function () { return mediaServer_js_1.MEDIA_SERVER_PATHS; } });
Object.defineProperty(exports, "parseSearchCriteria", { enumerable: true, get: function () { return mediaServer_js_1.parseSearchCriteria; } });
var controlPoint_js_1 = require("./controlpoint/controlPoint.js");
Object.defineProperty(exports, "DlnaControlPoint", { enumerable: true, get: function () { return controlPoint_js_1.DlnaControlPoint; } });
Object.defineProperty(exports, "parseSinkContentTypes", { enumerable: true, get: function () { return controlPoint_js_1.parseSinkContentTypes; } });
// ── Control-point discovery ─────────────────────────────────────────────────────
var discovery_js_1 = require("./controlpoint/discovery.js");
Object.defineProperty(exports, "resolveDlnaEndpoints", { enumerable: true, get: function () { return discovery_js_1.resolveDlnaEndpoints; } });
Object.defineProperty(exports, "discoverDlnaDevices", { enumerable: true, get: function () { return discovery_js_1.discoverDlnaDevices; } });
// ── GENA eventing ───────────────────────────────────────────────────────────────
var eventSubscriber_js_1 = require("./gena/eventSubscriber.js");
Object.defineProperty(exports, "DlnaEventSubscriber", { enumerable: true, get: function () { return eventSubscriber_js_1.DlnaEventSubscriber; } });
// ── DIDL-Lite (neutral content model) ───────────────────────────────────────────
var didl_js_1 = require("./didl/didl.js");
Object.defineProperty(exports, "buildContainerElement", { enumerable: true, get: function () { return didl_js_1.buildContainerElement; } });
Object.defineProperty(exports, "buildItemElement", { enumerable: true, get: function () { return didl_js_1.buildItemElement; } });
Object.defineProperty(exports, "wrapDidl", { enumerable: true, get: function () { return didl_js_1.wrapDidl; } });
Object.defineProperty(exports, "buildDidl", { enumerable: true, get: function () { return didl_js_1.buildDidl; } });
Object.defineProperty(exports, "readDidlField", { enumerable: true, get: function () { return didl_js_1.readDidlField; } });
Object.defineProperty(exports, "readDidlDuration", { enumerable: true, get: function () { return didl_js_1.readDidlDuration; } });
Object.defineProperty(exports, "parseDidlObject", { enumerable: true, get: function () { return didl_js_1.parseDidlObject; } });
// ── Device + service descriptions ───────────────────────────────────────────────
var deviceDescription_js_1 = require("./description/deviceDescription.js");
Object.defineProperty(exports, "buildDeviceDescription", { enumerable: true, get: function () { return deviceDescription_js_1.buildDeviceDescription; } });
Object.defineProperty(exports, "SERVICE_TYPES", { enumerable: true, get: function () { return deviceDescription_js_1.SERVICE_TYPES; } });
Object.defineProperty(exports, "DEVICE_TYPES", { enumerable: true, get: function () { return deviceDescription_js_1.DEVICE_TYPES; } });
var scpd_js_1 = require("./description/scpd.js");
Object.defineProperty(exports, "CONTENT_DIRECTORY_SCPD", { enumerable: true, get: function () { return scpd_js_1.CONTENT_DIRECTORY_SCPD; } });
Object.defineProperty(exports, "CONNECTION_MANAGER_SCPD", { enumerable: true, get: function () { return scpd_js_1.CONNECTION_MANAGER_SCPD; } });
Object.defineProperty(exports, "CONNECTION_MANAGER_SINK_SCPD", { enumerable: true, get: function () { return scpd_js_1.CONNECTION_MANAGER_SINK_SCPD; } });
Object.defineProperty(exports, "AV_TRANSPORT_SCPD", { enumerable: true, get: function () { return scpd_js_1.AV_TRANSPORT_SCPD; } });
Object.defineProperty(exports, "RENDERING_CONTROL_SCPD", { enumerable: true, get: function () { return scpd_js_1.RENDERING_CONTROL_SCPD; } });
// ── SOAP primitives ─────────────────────────────────────────────────────────────
var soap_js_1 = require("./soap/soap.js");
Object.defineProperty(exports, "escapeXml", { enumerable: true, get: function () { return soap_js_1.escapeXml; } });
Object.defineProperty(exports, "unescapeXml", { enumerable: true, get: function () { return soap_js_1.unescapeXml; } });
Object.defineProperty(exports, "parseSoapAction", { enumerable: true, get: function () { return soap_js_1.parseSoapAction; } });
Object.defineProperty(exports, "extractTag", { enumerable: true, get: function () { return soap_js_1.extractTag; } });
Object.defineProperty(exports, "buildSoapResponse", { enumerable: true, get: function () { return soap_js_1.buildSoapResponse; } });
Object.defineProperty(exports, "buildSoapRequest", { enumerable: true, get: function () { return soap_js_1.buildSoapRequest; } });
Object.defineProperty(exports, "buildSoapFault", { enumerable: true, get: function () { return soap_js_1.buildSoapFault; } });
Object.defineProperty(exports, "extractFaultCode", { enumerable: true, get: function () { return soap_js_1.extractFaultCode; } });
// ── ID3 (for server-side stream tagging) ────────────────────────────────────────
var id3_js_1 = require("./media/id3.js");
Object.defineProperty(exports, "buildId3v2Tag", { enumerable: true, get: function () { return id3_js_1.buildId3v2Tag; } });
