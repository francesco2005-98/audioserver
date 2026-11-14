import { TypedEventEmitter } from '../utils/eventMap.js';
import { CastChannel } from '../transport/castChannel.js';
import { ControllerRegistry } from './ControllerRegistry.js';
import { ConnectionController } from '../controllers/connectionController.js';
import { ReceiverController } from '../controllers/receiverController.js';
import { MediaController } from '../controllers/mediaController.js';
import { VolumeController } from '../controllers/volumeController.js';
import { Namespaces } from '../protocol/namespaces.js';
import { ProtocolError } from '../utils/errors.js';
export class CastDevice extends TypedEventEmitter {
    options;
    channel;
    registry = new ControllerRegistry();
    connectionController;
    receiverController;
    volumeController;
    mediaController;
    session;
    constructor(options) {
        super();
        this.options = options;
        this.channel = new CastChannel(options);
        this.connectionController = new ConnectionController(this.channel);
        this.receiverController = new ReceiverController(this.channel);
        this.volumeController = new VolumeController(this.channel);
        this.mediaController = new MediaController(this.channel);
        this.registry.register(this.connectionController);
        this.registry.register(this.receiverController);
        this.registry.register(this.volumeController);
        this.registry.register(this.mediaController);
        this.receiverController.on('status', (status) => this.handleReceiverStatus(status));
        this.receiverController.on('castStatus', (status) => {
            this.emit('castStatus', status);
        });
        this.volumeController.on('volume', (volume) => {
            this.emit('volumeChanged', volume);
        });
        this.mediaController.on('status', (status) => {
            this.emit('mediaStatus', status);
        });
        this.mediaController.on('statusModel', (status) => {
            this.emit('mediaStatusModel', status);
        });
        this.channel.on('message', (payload, parsed) => {
            const controller = this.registry.get(payload.namespace);
            if (controller) {
                controller.handleMessage(parsed);
            }
        });
        this.channel.on('connected', () => this.emit('connected'));
        this.channel.on('disconnected', (error) => this.emit('disconnected', error));
        this.channel.on('error', (error) => this.emit('error', error));
        this.channel.on('stateChanged', (state) => this.emit('connectionState', state));
    }
    get id() {
        return this.options.device.id;
    }
    get name() {
        return this.options.device.name;
    }
    get host() {
        return this.options.device.host;
    }
    get port() {
        return this.options.device.port;
    }
    get receiver() {
        return this.receiverController;
    }
    get media() {
        return this.mediaController;
    }
    get volume() {
        return this.volumeController;
    }
    async connect() {
        await this.channel.connect();
        await this.connectionController.connect();
        await this.receiverController.getStatus();
    }
    async disconnect() {
        try {
            await this.connectionController.disconnect();
        }
        catch {
            // Ignore connection close errors during shutdown.
        }
        await this.channel.disconnect();
    }
    addController(controller) {
        this.registry.register(controller);
    }
    addAppController(namespace, factory) {
        if (!this.session?.transportId) {
            throw new ProtocolError('No active session; launch app first');
        }
        if (this.registry.get(namespace)) {
            throw new ProtocolError(`Controller already registered for namespace ${namespace}`);
        }
        const controller = factory(this.channel, this.session.transportId);
        this.registry.register(controller);
        return controller;
    }
    async launchApp(appId, timeoutMs = 10000) {
        const status = await this.receiverController.launch(appId, timeoutMs);
        this.handleReceiverStatus(status);
        if (!this.session) {
            throw new ProtocolError('Failed to start session');
        }
        return this.session;
    }
    getSession() {
        return this.session;
    }
    async getCastStatus(timeoutMs = 5000) {
        return this.receiverController.getCastStatus(timeoutMs);
    }
    async getMediaStatusModel(timeoutMs = 5000) {
        return this.mediaController.getStatusModel(timeoutMs);
    }
    handleReceiverStatus(status) {
        this.emit('receiverStatus', status);
        const app = status.status.applications?.[0];
        if (app) {
            const session = {
                appId: app.appId,
                sessionId: app.sessionId,
                transportId: app.transportId,
            };
            if (app.displayName !== undefined) {
                session.displayName = app.displayName;
            }
            if (app.statusText !== undefined) {
                session.statusText = app.statusText;
            }
            this.session = session;
            // Ensure the app transportId is connected so media/app requests are accepted.
            void this.channel.sendJson(Namespaces.CONNECTION, 'sender-0', app.transportId, {
                type: 'CONNECT',
            });
            if (this.mediaController && app.transportId !== this.mediaController.getDestinationId()) {
                this.mediaController = new MediaController(this.channel, app.transportId);
                this.registry.register(this.mediaController);
                this.mediaController.on('status', (mediaStatus) => {
                    this.emit('mediaStatus', mediaStatus);
                });
                this.mediaController.on('statusModel', (mediaStatus) => {
                    this.emit('mediaStatusModel', mediaStatus);
                });
            }
        }
    }
}
