import { formatCommand } from '@/adapters/loxone/commands/utils/commandFormatter';

/**
 * What the Miniserver has done so far, kept in memory for the admin screen.
 *
 * Pairing has several places to stop silently: the Miniserver never connects,
 * the handshake ends early, it decides the project was already sent, or it sends
 * one for another serial. Each step lands here so the screen can say which.
 */
export type LoxonePairingStep = {
  at: number;
  port: 'appHttp' | 'msHttp' | 'gateway';
  remote: string | null;
  command: string;
};

export type LoxonePairingSnapshot = {
  running: boolean;
  listeners: Array<{ name: string; port: number; ok: boolean; error: string | null; at: number }>;
  udp: { ok: boolean; error: string | null; lastProbeAt: number | null; lastProbeFrom: string | null };
  startError: string | null;
  lastConnection: { at: number; port: string; remote: string | null } | null;
  lastGetConfig: { at: number; crc32: string | null } | null;
  lastSetConfig: {
    at: number;
    serial: string | null;
    serials: string[];
    matched: boolean;
    adopted: boolean;
  } | null;
  lastSetConfigError: { at: number; reason: string } | null;
  steps: LoxonePairingStep[];
  /**
   * Commands nothing here answers, newest last.
   *
   * The Tree Turbo search and a few other Config actions are not documented anywhere. Whatever
   * the Miniserver sends for them lands here, which is the only way to learn what they are.
   */
  unhandled: Array<{ at: number; command: string; count: number }>;
  /**
   * Everything that reaches this server for a short while, on every port.
   *
   * Started from the Loxone window, so a Config action can be run while it records. The Tree
   * Turbo search sends nothing the Miniserver channel does not already answer, so the question
   * is what it does send, and where.
   */
  capture: { until: number | null; entries: LoxoneCaptureEntry[] };
};

export type LoxoneCaptureEntry = { at: number; source: string; remote: string | null; detail: string };

const MAX_STEPS = 40;
const MAX_UNHANDLED = 20;
const MAX_CAPTURE = 400;
const MAX_CAPTURE_MS = 5 * 60_000;

// Commands the Miniserver sends while pairing. The app sends many others on the
// same ports; those do not say anything about pairing.
const PAIRING_COMMAND = /^\/?(secure\/|audio\/cfg\/(getconfig|setconfig|ready|miniservertime|miniserverip|miniserverversion|identify|mac|getkey$|diagcmd))/;

class LoxonePairingMonitor {
  private state: LoxonePairingSnapshot = LoxonePairingMonitor.empty();

  private static empty(): LoxonePairingSnapshot {
    return {
      running: false,
      listeners: [],
      udp: { ok: false, error: null, lastProbeAt: null, lastProbeFrom: null },
      startError: null,
      lastConnection: null,
      lastGetConfig: null,
      lastSetConfig: null,
      lastSetConfigError: null,
      steps: [],
      unhandled: [],
      capture: { until: null, entries: [] },
    };
  }

  public startCapture(durationMs: number): void {
    const ms = Math.max(10_000, Math.min(MAX_CAPTURE_MS, durationMs));
    this.state.capture = { until: Date.now() + ms, entries: [] };
  }

  public stopCapture(): void {
    this.state.capture = { ...this.state.capture, until: null };
  }

  public get capturing(): boolean {
    const until = this.state.capture.until;
    return until !== null && Date.now() < until;
  }

  public record(source: string, remote: string | null, detail: string): void {
    if (!this.capturing) {
      return;
    }
    const entry = { at: Date.now(), source, remote, detail: detail.slice(0, 600) };
    this.state.capture.entries = [...this.state.capture.entries, entry].slice(-MAX_CAPTURE);
  }

  public unhandled(command: string): void {
    const described = describeCommand(command.replace(/^\/+/, ''));
    const existing = this.state.unhandled.find((entry) => entry.command === described);
    const rest = this.state.unhandled.filter((entry) => entry.command !== described);
    const entry = { at: Date.now(), command: described, count: (existing?.count ?? 0) + 1 };
    this.state.unhandled = [...rest, entry].slice(-MAX_UNHANDLED);
  }

