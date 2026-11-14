import { MdnsDiscovery } from './discovery/mdnsDiscovery.js';
import { CastDevice } from './core/CastDevice.js';
export { CastDevice } from './core/CastDevice.js';
export { ReceiverController } from './controllers/receiverController.js';
export { MediaController } from './controllers/mediaController.js';
export { VolumeController } from './controllers/volumeController.js';
export { BaseController } from './controllers/baseController.js';
export { ConnectionController } from './controllers/connectionController.js';
export { MdnsDiscovery } from './discovery/mdnsDiscovery.js';
export { Namespaces } from './protocol/namespaces.js';
export { CastStatusModel, MediaStatusModel, MediaCommandFlags } from './core/models.js';
export * from './utils/errors.js';
export const discoverChromecasts = async (options = {}) => {
    const discovery = new MdnsDiscovery(options);
    discovery.start();
    return {
        devices: discovery.getDevices(),
        stop: async () => discovery.stop(),
    };
};
export const connect = async (device, options = {}) => {
    const castDevice = new CastDevice({ device, host: device.host, port: device.port, ...options });
    await castDevice.connect();
    return castDevice;
};
