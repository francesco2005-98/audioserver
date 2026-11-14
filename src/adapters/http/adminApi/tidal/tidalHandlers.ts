import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ConfigPort } from '@/ports/ConfigPort';
import type { ComponentLogger } from '@/shared/logging/logger';
import type { Route } from '@/adapters/http/adminApi/routeTypes';
import {
  describeTidalClient,
  discardTidalLogin,
  readTidalLogin,
  resolveTidalClient,
  startTidalDeviceLogin,
} from '@/adapters/content/providers/tidal/tidalLogin';

export type TidalHandlerDeps = {
  log: ComponentLogger;
  configPort: ConfigPort;
  readJsonBody: (req: IncomingMessage, res: ServerResponse) => Promise<unknown>;
  sendJson: (res: ServerResponse, status: number, body: unknown) => void;
};

/**
 * Device sign-in for a Tidal account.
 *
 * Saving the account is the ordinary streaming-service route: it collects the
 * finished login id this flow produced.
 */
export function buildTidalRoutes(deps: TidalHandlerDeps): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/tidal\/client$/,
      handler: (_req, res) => deps.sendJson(res, 200, describeTidalClient()),
    },
    {
      method: 'POST',
      pattern: /^\/tidal\/login\/start$/,
      handler: async (req, res) => {
        const body = (await deps.readJsonBody(req, res)) as {
          clientId?: unknown;
          clientSecret?: unknown;
        } | null;
        if (res.writableEnded) return;
        const client = resolveTidalClient({
          clientId: typeof body?.clientId === 'string' ? body.clientId : undefined,
          clientSecret: typeof body?.clientSecret === 'string' ? body.clientSecret : undefined,
        });
        if (!client) {
          deps.sendJson(res, 400, {
            error: 'tidal-client-required',
            message: 'Enter a Tidal client id and secret, or set them in the server environment.',
          });
          return;
        }
        try {
          const started = await startTidalDeviceLogin(client);
          if (!started.ok) {
            deps.sendJson(res, 400, { error: 'tidal-login-failed', message: started.message });
            return;
          }
          deps.sendJson(res, 200, started);
        } catch (err) {
          deps.log.warn('tidal login start failed', {
            message: err instanceof Error ? err.message : String(err),
          });
          deps.sendJson(res, 502, {
            error: 'tidal-login-failed',
            message: 'Tidal could not be reached. Try again.',
          });
        }
      },
    },
    {
      method: 'GET',
      pattern: /^\/tidal\/login\/status$/,
      handler: async (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        const loginId = url.searchParams.get('loginId')?.trim() ?? '';
        if (!loginId) {
          deps.sendJson(res, 400, { error: 'invalid-payload', message: 'Missing login id.' });
          return;
        }
        try {
          deps.sendJson(res, 200, await readTidalLogin(loginId));
        } catch (err) {
          deps.log.warn('tidal login status failed', {
            message: err instanceof Error ? err.message : String(err),
          });
          deps.sendJson(res, 502, {
            state: 'error',
            error: 'tidal-login-failed',
            message: 'Tidal could not be reached. Try again.',
          });
        }
      },
    },
    {
      method: 'POST',
      pattern: /^\/tidal\/logout$/,
      handler: async (req, res) => {
        const body = (await deps.readJsonBody(req, res)) as { loginId?: unknown; serviceId?: unknown } | null;
        if (res.writableEnded) return;
        if (typeof body?.loginId === 'string' && body.loginId.trim()) {
          discardTidalLogin(body.loginId.trim());
        }
        const serviceId = typeof body?.serviceId === 'string' ? body.serviceId.trim() : '';
        if (serviceId) {
          await deps.configPort.updateConfig((cfg) => {
            const services = cfg.content?.streamingServices ?? [];
            const found = services.find((service) => service.id?.toLowerCase() === serviceId.toLowerCase());
            if (!found) return;
            delete found.tidalAccessToken;
            delete found.tidalRefreshToken;
            delete found.tidalTokenExpiresAt;
            delete found.tidal;
          });
        }
        deps.sendJson(res, 204, {});
      },
    },
  ];
}
