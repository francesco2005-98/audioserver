import { networkInterfaces } from 'node:os';

const EMPTY_MAC = '00:00:00:00:00:00';
export const DEFAULT_MAC_ID = '504F94FF1BB3';

export function normalizeMacId(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const cleaned = trimmed.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  return cleaned || null;
}

// Bridges and container links. Their MACs are random per container or host
// setup, so a serial taken from them does not survive a redeploy.
const VIRTUAL_INTERFACE = /^(docker|br-|veth|virbr|cni|flannel|cali|vxlan|tun|tap|wg|zt|tailscale|lxc|podman)/i;

export function resolveLocalMacId(): string | null {
  let nets: ReturnType<typeof networkInterfaces>;
  try {
    nets = networkInterfaces();
  } catch {
    // Some restricted runtimes (tests/containers) can throw here; fall back to null.
    return null;
  }
  const candidates: Array<{ mac: string; physical: boolean; ipv4: boolean }> = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (!net || net.internal) {
        continue;
      }
      if (!net.mac || net.mac === EMPTY_MAC) {
        continue;
      }
      const normalized = normalizeMacId(net.mac);
      if (normalized) {
        candidates.push({
          mac: normalized,
          physical: !VIRTUAL_INTERFACE.test(name),
          ipv4: net.family === 'IPv4',
        });
      }
    }
  }
  const best =
    candidates.find((c) => c.physical && c.ipv4) ??
    candidates.find((c) => c.physical) ??
    candidates[0];
  return best?.mac ?? null;
}

export function defaultMacId(): string {
  return resolveLocalMacId() ?? DEFAULT_MAC_ID;
}