  public reset(): void {
    this.state = LoxonePairingMonitor.empty();
  }

  public listener(name: string, port: number, error?: unknown): void {
    const entry = {
      name,
      port,
      ok: !error,
      error: error ? describe(error) : null,
      at: Date.now(),
    };
    this.state.listeners = [...this.state.listeners.filter((l) => l.name !== name), entry];
  }

  public udpBound(error?: unknown): void {
    this.state.udp = { ...this.state.udp, ok: !error, error: error ? describe(error) : null };
  }

  public udpProbe(from: string, payload?: Buffer): void {
    this.state.udp = { ...this.state.udp, lastProbeAt: Date.now(), lastProbeFrom: from };
    if (payload) {
      this.record('udp 7070', from, describePayload(payload));
    }
  }

  public started(): void {
    this.state.running = true;
    this.state.startError = null;
  }

  public startFailed(error: unknown): void {
    this.state.running = false;
    this.state.startError = describe(error);
  }

  public stopped(): void {
    this.state.running = false;
  }

  public connection(port: 'appHttp' | 'msHttp', remote: string | null): void {
    this.record(port, remote, 'websocket connected');
    if (port !== 'msHttp') {
      return;
    }
    this.state.lastConnection = { at: Date.now(), port, remote };
  }

  public command(port: LoxonePairingStep['port'], remote: string | null, command: string): void {
    this.record(port, remote, describeCommand(command.replace(/^\/+/, '')));
    if (port !== 'msHttp' && !PAIRING_COMMAND.test(command)) {
      return;
    }
    const step = { at: Date.now(), port, remote, command: describeCommand(command.replace(/^\/+/, '')) };
    this.state.steps = [...this.state.steps, step].slice(-MAX_STEPS);
    if (port === 'msHttp' || /^\/?secure\//.test(command)) {
      this.state.lastConnection = this.state.lastConnection ?? { at: step.at, port, remote };
    }
  }

  public getConfig(crc32: string | null): void {
    this.state.lastGetConfig = { at: Date.now(), crc32 };
  }

  public setConfig(result: { serial: string | null; serials: string[]; matched: boolean; adopted: boolean }): void {
    this.state.lastSetConfig = { at: Date.now(), ...result };
    this.state.lastSetConfigError = null;
  }

  public setConfigFailed(reason: string): void {
    this.state.lastSetConfigError = { at: Date.now(), reason };
  }

  public snapshot(): LoxonePairingSnapshot {
    return structuredClone(this.state);
  }
}

/** The handshake payloads are secrets, so only their shape is kept: segment lengths and encoding. */
function describeCommand(command: string): string {
  const match = /^(secure\/(?:hello|init|authenticate))\/(.+)$/.exec(command);
  if (!match?.[1] || !match[2]) {
    return formatCommand(command);
  }
  const segments = match[2].split('/');
  const lengths = segments.map((segment) => segment.length).join('/');
  const encoded = /%[0-9a-f]{2}/i.test(match[2]) ? ', url-encoded' : '';
  return `${match[1]}/[${segments.length} segment(s), ${lengths} chars${encoded}]`;
}

/** Text when it reads as text, otherwise the first bytes in hex. */
export function describePayload(payload: Buffer): string {
  const text = payload.toString('utf8');
  const printable = /^[\x20-\x7e\t\r\n\u00a0-\uffff]*$/.test(text) && !text.includes('\ufffd');
  if (printable && text.trim()) {
    return text.trim();
  }
  const head = payload.subarray(0, 64).toString('hex').replace(/(..)/g, '$1 ').trim();
  return `${payload.length} bytes: ${head}${payload.length > 64 ? ' …' : ''}`;
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    const message = error instanceof Error ? error.message : '';
    return message ? `${error.code}: ${message}` : error.code;
  }
  return error instanceof Error ? error.message : String(error);
}

export const loxonePairingMonitor = new LoxonePairingMonitor();
