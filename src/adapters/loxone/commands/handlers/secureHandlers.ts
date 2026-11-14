import { buildResponse } from '@/adapters/loxone/commands/responses';
import type { CommandResult, HandlerFn } from '@/adapters/loxone/commands/types';
import {
  loxoneServerPublicKeyPem,
  signLoxoneSessionJwt,
} from '@/adapters/loxone/commands/handlers/configHandlers';
import type { ConfigPort } from '@/ports/ConfigPort';

/**
 * Implements the "secure/*" bootstrap endpoints expected by Loxone clients.
 */
export function createSecureHandlers(configPort: ConfigPort, sessionToken: string) {
  return {
    hello: createHandler((command) => {
      return buildResponse(command, 'secure_hello', {
        command: 'secure/hello',
        error: 0,
        // The client's own key used to be echoed back, so it could never open a
        // session against this server.
        public_key: loxoneServerPublicKeyPem(),
      });
    }),
    infoPairing: createHandler((command) => {
      const master = resolveMasterIdentifier(configPort);
      return {
        command,
        name: 'secure_infopairing',
        payload: {
          command: 'secure/infopairing',
          // -81 is "no Miniserver yet". Once we know the master, the answer is success.
          error: master ? 0 : -81,
          master,
          peers: [],
        },
        raw: true,
      };
    }),
    authenticate: createHandler((command) =>
      buildResponse(command, 'authenticate', 'authentication successful'),
    ),
    init: createHandler((command) =>
      buildResponse(command, 'secure_init', {
        command: 'secure/init',
        error: 0,
        jwt: signLoxoneSessionJwt(sessionToken),
      }),
    ),
  };
}

function createHandler(fn: (command: string) => CommandResult): HandlerFn {
  return (command) => fn(command);
}

function resolveMasterIdentifier(configPort: ConfigPort): string {
  try {
    const serial = configPort.getSystemConfig().miniserver.serial?.trim();
    return serial ? serial.toUpperCase() : '';
  } catch {
    return '';
  }
}
