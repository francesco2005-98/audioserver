import React from 'react';
import { useTranslation } from 'react-i18next';
// Sits inside Setup, so it wears Setup's form language (inputs, toggles, buttons). The tiles, the
// dialog and its rows are its own — and deliberately shaped like the Zones screen's.
import './SetupView.css';
import './AudioserverClientsSection.css';
import {
  listAudioserverClients,
  saveAudioserverClient,
  forgetAudioserverClient,
  claimAudioserverClient,
  setAudioserverClientVersion,
  sendAudioserverClientCommand,
  fetchAudioserverClientLogs,
  CLIENT_COMPONENT,
  nextClientId,
  cardLabel,
  cardName,
  cardSpec,
  splitCards,
  AudioserverClientError,
  type AudioserverCard,
  type AudioserverClientsResponse,
  type AudioserverDeviceView,
  type AudioserverPlayerConfig,
  type AudioserverPlayerStatus,
  type AudioserverSourceConfig,
  type AudioserverSourceStatus,
  type AudioserverBeoremoteConfig,
  type AudioserverDeviceLogs,
} from '../services/audioserverClientsApi';
import { getConfig } from '../services/setupApi';
import { useGlobalAlert } from '../components/GlobalAlert';
import { useUpdateCheck } from '../components/UpdateCheckContext';
import { compareSemver } from '../services/updateCheck';
import { useConfirm } from '../components/ConfirmDialog';
import InlineState from '../components/InlineState';
import Modal from '../components/Modal';
import { copyText } from '../utils/clipboard';

/**
 * Audioserver Client devices, as a section of Setup.
 *
 * Audioserver Client is an appliance layer: install it on a Raspberry Pi (or comparable hardware) and the
 * machine stops being a computer with an audio program on it and becomes a player that does one
 * thing. Which is why every setting lives here rather than there — a device holds nothing but its
 * own identity.
 *
 * Tucked into Setup rather than the navigation because most installations never have one: a
 * top-level entry would advertise a feature that only matters once there is a Pi in a room. And
 * Setup rather than Content, because these are not another source of music — they are this
 * installation's own machinery.
 *
 * The shape is a tile per device and a dialog behind it, which is what Zones does with rooms. That
 * is not decoration: the previous version put every setting of every device on the page at once, so
 * one Pi with one speaker was two screens of scrolling and a second device pushed the first out of
 * sight. A tile answers the two questions someone actually arrives with — is it there, and what is
 * it doing — and the dialog holds the rest.
 *
 * Three things stay strictly apart, in the tile and in the dialog: what a device *is* (model,
 * address, version — read-only, it told us), what it is *doing* (live, never editable), and what it
 * *should be* (the forms, the only part that saves).
 *
 * Assigning a room is deliberately not here. A speaker becomes an ordinary output, so it is picked
 * on the Zones screen; this section's job ends at creating and naming it — and at *showing* which
 * room ended up with it, because an installation where that answer takes hunting is one where
 * nobody dares change anything.
 */

type Draft = {
  name: string;
  /** The room this box serves, or null when it stands on its own. */
  zoneId: number | null;
  players: AudioserverPlayerConfig[];
  sources: AudioserverSourceConfig[];
  beoremote: AudioserverBeoremoteConfig;
  requiredComponents: string[];
};

/** A room, as far as this screen needs to know one. */
type ZoneRef = { id: number; name: string };

/**
 * What the rest of the configuration already points at.
 *
 * The ids on this screen are stable, opaque strings — `audioserver-beosound9000-a01ec20a` — because a
 * zone's output holds one and renaming a room must not move the audio. Useful, and unreadable: so
 * every place a device is spoken for is resolved back to the name of the thing that spoke for it.
 */
type Usage = {
  /** Speaker client id → the room whose output it is. */
  players: Record<string, ZoneRef>;
  /** Input client id → the name of the line-in it feeds. */
  sources: Record<string, string>;
  /** Device id → the room using its Bluetooth radio. */
  bluetooth: Record<string, ZoneRef>;
  /** Device id → the room its Beoremote drives. */
  remotes: Record<string, ZoneRef>;
  /** Every room by id, so a number stored on a device can still be named. */
  zones: Record<number, string>;
};

const EMPTY_USAGE: Usage = { players: {}, sources: {}, bluetooth: {}, remotes: {}, zones: {} };

const REFRESH_MS = 5_000;
const INSTALL_COMMAND =
  'curl -fsSL https://raw.githubusercontent.com/audioserver/audioserver-client/main/install.sh | sudo bash';

/** Which panel of the device dialog is on screen. */
type View =
  | { kind: 'main' }
  | { kind: 'player'; clientId: string }
  | { kind: 'source'; clientId: string }
  | { kind: 'remote' }
  | { kind: 'about' };

function draftFrom(device: AudioserverDeviceView): Draft {
  const config = device.config;
  return {
    name: config?.name ?? '',
    zoneId: typeof config?.zoneId === 'number' ? config.zoneId : null,
    players: (config?.players ?? []).map((player) => ({ ...player })),
    sources: (config?.sources ?? []).map((source) => ({ ...source })),
    beoremote: { ...(config?.beoremote ?? {}) },
    requiredComponents: [...(config?.requiredComponents ?? [])],
  };
}

/**
 * What to send as the device's own remote entry.
 *
 * Which room a remote drives is a fact about the room, and the server reads it from there; the
 * device entry survives only for installations configured before that was true, plus the couple of
 * device-side details (which speaker the volume keys move) that still live here. So it is sent back
 * as it was found, and `enabled` is never raised on its own: the server refuses an enabled remote
 * with no room, which is exactly what a switch here could produce and nothing here could fix.
 */
function remotePayload(remote: AudioserverBeoremoteConfig): AudioserverBeoremoteConfig | null {
  const claimed = remote.enabled === true && typeof remote.zoneId === 'number';
  const carries =
    claimed ||
    Boolean(remote.volumePlayer) ||
    typeof remote.volumeStep === 'number' ||
    typeof remote.menuPollMs === 'number';
  return carries ? { ...remote, enabled: claimed } : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Read every reference to a Sendspin client or a Audioserver Client device out of the server config.
 *
 * Mirrors what the server itself checks before letting a device be forgotten, so the screen and the
 * refusal agree on what "in use" means.
 */
function readUsage(raw: unknown): Usage {
  const config = asRecord(asRecord(raw).config);
  const usage: Usage = { players: {}, sources: {}, bluetooth: {}, remotes: {}, zones: {} };

  const zones = Array.isArray(config.zones) ? config.zones : [];
  for (const entry of zones) {
    const zone = asRecord(entry);
    const id = Number(zone.id);
    if (!Number.isFinite(id)) continue;
    const ref: ZoneRef = { id, name: text(zone.name) || `Zone ${id}` };
    usage.zones[id] = ref.name;

    const outputs = [zone.output, ...(Array.isArray(zone.transports) ? zone.transports : [])];
    for (const candidate of outputs) {
      const output = asRecord(candidate);
      const clientId = text(output.clientId);
      if (clientId) usage.players[clientId] = ref;
      // Satellites are either bare client ids or objects carrying one.
      for (const satellite of Array.isArray(output.satellites) ? output.satellites : []) {
        const satelliteId =
          typeof satellite === 'string' ? satellite.trim() : text(asRecord(satellite).clientId);
        if (satelliteId) usage.players[satelliteId] = ref;
      }
    }

    const inputs = asRecord(zone.inputs);
    const bluetooth = asRecord(inputs.bluetooth);
    if (bluetooth.enabled !== false && text(bluetooth.deviceId)) {
      usage.bluetooth[text(bluetooth.deviceId)] = ref;
    }
    const remote = asRecord(inputs.beoremote);
    if (remote.enabled !== false && text(remote.deviceId)) {
      usage.remotes[text(remote.deviceId)] = ref;
    }
  }

  const lineIns = asRecord(asRecord(config.inputs).lineIn);
  for (const entry of Array.isArray(lineIns.inputs) ? lineIns.inputs : []) {
    const input = asRecord(entry);
    const source = asRecord(input.source);
    if (text(source.type).toLowerCase() !== 'sendspin') continue;
    const clientId = text(source.clientId) || text(source.client_id);
    if (clientId) usage.sources[clientId] = text(input.name) || clientId;
  }

  return usage;
}

type Translate = ReturnType<typeof useTranslation>['t'];

function deviceTitle(device: AudioserverDeviceView, t: Translate): string {
  return (
    device.config?.name?.trim() ||
    device.registration?.hostname?.trim() ||
    device.config?.hostname?.trim() ||
    t('audioserverClients.unnamed')
  );
}

/** A speaker's or input's name as the UI should show it: its own, else the card, else the id. */
function entryLabel(
  entry: { name?: string; output?: string; input?: string; clientId: string },
  cards: AudioserverCard[],
  t: Translate,
): string {
  const own = entry.name?.trim();
  if (own) return own;
  const cardId = entry.output ?? entry.input;
  const card = cards.find((candidate) => candidate.id === cardId);
  if (card) return cardName(card);
  if (cardId) return cardSpec(cardId);
  return t('audioserverClients.unnamedEntry');
}

/** How one speaker's live reading reads as a line of text. */
function playerReadout(status: AudioserverPlayerStatus | undefined, t: Translate): string[] {
  if (!status) return [];
  const parts = [t(`audioserverClients.states.${status.state}`, status.state)];
  if (status.codec) {
    const rate = status.sample_rate ? ` ${(status.sample_rate / 1000).toFixed(status.sample_rate % 1000 ? 1 : 0)} kHz` : '';
    const depth = status.bit_depth ? ` ${status.bit_depth} bit` : '';
    parts.push(`${status.codec.toUpperCase()}${rate}${depth}`);
  }
  if (typeof status.volume === 'number') parts.push(t('audioserverClients.volumeAt', { percent: status.volume }));
  if (typeof status.clock_rtt_ms === 'number') parts.push(t('audioserverClients.rtt', { ms: status.clock_rtt_ms.toFixed(1) }));
  if (status.last_error) parts.push(status.last_error);
  return parts;
}

function sourceReadout(status: AudioserverSourceStatus | undefined, t: Translate): string[] {
  if (!status) return [];
  const parts = [t(`audioserverClients.states.${status.state}`, status.state)];
  if (status.signal) parts.push(t(`audioserverClients.signal.${status.signal}`, status.signal));
  if (typeof status.level === 'number') parts.push(`${Math.round(status.level * 100)}%`);
  if (status.last_error) parts.push(status.last_error);
  return parts;
}

/** What a device is doing, in one line — the only question a tile has to answer at a glance. */
type Standing = { tone: 'playing' | 'ready' | 'quiet' | 'off'; title: string; detail: string };

function standingOf(device: AudioserverDeviceView, draft: Draft, t: Translate): Standing {
  // `enabled: false` is no longer something this screen offers to set — a box you are working on
  // gets unplugged, and a room that should be quiet is a room setting. It is still read, so a
  // config parked by an earlier build says so instead of looking broken.
  if (device.config?.enabled === false) {
    return { tone: 'off', title: t('audioserverClients.standing.offTitle'), detail: t('audioserverClients.standing.offDetail') };
  }
  if (!device.online) {
    return {
      tone: 'quiet',
      title: t('audioserverClients.standing.awayTitle'),
      detail: device.statusReceivedAt
        ? t('audioserverClients.lastSeen', { when: new Date(device.statusReceivedAt).toLocaleString() })
        : t('audioserverClients.neverSeen'),
    };
  }

  const players = device.status?.players ?? [];
  const sources = device.status?.sources ?? [];
  const playing = players.find((player) => player.state === 'streaming');
  if (playing) {
    return {
      tone: 'playing',
      // The state word is already the title; what is left is the format and the clock.
      detail: playerReadout(playing, t).slice(1).join(' · '),
      title: t('audioserverClients.standing.playingTitle'),
    };
  }
  const broken =
    players.find((player) => player.state === 'error' || player.last_error) ??
    sources.find((source) => source.state === 'error' || source.last_error);
  if (broken) {
    return {
      tone: 'quiet',
      title: t('audioserverClients.standing.problemTitle'),
      detail: broken.last_error ?? t('audioserverClients.standing.problemDetail'),
    };
  }
  if (draft.players.length === 0 && draft.sources.length === 0) {
    return {
      tone: 'quiet',
      title: t('audioserverClients.standing.bareTitle'),
      detail: t('audioserverClients.standing.bareDetail'),
    };
  }
  return {
    tone: 'ready',
    title: t('audioserverClients.standing.readyTitle'),
    // What it is set up to do, since it is not doing anything yet.
    detail: [
      draft.players.length ? t('audioserverClients.speakerCount', { count: draft.players.length }) : '',
      draft.sources.length ? t('audioserverClients.inputCount', { count: draft.sources.length }) : '',
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

/* ---------------------------------------------------------------- glyphs -- */

function SpeakerGlyph(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="2.5" width="14" height="19" rx="2.5" />
      <circle cx="12" cy="15" r="3.5" />
      <circle cx="12" cy="7" r="1.6" />
    </svg>
  );
}

function InputGlyph(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3v6a3 3 0 0 0 6 0V3" />
      <path d="M12 12v5" />
      <path d="M7.5 21h9" />
    </svg>
  );
}

function RemoteGlyph(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="7" y="2.5" width="10" height="19" rx="3" />
      <circle cx="12" cy="8" r="1.4" />
      <path d="M10 13h4M10 17h4" />
    </svg>
  );
}

function BluetoothGlyph(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 7l10 10-5 4V3l5 4L7 17" />
    </svg>
  );
}

function BoxGlyph(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M6 15h4" />
      <circle cx="17" cy="15" r="1.3" />
    </svg>
  );
}

/** A room: four walls, which is what a device is being asked to belong to. */
function RoomGlyph(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}

function Chevron(): JSX.Element {
  return (
    <svg className="audioserver-chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/* ------------------------------------------------------------- the screen -- */

export default function AudioserverClientsSection(): JSX.Element {
  const { t } = useTranslation();
  const { push } = useGlobalAlert();
  const { confirm } = useConfirm();
  // The same source the shell chip and the Setup screen read, so "update available" means one thing
  // everywhere rather than this screen having its own opinion.
  const { latest } = useUpdateCheck();

  const [data, setData] = React.useState<AudioserverClientsResponse | null>(null);
  const [usage, setUsage] = React.useState<Usage>(EMPTY_USAGE);
  const [error, setError] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  const [dirty, setDirty] = React.useState<Record<string, boolean>>({});
  const [saving, setSaving] = React.useState<Record<string, boolean>>({});
  const [publishing, setPublishing] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [view, setView] = React.useState<View>({ kind: 'main' });
  const [installOpen, setInstallOpen] = React.useState(false);

  // Read inside the refresh without making it a dependency, so polling does not restart on a
  // keystroke.
  const dirtyRef = React.useRef<Record<string, boolean>>({});
  React.useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const load = React.useCallback(async (): Promise<void> => {
    try {
      const response = await listAudioserverClients();
      setData(response);
      setError(null);
      // A device being edited keeps its draft: a refresh landing mid-edit that discarded typing
      // would make the poll interval feel like a bug.
      setDrafts((previous) => {
        const next = { ...previous };
        for (const device of response.devices) {
          if (!next[device.deviceId] || !dirtyRef.current[device.deviceId]) {
            next[device.deviceId] = draftFrom(device);
          }
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Which room holds which speaker changes on another screen, so it is read on arrival and after
  // anything here could have changed it — not on the status poll, which would be four requests a
  // minute for an answer that moves once a month.
  const loadUsage = React.useCallback(async (): Promise<void> => {
    try {
      setUsage(readUsage(await getConfig()));
    } catch {
      // Names are a courtesy here; without them the rows fall back to ids rather than the screen
      // failing to draw.
    }
  }, []);

  React.useEffect(() => {
    void load();
    void loadUsage();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load, loadUsage]);

  const devices = data?.devices ?? [];
  const open = openId ? (devices.find((device) => device.deviceId === openId) ?? null) : null;

  // A device forgotten in another browser tab must not leave an empty dialog behind.
  React.useEffect(() => {
    if (openId && data && !open) setOpenId(null);
  }, [openId, data, open]);

  const patch = (deviceId: string, change: Partial<Draft>): void => {
    setDrafts((previous) => ({
      ...previous,
      [deviceId]: { ...previous[deviceId], ...change } as Draft,
    }));
    setDirty((previous) => ({ ...previous, [deviceId]: true }));
  };

  const openDevice = (device: AudioserverDeviceView, next: View = { kind: 'main' }): void => {
    setDrafts((previous) => ({
      ...previous,
      [device.deviceId]: previous[device.deviceId] ?? draftFrom(device),
    }));
    setView(next);
    setOpenId(device.deviceId);
    void loadUsage();
  };

  const closeDevice = (): void => {
    setOpenId(null);
    setView({ kind: 'main' });
  };

  /** Drop the edits and close: the dialog is the only place that saves, so leaving means leaving. */
  const cancelDevice = (device: AudioserverDeviceView): void => {
    setDrafts((previous) => ({ ...previous, [device.deviceId]: draftFrom(device) }));
    setDirty((previous) => ({ ...previous, [device.deviceId]: false }));
    closeDevice();
  };

  const save = async (device: AudioserverDeviceView): Promise<void> => {
    const draft = drafts[device.deviceId];
    if (!draft) return;
    setSaving((previous) => ({ ...previous, [device.deviceId]: true }));
    try {
      await saveAudioserverClient(device.deviceId, {
        name: draft.name.trim() || undefined,
        zoneId: draft.zoneId,
        players: draft.players,
        sources: draft.sources,
        beoremote: remotePayload(draft.beoremote),
        requiredComponents: draft.requiredComponents,
      });
      setDirty((previous) => ({ ...previous, [device.deviceId]: false }));
      await load();
      void loadUsage();
      closeDevice();
      push({ tone: 'success', message: t('audioserverClients.saved') });
    } catch (err) {
      const code = err instanceof AudioserverClientError ? err.code : null;
      push({
        tone: 'error',
        message: code
          ? t(`audioserverClients.errors.${code}`, t('audioserverClients.errors.generic'))
          : t('audioserverClients.errors.generic'),
      });
    } finally {
      setSaving((previous) => ({ ...previous, [device.deviceId]: false }));
    }
  };

  /** Take on a speaker that is offering itself to more than one server. */
  const claim = async (device: AudioserverDeviceView): Promise<void> => {
    try {
      await claimAudioserverClient(device.deviceId);
      // Reload rather than patch: claiming turns a name and an address into a device with cards,
      // and what it looks like from here is the server's answer, not something to guess at.
      await load();
    } catch {
      push({ tone: 'error', message: t('audioserverClients.errors.generic') });
    }
  };

  /**
   * Hand a speaker back to whoever wants it.
   *
   * The same act as forgetting it — this server drops it — but said the way it will be used: the
   * device notices on its next poll, announces itself to every server again, and can be claimed on
   * another one. Refused while a room still plays through it, for the same reason forgetting is.
   */
  const move = async (device: AudioserverDeviceView): Promise<void> => {
    const ok = await confirm({
      title: t('audioserverClients.move.title'),
      message: t('audioserverClients.move.message', { name: deviceTitle(device, t) }),
      confirmLabel: t('audioserverClients.move.action'),
    });
    if (!ok) return;
    try {
      await forgetAudioserverClient(device.deviceId);
      closeDevice();
      await load();
    } catch (err) {
      if (err instanceof AudioserverClientError && err.code === 'device-in-use') {
        const rooms = err.clientIds
          .map((clientId) => usage.players[clientId]?.name ?? usage.sources[clientId] ?? clientId)
          .join(', ');
        push({ tone: 'error', message: t('audioserverClients.errors.deviceInUse', { ids: rooms }) });
        return;
      }
      push({ tone: 'error', message: t('audioserverClients.errors.generic') });
    }
  };

  const forget = async (device: AudioserverDeviceView): Promise<void> => {
    const ok = await confirm({
      title: t('audioserverClients.forgetTitle'),
      message: t('audioserverClients.forgetMessage', { name: deviceTitle(device, t) }),
      confirmLabel: t('audioserverClients.forget'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await forgetAudioserverClient(device.deviceId);
      closeDevice();
      await load();
    } catch (err) {
      if (err instanceof AudioserverClientError && err.code === 'device-in-use') {
        // Naming the rooms is the point: "in use" without them sends the user hunting.
        const rooms = err.clientIds
          .map((clientId) => usage.players[clientId]?.name ?? usage.sources[clientId] ?? clientId)
          .join(', ');
        push({ tone: 'error', message: t('audioserverClients.errors.deviceInUse', { ids: rooms }) });
        return;
      }
      push({ tone: 'error', message: t('audioserverClients.errors.generic') });
    }
  };

  const addPlayer = (device: AudioserverDeviceView): void => {
    const draft = drafts[device.deviceId] ?? draftFrom(device);
    const outputs = device.registration?.outputs ?? [];
    const { direct } = splitCards(outputs);
    const preselected = outputs.find((card) => card.is_default) ?? direct[0] ?? outputs[0];
    const clientId = nextClientId(withDraft(device, draft), 'player');
    setDrafts((previous) => ({
      ...previous,
      [device.deviceId]: {
        ...draft,
        players: [...draft.players, { clientId, output: preselected?.id, enabled: true }],
      },
    }));
    setDirty((previous) => ({ ...previous, [device.deviceId]: true }));
    setView({ kind: 'player', clientId });
    setOpenId(device.deviceId);
  };

  const addSource = (device: AudioserverDeviceView): void => {
    const draft = drafts[device.deviceId] ?? draftFrom(device);
    const inputs = device.registration?.inputs ?? [];
    const { direct } = splitCards(inputs);
    const preselected = inputs.find((card) => card.is_default) ?? direct[0] ?? inputs[0];
    const clientId = nextClientId(withDraft(device, draft), 'source');
    setDrafts((previous) => ({
      ...previous,
      [device.deviceId]: {
        ...draft,
        sources: [
          ...draft.sources,
          { clientId, input: preselected?.id, enabled: true, controls: ['activate', 'deactivate'] },
        ],
      },
    }));
    setDirty((previous) => ({ ...previous, [device.deviceId]: true }));
    setView({ kind: 'source', clientId });
    setOpenId(device.deviceId);
  };

  if (error && !data) {
    return <InlineState kind="error" title={t('audioserverClients.errors.loadFailed')} message={error} />;
  }

  const publishedVersion = data?.components?.find((entry) => entry.name === CLIENT_COMPONENT)?.version;

  // The oldest thing actually running, because that is what "speakers run X" has to mean when they
  // disagree — a park where one speaker stayed behind is exactly what this is for.
  const versions = devices
    .map((device) => device.registration?.version)
    .filter((version): version is string => Boolean(version));
  const oldestRunning = [...versions].sort((a, b) => compareSemver(a, b))[0];
  const newestRunning = [...versions].sort((a, b) => compareSemver(b, a))[0];
  // Offered when the newest published build is ahead of what is running, or of what was last set:
  // a version that has been set but not taken yet is still work in progress, not an update.
  const behind = (current: string | undefined): boolean =>
    Boolean(latest.audioserverClient && current && compareSemver(current, latest.audioserverClient) === -1);
  const updateTarget = behind(oldestRunning) || behind(publishedVersion) ? latest.audioserverClient : null;

  const publishVersion = async (version: string): Promise<void> => {
    setPublishing(true);
    try {
      await setAudioserverClientVersion(version);
      // Nothing is pushed: every speaker asks on its next poll and installs when it is not playing,
      // so the message says what will happen rather than claiming it has.
      push({ tone: 'info', message: t('audioserverClients.version.published', { version }) });
      await load();
    } catch (err) {
      const code = err instanceof AudioserverClientError ? err.code : '';
      push({
        tone: 'error',
        message: code.startsWith('no-artifact')
          ? t('audioserverClients.version.notPublished', { version })
          : t('audioserverClients.version.failed'),
      });
    } finally {
      setPublishing(false);
    }
  };

  const onlineCount = devices.filter((device) => device.online).length;

  return (
    <div className="audioserver-stack">
      {devices.length === 0 ? (
        /* Nothing has registered: the install line is the only thing to do, so it is the screen. */
        <section className="audioserver-empty">
          <p className="audioserver-empty__title">{t('audioserverClients.emptyTitle')}</p>
          <p className="audioserver-empty__body">{t('audioserverClients.emptyBody')}</p>
          <div className="audioserver-empty__cmd">
            <code className="audioserver-install">{INSTALL_COMMAND}</code>
            <div className="audioserver-install__row">
              <CopyCommandButton />
            </div>
          </div>
          <p className="audioserver-empty__body">{t('audioserverClients.emptyHint')}</p>
        </section>
      ) : (
        <>
          {/* The whole fleet in one line: how many there are, what they run, and the one action
              that applies to all of them at once. */}
          <section className={`audioserver-fleet${updateTarget ? ' audioserver-fleet--update' : ''}`}>
            <div className="audioserver-fleet__main">
              <span className="audioserver-fleet__title">
                {updateTarget
                  ? t('audioserverClients.version.available', { version: updateTarget })
                  : t('audioserverClients.fleet.title', { count: devices.length })}
              </span>
              <span className="audioserver-fleet__desc">
                {updateTarget
                  ? t('audioserverClients.version.hint')
                  : t('audioserverClients.fleet.desc', {
                      online: onlineCount,
                      count: devices.length,
                      version:
                        oldestRunning && oldestRunning !== newestRunning
                          ? `${oldestRunning}–${newestRunning}`
                          : (oldestRunning ?? '—'),
                    })}
              </span>
            </div>
            {/* Adding a device lives on the dashed tile below and nowhere else: two buttons for one
                thing, a hand's width apart, only makes someone wonder what the difference is. */}
            {updateTarget ? (
              <div className="audioserver-fleet__actions">
                <button
                  type="button"
                  className="setup-btn setup-btn--primary"
                  disabled={publishing}
                  onClick={() => void publishVersion(updateTarget)}
                >
                  {publishing ? t('audioserverClients.version.publishing') : t('audioserverClients.version.publish')}
                </button>
              </div>
            ) : null}
          </section>

          <div className="audioserver-grid">
            {devices.map((device) => (
              <DeviceTile
                key={device.deviceId}
                device={device}
                draft={drafts[device.deviceId] ?? draftFrom(device)}
                usage={usage}
                behind={behind(device.registration?.version)}
                onOpen={(next) => openDevice(device, next)}
                onAddPlayer={() => addPlayer(device)}
                onForget={() => void forget(device)}
                onClaim={() => void claim(device)}
                onMove={() => void move(device)}
              />
            ))}
            <button type="button" className="audioserver-add" onClick={() => setInstallOpen(true)}>
              <span className="audioserver-add__icon" aria-hidden="true">
                +
              </span>
              {t('audioserverClients.addTitle')}
            </button>
          </div>
        </>
      )}

      {open ? (
        <DeviceModal
          device={open}
          draft={drafts[open.deviceId] ?? draftFrom(open)}
          view={view}
          usage={usage}
          components={data?.components ?? []}
          dirty={Boolean(dirty[open.deviceId])}
          saving={Boolean(saving[open.deviceId])}
          onView={setView}
          onChange={(change) => patch(open.deviceId, change)}
          onAddPlayer={() => addPlayer(open)}
          onAddSource={() => addSource(open)}
          onForget={() => void forget(open)}
          onCancel={() => cancelDevice(open)}
          onSave={() => void save(open)}
        />
      ) : null}

      <InstallModal open={installOpen} onClose={() => setInstallOpen(false)} />
    </div>
  );
}

/** A device carrying the draft's speakers and inputs, for id allocation against unsaved edits. */
function withDraft(device: AudioserverDeviceView, draft: Draft): AudioserverDeviceView {
  return {
    ...device,
    config: {
      ...(device.config ?? { deviceId: device.deviceId }),
      players: draft.players,
      sources: draft.sources,
    },
  };
}

function CopyCommandButton(): JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      className="setup-btn"
      onClick={() => {
        void copyText(INSTALL_COMMAND);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? t('audioserverClients.copied') : t('audioserverClients.copyCommand')}
    </button>
  );
}

/* --------------------------------------------------------------- the tile -- */

/**
 * A speaker that can see this server and at least one other, and has not been given to either.
 *
 * Deliberately almost empty: one sentence about what it is, which servers it can see, and one
 * button. Everything a device page normally offers is a setting, and this speaker has none here
 * until somebody says it is ours.
 */
function UnclaimedTile({
  device,
  onClaim,
}: {
  device: AudioserverDeviceView;
  onClaim: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const elsewhere = (device.registration?.servers ?? [])
    .map((server) => server.name?.trim())
    .filter((name): name is string => Boolean(name));

  return (
    <article className="audioserver-tile is-idle">
      <header className="audioserver-tile__head">
        <span className={`audioserver-dot${device.online ? ' is-online' : ''}`} aria-hidden="true" />
        <div className="audioserver-tile__head-text">
          <div className="audioserver-tile__name">{deviceTitle(device, t)}</div>
          <div className="audioserver-tile__meta">
            {[device.registration?.ip, device.registration?.model].filter(Boolean).join(' · ')}
          </div>
        </div>
      </header>

      <div className="audioserver-hero is-quiet" style={{ cursor: 'default' }}>
        <span className="audioserver-hero__icon" aria-hidden="true">
          <SpeakerGlyph />
        </span>
        <span className="audioserver-hero__text">
          <span className="audioserver-hero__state">{t('audioserverClients.claim.title')}</span>
          <span className="audioserver-hero__detail">
            {elsewhere.length > 1
              ? t('audioserverClients.claim.sees', { servers: elsewhere.join(', ') })
              : t('audioserverClients.claim.detail')}
          </span>
        </span>
      </div>

      <footer className="audioserver-tile__foot">
        <button type="button" className="audioserver-tile__action" onClick={onClaim}>
          {t('audioserverClients.claim.action')}
        </button>
      </footer>
    </article>
  );
}

function DeviceTile({
  device,
  draft,
  usage,
  behind,
  onOpen,
  onAddPlayer,
  onForget,
  onClaim,
  onMove,
}: {
  device: AudioserverDeviceView;
  draft: Draft;
  usage: Usage;
  behind: boolean;
  onOpen: (view?: View) => void;
  onAddPlayer: () => void;
  onForget: () => void;
  onClaim: () => void;
  onMove: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  // Not ours yet. It found more than one server, so it is sitting on every one of their screens
  // waiting to be told whose it is. Nothing else on this tile applies: it has no settings here, and
  // offering to give it a room before it has been claimed would be offering to configure someone
  // else's speaker.
  if (device.claimed === false) {
    return <UnclaimedTile device={device} onClaim={onClaim} />;
  }
  const standing = standingOf(device, draft, t);
  const outputs = device.registration?.outputs ?? [];
  const inputs = device.registration?.inputs ?? [];
  const version = device.registration?.version ?? device.config?.version;

  const bluetoothZone = usage.bluetooth[device.deviceId];
  const bluetooth = device.status?.bluetooth;
  const phone = bluetooth?.devices?.find((entry) => entry.streaming) ?? bluetooth?.devices?.find((entry) => entry.connected);
  const remoteZone = usage.remotes[device.deviceId];
  const remoteState = device.status?.beoremote?.state;

  return (
    <article className={`audioserver-tile${standing.tone === 'quiet' ? ' is-idle' : ''}`}>
      <header className="audioserver-tile__head">
        <span className={`audioserver-dot${device.online ? ' is-online' : ''}`} aria-hidden="true" />
        <div className="audioserver-tile__head-text">
          <div className="audioserver-tile__name">{deviceTitle(device, t)}</div>
          {/* Address first: it is the half that gets used, and the model string is long enough to
              eat the line on its own. */}
          <div className="audioserver-tile__meta">
            {[device.registration?.ip ?? device.config?.ip, device.registration?.model ?? device.config?.model]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        {version ? (
          <span className={`audioserver-tile__ver${behind ? ' is-behind' : ''}`} title={behind ? t('audioserverClients.tile.behind') : undefined}>
            {version}
          </span>
        ) : null}
      </header>

      {/* What it is doing. Also the way in: the dialog behind it holds everything else. */}
      <button
        type="button"
        className={`audioserver-hero${standing.tone === 'playing' ? ' is-playing' : ''}${
          standing.tone === 'quiet' ? ' is-quiet' : ''
        }`}
        onClick={() => onOpen({ kind: 'main' })}
      >
        <span className="audioserver-hero__icon" aria-hidden="true">
          <SpeakerGlyph />
        </span>
        <span className="audioserver-hero__text">
          <span className="audioserver-hero__state">{standing.title}</span>
          {standing.detail ? <span className="audioserver-hero__detail">{standing.detail}</span> : null}
        </span>
        <Chevron />
      </button>

      {draft.players.length ? (
        <>
          <div className="audioserver-tile__label">{t('audioserverClients.players.title')}</div>
          {draft.players.map((player) => {
            const zone = usage.players[player.clientId];
            return (
              <button
                key={player.clientId}
                type="button"
                className="audioserver-tile__row"
                onClick={() => onOpen({ kind: 'player', clientId: player.clientId })}
              >
                <span className="audioserver-row__icon" aria-hidden="true">
                  <SpeakerGlyph />
                </span>
                <span className="audioserver-tile__row-text">
                  <span className="audioserver-tile__row-name">{entryLabel(player, outputs, t)}</span>
                  <span className={`audioserver-tile__row-sum${zone ? '' : ' audioserver-tile__row-sum--free'}`}>
                    {zone ? t('audioserverClients.usage.inRoom', { room: zone.name }) : t('audioserverClients.usage.noRoom')}
                  </span>
                </span>
                <Chevron />
              </button>
            );
          })}
        </>
      ) : (
        <button type="button" className="audioserver-tile__add" disabled={!outputs.length} onClick={onAddPlayer}>
          {outputs.length ? t('audioserverClients.players.add') : t('audioserverClients.players.noCards')}
        </button>
      )}

      {draft.sources.length ? (
        <>
          <div className="audioserver-tile__label">{t('audioserverClients.sources.title')}</div>
          {draft.sources.map((source) => {
            const lineIn = usage.sources[source.clientId];
            return (
              <button
                key={source.clientId}
                type="button"
                className="audioserver-tile__row"
                onClick={() => onOpen({ kind: 'source', clientId: source.clientId })}
              >
                <span className="audioserver-row__icon" aria-hidden="true">
                  <InputGlyph />
                </span>
                <span className="audioserver-tile__row-text">
                  <span className="audioserver-tile__row-name">{entryLabel(source, inputs, t)}</span>
                  <span className={`audioserver-tile__row-sum${lineIn ? '' : ' audioserver-tile__row-sum--free'}`}>
                    {lineIn
                      ? t('audioserverClients.usage.asLineIn', { name: lineIn })
                      : t('audioserverClients.usage.noLineIn')}
                  </span>
                </span>
                <Chevron />
              </button>
            );
          })}
        </>
      ) : null}

      {bluetoothZone || remoteZone || remoteState ? (
        <div className="audioserver-chips">
          {bluetoothZone ? (
            <span className={`audioserver-chip${phone ? ' is-on' : ''}`} title={phone?.name ?? bluetoothZone.name}>
              <span className="audioserver-chip__dot" aria-hidden="true" />
              {t('audioserverClients.bluetooth.chip', { room: bluetoothZone.name })}
            </span>
          ) : null}
          {remoteZone || remoteState ? (
            <span className={`audioserver-chip${remoteState === 'connected' ? ' is-on' : ''}${remoteState === 'error' ? ' is-warn' : ''}`}>
              <span className="audioserver-chip__dot" aria-hidden="true" />
              {remoteZone
                ? t('audioserverClients.remote.chip', { room: remoteZone.name })
                : t('audioserverClients.remote.label')}
            </span>
          ) : null}
        </div>
      ) : null}

      <footer className="audioserver-tile__foot">
        <button type="button" className="audioserver-tile__action" onClick={() => onOpen({ kind: 'main' })}>
          {t('audioserverClients.tile.settings')}
        </button>
        {/* Only where there is somewhere to move to: on a house with one server this would be a
            button that means nothing. */}
        {(device.registration?.servers?.length ?? 0) > 1 ? (
          <button type="button" className="audioserver-tile__action" onClick={onMove}>
            {t('audioserverClients.move.action')}
          </button>
        ) : null}
        <button type="button" className="audioserver-tile__action audioserver-tile__action--danger" onClick={onForget}>
          {t('audioserverClients.forget')}
        </button>
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------- the dialog -- */

function DeviceModal({
  device,
  draft,
  view,
  usage,
  components,
  dirty,
  saving,
  onView,
  onChange,
  onAddPlayer,
  onAddSource,
  onForget,
  onCancel,
  onSave,
}: {
  device: AudioserverDeviceView;
  draft: Draft;
  view: View;
  usage: Usage;
  components: AudioserverClientsResponse['components'];
  dirty: boolean;
  saving: boolean;
  onView: (view: View) => void;
  onChange: (change: Partial<Draft>) => void;
  onAddPlayer: () => void;
  onAddSource: () => void;
  onForget: () => void;
  onCancel: () => void;
  onSave: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const outputs = device.registration?.outputs ?? [];
  const inputs = device.registration?.inputs ?? [];

  const player = view.kind === 'player' ? draft.players.find((entry) => entry.clientId === view.clientId) : undefined;
  const source = view.kind === 'source' ? draft.sources.find((entry) => entry.clientId === view.clientId) : undefined;
  // A panel whose speaker was just removed falls back rather than showing an empty form.
  const resolved: View =
    (view.kind === 'player' && !player) || (view.kind === 'source' && !source) ? { kind: 'main' } : view;

  const heading = ((): { eyebrow: string; title: string; subtitle: React.ReactNode } => {
    if (resolved.kind === 'player' && player) {
      return {
        eyebrow: t('audioserverClients.players.eyebrow'),
        title: entryLabel(player, outputs, t),
        subtitle: usage.players[player.clientId]
          ? t('audioserverClients.usage.inRoom', { room: usage.players[player.clientId].name })
          : t('audioserverClients.usage.noRoom'),
      };
    }
    if (resolved.kind === 'source' && source) {
      return {
        eyebrow: t('audioserverClients.sources.eyebrow'),
        title: entryLabel(source, inputs, t),
        subtitle: usage.sources[source.clientId]
          ? t('audioserverClients.usage.asLineIn', { name: usage.sources[source.clientId] })
          : t('audioserverClients.usage.noLineIn'),
      };
    }
    if (resolved.kind === 'remote') {
      return {
        eyebrow: t('audioserverClients.remote.eyebrow'),
        title: t('audioserverClients.remote.title'),
        subtitle: t(
          `audioserverClients.remote.states.${device.status?.beoremote?.state ?? 'disabled'}`,
          device.status?.beoremote?.state ?? '',
        ),
      };
    }
    if (resolved.kind === 'about') {
      return {
        eyebrow: t('audioserverClients.about.eyebrow'),
        title: deviceTitle(device, t),
        subtitle: device.registration?.model ?? '',
      };
    }
    return {
      eyebrow: t('audioserverClients.eyebrow'),
      title: deviceTitle(device, t),
      subtitle: (
        <>
          <span className={device.online ? 'audioserver-modal__subtitle-on' : undefined}>
            {device.online ? t('audioserverClients.online') : t('audioserverClients.offline')}
          </span>
          {device.registration?.ip ? (
            <>
              {' '}
              <span className="audioserver-modal__sep">·</span> {device.registration.ip}
            </>
          ) : null}
          {device.registration?.version ? (
            <>
              {' '}
              <span className="audioserver-modal__sep">·</span> {device.registration.version}
            </>
          ) : null}
        </>
      ),
    };
  })();

  return (
    <Modal
      open
      onClose={onCancel}
      backdropClassName="audioserver-modal-backdrop"
      dialogClassName="audioserver-modal"
      ariaLabelledBy="audioserver-modal-title"
      closeOnBackdrop={!dirty}
    >
      <header className="audioserver-modal__head">
        {resolved.kind === 'main' ? null : (
          <button
            type="button"
            className="audioserver-modal__back"
            onClick={() => onView({ kind: 'main' })}
            aria-label={t('audioserverClients.back')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
        <div className="audioserver-modal__head-text">
          <p className="audioserver-modal__eyebrow">{heading.eyebrow}</p>
          <h3 id="audioserver-modal-title" className="audioserver-modal__title">
            {heading.title}
          </h3>
          <div className="audioserver-modal__subtitle">{heading.subtitle}</div>
        </div>
        <button
          type="button"
          className="audioserver-modal__close"
          onClick={onCancel}
          aria-label={t('audioserverClients.close')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      <div className="audioserver-modal__body">
        {resolved.kind === 'main' ? (
          <MainPanel
            device={device}
            draft={draft}
            usage={usage}
            onView={onView}
            onChange={onChange}
            onAddPlayer={onAddPlayer}
            onAddSource={onAddSource}
          />
        ) : null}
        {resolved.kind === 'player' && player ? (
          <PlayerPanel
            device={device}
            draft={draft}
            player={player}
            usage={usage}
            onChange={onChange}
            onDone={() => onView({ kind: 'main' })}
          />
        ) : null}
        {resolved.kind === 'source' && source ? (
          <SourcePanel
            device={device}
            draft={draft}
            source={source}
            usage={usage}
            onChange={onChange}
            onDone={() => onView({ kind: 'main' })}
          />
        ) : null}
        {resolved.kind === 'remote' ? (
          <RemotePanel
            device={device}
            draft={draft}
            usage={usage}
            components={components}
            onChange={onChange}
          />
        ) : null}
        {resolved.kind === 'about' ? <AboutPanel device={device} /> : null}
      </div>

      <footer className="audioserver-modal__foot">
        {resolved.kind === 'main' ? (
          <button type="button" className="audioserver-modal__btn audioserver-modal__btn--danger" onClick={onForget}>
            {t('audioserverClients.forget')}
          </button>
        ) : null}
        <button type="button" className="audioserver-modal__btn" onClick={onCancel}>
          {dirty ? t('audioserverClients.discard') : t('audioserverClients.close')}
        </button>
        <button
          type="button"
          className="audioserver-modal__btn audioserver-modal__btn--primary"
          disabled={!dirty || saving}
          onClick={onSave}
        >
          {saving ? t('audioserverClients.saving') : t('audioserverClients.save')}
        </button>
      </footer>
    </Modal>
  );
}

function MainPanel({
  device,
  draft,
  usage,
  onView,
  onChange,
  onAddPlayer,
  onAddSource,
}: {
  device: AudioserverDeviceView;
  draft: Draft;
  usage: Usage;
  onView: (view: View) => void;
  onChange: (change: Partial<Draft>) => void;
  onAddPlayer: () => void;
  onAddSource: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const outputs = device.registration?.outputs ?? [];
  const inputs = device.registration?.inputs ?? [];
  const bluetoothZone = usage.bluetooth[device.deviceId];
  const remoteZone = usage.remotes[device.deviceId];
  const remoteState = device.status?.beoremote?.state;

  return (
    <>
      {/* The first question, because answering it answers three others: a box that says which room
          it is becomes that room's speaker, its Bluetooth and its remote in one go. Standing on its
          own stays available for the two cases that need it — one box serving two rooms, and one at
          a turntable whose input any room can play. */}
      <div className="audioserver-group">
        <div className="audioserver-group__head">
          <span className="audioserver-group__label">{t('audioserverClients.group.room')}</span>
        </div>
        <div className="audioserver-row">
          <span className="audioserver-row__icon" aria-hidden="true">
            <RoomGlyph />
          </span>
          <span className="audioserver-row__text">
            <span className="audioserver-row__title">{t('audioserverClients.room.title')}</span>
            <span className="audioserver-row__desc">
              {draft.zoneId === null
                ? t('audioserverClients.room.standaloneDesc')
                : t('audioserverClients.room.claimedDesc')}
            </span>
          </span>
          <span className="audioserver-row__control">
            <select
              className="audioserver-select"
              aria-label={t('audioserverClients.room.title')}
              value={draft.zoneId === null ? '' : String(draft.zoneId)}
              onChange={(event) =>
                onChange({ zoneId: event.target.value ? Number(event.target.value) : null })
              }
            >
              <option value="">{t('audioserverClients.room.standalone')}</option>
              {Object.entries(usage.zones).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </span>
        </div>
      </div>

      <div className="audioserver-group">
        <div className="audioserver-group__head">
          <span className="audioserver-group__label">{t('audioserverClients.group.device')}</span>
        </div>
        <div className="audioserver-row">
          <span className="audioserver-row__icon" aria-hidden="true">
            <BoxGlyph />
          </span>
          <span className="audioserver-row__text">
            <span className="audioserver-row__title">{t('audioserverClients.deviceName')}</span>
            <span className="audioserver-row__desc">{t('audioserverClients.deviceNameDesc')}</span>
          </span>
          <span className="audioserver-row__control">
            <div className="setup-input" style={{ minWidth: 200 }}>
              <input
                type="text"
                value={draft.name}
                placeholder={device.registration?.hostname ?? ''}
                onChange={(event) => onChange({ name: event.target.value })}
              />
            </div>
          </span>
        </div>
      </div>

      <div className="audioserver-group">
        <div className="audioserver-group__head">
          <span className="audioserver-group__label">{t('audioserverClients.players.title')}</span>
          <button type="button" className="setup-btn" disabled={!outputs.length} onClick={onAddPlayer}>
            {t('audioserverClients.players.add')}
          </button>
        </div>
        {draft.players.length === 0 ? (
          /* Nothing set up yet is the one moment where what a speaker *is* still needs saying. */
          <>
            <p className="audioserver-group__empty">
              {outputs.length ? t('audioserverClients.players.empty') : t('audioserverClients.players.noCards')}
            </p>
            <p className="audioserver-note">{t('audioserverClients.players.desc')}</p>
          </>
        ) : (
          draft.players.map((player) => {
            const zone = usage.players[player.clientId];
            const status = device.status?.players?.find((entry) => entry.client_id === player.clientId);
            return (
              <button
                key={player.clientId}
                type="button"
                className="audioserver-row audioserver-row--drill"
                onClick={() => onView({ kind: 'player', clientId: player.clientId })}
              >
                <span className="audioserver-row__icon" aria-hidden="true">
                  <SpeakerGlyph />
                </span>
                <span className="audioserver-row__text">
                  <span className="audioserver-row__title">{entryLabel(player, outputs, t)}</span>
                  <span className={`audioserver-row__sum${zone ? '' : ' audioserver-row__sum--muted'}`}>
                    {zone ? t('audioserverClients.usage.inRoom', { room: zone.name }) : t('audioserverClients.usage.noRoom')}
                  </span>
                  {status ? <span className="audioserver-row__desc">{playerReadout(status, t).join(' · ')}</span> : null}
                </span>
                <Chevron />
              </button>
            );
          })
        )}
      </div>

      <div className="audioserver-group">
        <div className="audioserver-group__head">
          <span className="audioserver-group__label">{t('audioserverClients.sources.title')}</span>
          <button type="button" className="setup-btn" disabled={!inputs.length} onClick={onAddSource}>
            {t('audioserverClients.sources.add')}
          </button>
        </div>
        {draft.sources.length === 0 ? (
          <>
            <p className="audioserver-group__empty">
              {inputs.length ? t('audioserverClients.sources.empty') : t('audioserverClients.sources.noCards')}
            </p>
            <p className="audioserver-note">{t('audioserverClients.sources.desc')}</p>
          </>
        ) : (
          draft.sources.map((source) => {
            const lineIn = usage.sources[source.clientId];
            const status = device.status?.sources?.find((entry) => entry.client_id === source.clientId);
            return (
              <button
                key={source.clientId}
                type="button"
                className="audioserver-row audioserver-row--drill"
                onClick={() => onView({ kind: 'source', clientId: source.clientId })}
              >
                <span className="audioserver-row__icon" aria-hidden="true">
                  <InputGlyph />
                </span>
                <span className="audioserver-row__text">
                  <span className="audioserver-row__title">{entryLabel(source, inputs, t)}</span>
                  <span className={`audioserver-row__sum${lineIn ? '' : ' audioserver-row__sum--muted'}`}>
                    {lineIn ? t('audioserverClients.usage.asLineIn', { name: lineIn }) : t('audioserverClients.usage.noLineIn')}
                  </span>
                  {status ? <span className="audioserver-row__desc">{sourceReadout(status, t).join(' · ')}</span> : null}
                </span>
                <Chevron />
              </button>
            );
          })
        )}
        {/* Bluetooth lands here rather than beside the remote: a phone streaming in is an input
            like the socket above it, and that its own buttons steer the room is a property of that
            input. Read-only, because which room uses the radio is a fact about the room. */}
        <div className="audioserver-row">
          <span className="audioserver-row__icon" aria-hidden="true">
            <BluetoothGlyph />
          </span>
          <span className="audioserver-row__text">
            <span className="audioserver-row__title">{t('audioserverClients.bluetooth.title')}</span>
            <span className={`audioserver-row__sum${bluetoothZone ? '' : ' audioserver-row__sum--muted'}`}>
              {bluetoothZone
                ? t('audioserverClients.usage.forRoom', { room: bluetoothZone.name })
                : t('audioserverClients.bluetooth.notSetUp')}
            </span>
            <span className="audioserver-row__desc">{t('audioserverClients.bluetooth.desc')}</span>
          </span>
        </div>
        <BluetoothReadout device={device} />
      </div>

      <div className="audioserver-group">
        <div className="audioserver-group__head">
          <span className="audioserver-group__label">{t('audioserverClients.group.control')}</span>
        </div>
        <button
          type="button"
          className="audioserver-row audioserver-row--drill"
          onClick={() => onView({ kind: 'remote' })}
        >
          <span className="audioserver-row__icon" aria-hidden="true">
            <RemoteGlyph />
          </span>
          <span className="audioserver-row__text">
            <span className="audioserver-row__title">{t('audioserverClients.remote.title')}</span>
            <span className={`audioserver-row__sum${remoteZone || remoteState ? '' : ' audioserver-row__sum--muted'}`}>
              {remoteZone
                ? t('audioserverClients.usage.drivesRoom', { room: remoteZone.name })
                : remoteState
                  ? t(`audioserverClients.remote.states.${remoteState}`, remoteState)
                  : t('audioserverClients.remote.notSetUp')}
            </span>
          </span>
          <Chevron />
        </button>
      </div>

      {/* One row, so no label: the row says what it is. */}
      <div className="audioserver-group">
        <button type="button" className="audioserver-row audioserver-row--drill" onClick={() => onView({ kind: 'about' })}>
          <span className="audioserver-row__icon" aria-hidden="true">
            <BoxGlyph />
          </span>
          <span className="audioserver-row__text">
            <span className="audioserver-row__title">{t('audioserverClients.about.title')}</span>
            <span className="audioserver-row__sum audioserver-row__sum--muted">
              {[device.registration?.model, device.registration?.os].filter(Boolean).join(' · ') ||
                device.deviceId}
            </span>
          </span>
          <Chevron />
        </button>
      </div>
    </>
  );
}

/** What the radio reports: which phone, and what it is playing. Live, and never editable. */
function BluetoothReadout({ device }: { device: AudioserverDeviceView }): JSX.Element | null {
  const { t } = useTranslation();
  const bluetooth = device.status?.bluetooth;
  if (!bluetooth?.enabled) return null;
  const phones = bluetooth.devices ?? [];
  const active = phones.find((entry) => entry.streaming) ?? phones.find((entry) => entry.connected);
  const playing = bluetooth.now_playing;
  if (!active && !playing) return null;
  return (
    <p className="audioserver-note">
      {active ? (
        <>
          <strong>{active.name}</strong>
          {' · '}
          {active.streaming
            ? t('audioserverClients.bluetooth.streaming')
            : t('audioserverClients.bluetooth.connected')}
        </>
      ) : null}
      {playing?.title ? (
        <>
          {active ? ' · ' : null}
          {[playing.artist, playing.title].filter(Boolean).join(' — ')}
        </>
      ) : null}
    </p>
  );
}

/** The sound-card picker: the direct devices first, every ALSA alias one group down. */
function CardSelect({
  cards,
  value,
  onChange,
  label,
}: {
  cards: AudioserverCard[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  label: string;
}): JSX.Element {
  const { t } = useTranslation();
  const { direct, aliases } = splitCards(cards);
  const known = cards.some((card) => card.id === value);
  return (
    <select
      className="audioserver-select"
      aria-label={label}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || undefined)}
    >
      <option value="">{t('audioserverClients.cards.default')}</option>
      {direct.length ? (
        <optgroup label={t('audioserverClients.cards.direct')}>
          {direct.map((card) => (
            <option key={card.id} value={card.id}>
              {cardLabel(card)}
            </option>
          ))}
        </optgroup>
      ) : null}
      {aliases.length ? (
        <optgroup label={t('audioserverClients.cards.aliases')}>
          {aliases.map((card) => (
            <option key={card.id} value={card.id}>
              {cardLabel(card)}
            </option>
          ))}
        </optgroup>
      ) : null}
      {/* A card the device no longer reports (a DAC that is unplugged) stays in the list, so saving
          does not quietly move the room to another output. */}
      {value && !known ? (
        <option value={value}>{t('audioserverClients.cards.missing', { id: cardSpec(value) })}</option>
      ) : null}
    </select>
  );
}

/** The stable id a zone points at: shown, copyable, never editable. */
function ClientIdRow({ clientId, hint }: { clientId: string; hint: string }): JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="audioserver-row audioserver-row--block">
      <p className="audioserver-note" style={{ padding: '0 0 8px' }}>
        {hint}
      </p>
      <span className="audioserver-copy">
        <code className="audioserver-mono">{clientId}</code>
        <button
          type="button"
          className="setup-btn"
          onClick={() => {
            void copyText(clientId);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? t('audioserverClients.copied') : t('audioserverClients.copyId')}
        </button>
      </span>
    </div>
  );
}

function PlayerPanel({
  device,
  draft,
  player,
  usage,
  onChange,
  onDone,
}: {
  device: AudioserverDeviceView;
  draft: Draft;
  player: AudioserverPlayerConfig;
  usage: Usage;
  onChange: (change: Partial<Draft>) => void;
  onDone: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const outputs = device.registration?.outputs ?? [];
  const status = device.status?.players?.find((entry) => entry.client_id === player.clientId);
  const zone = usage.players[player.clientId];
  const readout = playerReadout(status, t);

  const update = (change: Partial<AudioserverPlayerConfig>): void => {
    onChange({
      players: draft.players.map((entry) =>
        entry.clientId === player.clientId ? { ...entry, ...change } : entry,
      ),
    });
  };

  const remove = (): void => {
    onChange({ players: draft.players.filter((entry) => entry.clientId !== player.clientId) });
    onDone();
  };

  // The volume script only means anything once the speaker has been told to use it — but a script
  // already typed in stays visible, so nothing disappears behind a dropdown.
  const showHook = player.volumeControl === 'hook' || Boolean(player.volumeHook);
  const showScale = player.volumeControl !== 'software' && player.volumeControl !== 'hook';

  return (
    <>
      <div className="audioserver-group">
        <div className="audioserver-group__head">
          <span className="audioserver-group__label">{t('audioserverClients.group.speaker')}</span>
        </div>
        {readout.length ? (
          <div className="audioserver-readout audioserver-readout--head">
            {readout.map((part, index) => (
              <span key={`${part}-${index}`} className="audioserver-chip is-on">
                <span className="audioserver-chip__dot" aria-hidden="true" />
                {part}
              </span>
            ))}
          </div>
        ) : null}
        {/* No name of its own. A speaker is already named twice over — by the box it lives in and by
            the room that plays it — and a third field only asked which of the three the Zones
            picker would show. It shows the device's name; the room's own name is on the Zones
            screen, where the room is. */}
        <div className="audioserver-row">
          <span className="audioserver-row__text">
            <span className="audioserver-row__title">{t('audioserverClients.players.card')}</span>
            <span className="audioserver-row__desc">{t('audioserverClients.players.cardDesc')}</span>
          </span>
          <span className="audioserver-row__control">
            <CardSelect
              cards={outputs}
              value={player.output}
              label={t('audioserverClients.players.card')}
              onChange={(value) => update({ output: value })}
            />
          </span>
        </div>
      </div>

      <div className="audioserver-group">
        <div className="audioserver-group__head">
          <span className="audioserver-group__label">{t('audioserverClients.group.volume')}</span>
        </div>
        <div className="audioserver-row">
          <span className="audioserver-row__text">
            <span className="audioserver-row__title">{t('audioserverClients.players.volumeControl')}</span>
            <span className="audioserver-row__desc">{t('audioserverClients.players.volumeControlDesc')}</span>
          </span>
          <span className="audioserver-row__control">
            <select
              className="audioserver-select"
              aria-label={t('audioserverClients.players.volumeControl')}
              value={player.volumeControl ?? 'auto'}
              onChange={(event) =>
                update({
                  volumeControl:
                    event.target.value === 'auto'
                      ? undefined
                      : (event.target.value as AudioserverPlayerConfig['volumeControl']),
                })
              }
            >
              <option value="auto">{t('audioserverClients.players.volumeAuto')}</option>
              <option value="alsa">{t('audioserverClients.players.volumeAlsa')}</option>
              <option value="software">{t('audioserverClients.players.volumeSoftware')}</option>
              <option value="hook">{t('audioserverClients.players.volumeHookOption')}</option>
            </select>
          </span>
        </div>
        {showScale ? (
          <div className="audioserver-row">
            <span className="audioserver-row__text">
              <span className="audioserver-row__title">{t('audioserverClients.players.volumeScale')}</span>
              <span className="audioserver-row__desc">{t('audioserverClients.players.volumeScaleDesc')}</span>
            </span>
            <span className="audioserver-row__control">
              <select
                className="audioserver-select"
                aria-label={t('audioserverClients.players.volumeScale')}
                value={player.mixerMapped === undefined ? 'auto' : player.mixerMapped ? 'even' : 'own'}
                onChange={(event) =>
                  update({
                    mixerMapped: event.target.value === 'auto' ? undefined : event.target.value === 'even',
                  })
                }
              >
                <option value="auto">{t('audioserverClients.players.volumeScaleAuto')}</option>
                <option value="even">{t('audioserverClients.players.volumeScaleEven')}</option>
                <option value="own">{t('audioserverClients.players.volumeScaleOwn')}</option>
              </select>
            </span>
          </div>
        ) : null}
        {showHook ? (
          <div className="audioserver-row">
            <span className="audioserver-row__text">
              <span className="audioserver-row__title">{t('audioserverClients.players.volumeHook')}</span>
              <span className="audioserver-row__desc">{t('audioserverClients.players.volumeHookDesc')}</span>
            </span>
            <span className="audioserver-row__control">
              <div className="setup-input" style={{ minWidth: 220 }}>
                <input
                  type="text"
                  value={player.volumeHook ?? ''}
                  placeholder="/usr/local/bin/beolab-volume"
                  onChange={(event) => update({ volumeHook: event.target.value || undefined })}
                />
              </div>
            </span>
          </div>
        ) : null}
      </div>

      <div className="audioserver-group">
        <div className="audioserver-row">
          <span className="audioserver-row__text">
            <span className="audioserver-row__title">{t('audioserverClients.players.removeTitle')}</span>
            <span className="audioserver-row__desc">
              {zone
                ? t('audioserverClients.players.removeInUse', { room: zone.name })
                : t('audioserverClients.players.removeDesc')}
            </span>
          </span>
          <span className="audioserver-row__control">
            <button type="button" className="setup-btn setup-btn--danger" onClick={remove}>
              {t('audioserverClients.remove')}
            </button>
          </span>
        </div>
      </div>
    </>
  );
}

function SourcePanel({
  device,
  draft,
  source,
  usage,
  onChange,
  onDone,
}: {
  device: AudioserverDeviceView;
  draft: Draft;
  source: AudioserverSourceConfig;
  usage: Usage;
  onChange: (change: Partial<Draft>) => void;
  onDone: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const inputs = device.registration?.inputs ?? [];
  const status = device.status?.sources?.find((entry) => entry.client_id === source.clientId);
  const lineIn = usage.sources[source.clientId];
  const readout = sourceReadout(status, t);

  const update = (change: Partial<AudioserverSourceConfig>): void => {
    onChange({
      sources: draft.sources.map((entry) =>
        entry.clientId === source.clientId ? { ...entry, ...change } : entry,
      ),
    });
  };

  const remove = (): void => {
    onChange({ sources: draft.sources.filter((entry) => entry.clientId !== source.clientId) });
    onDone();
  };

  return (
    <>
      <div className="audioserver-group">
        <div className="audioserver-group__head">
          <span className="audioserver-group__label">{t('audioserverClients.group.input')}</span>
        </div>
        {readout.length ? (
          <div className="audioserver-readout audioserver-readout--head">
            {readout.map((part, index) => (
              <span key={`${part}-${index}`} className="audioserver-chip is-on">
                <span className="audioserver-chip__dot" aria-hidden="true" />
                {part}
              </span>
            ))}
          </div>
        ) : null}
        {/* Same as the speaker: the line-in this input feeds is already named, so it announces
            itself under that name (and under the device's until a line-in claims it). */}
        <div className="audioserver-row">
          <span className="audioserver-row__text">
            <span className="audioserver-row__title">{t('audioserverClients.sources.card')}</span>
            <span className="audioserver-row__desc">{t('audioserverClients.sources.cardDesc')}</span>
          </span>
          <span className="audioserver-row__control">
            <CardSelect
              cards={inputs}
              value={source.input}
              label={t('audioserverClients.sources.card')}
              onChange={(value) => update({ input: value })}
            />
          </span>
        </div>
        <div className="audioserver-row">
          <span className="audioserver-row__text">
            <span className="audioserver-row__title">{t('audioserverClients.sources.controlHook')}</span>
            <span className="audioserver-row__desc">{t('audioserverClients.sources.controlHookDesc')}</span>
          </span>
          <span className="audioserver-row__control">
            <div className="setup-input" style={{ minWidth: 220 }}>
              <input
                type="text"
                value={source.controlHook ?? ''}
                placeholder="/usr/local/bin/ml-cmd"
                onChange={(event) => update({ controlHook: event.target.value || undefined })}
              />
            </div>
          </span>
        </div>
      </div>

      <div className="audioserver-group">
        <div className="audioserver-group__head">
          <span className="audioserver-group__label">{t('audioserverClients.group.use')}</span>
        </div>
        {lineIn ? (
          <p className="audioserver-note">{t('audioserverClients.usage.sourceLineInNote', { name: lineIn })}</p>
        ) : (
          <ClientIdRow clientId={source.clientId} hint={t('audioserverClients.usage.sourceFreeNote')} />
        )}
        {/* Silence detection and the capture format are set on the line-in this input feeds: that is
            where someone is thinking about the input, and having them in two places is how a rate
            typed on one screen was quietly overridden by a default on the other. */}
        <p className="audioserver-note">{t('audioserverClients.sources.configuredOnLineIn')}</p>
      </div>

      <div className="audioserver-group">
        <div className="audioserver-row">
          <span className="audioserver-row__text">
            <span className="audioserver-row__title">{t('audioserverClients.sources.removeTitle')}</span>
            <span className="audioserver-row__desc">
              {lineIn
                ? t('audioserverClients.sources.removeInUse', { name: lineIn })
                : t('audioserverClients.sources.removeDesc')}
            </span>
          </span>
          <span className="audioserver-row__control">
            <button type="button" className="setup-btn setup-btn--danger" onClick={remove}>
              {t('audioserverClients.remove')}
            </button>
          </span>
        </div>
      </div>
    </>
  );
}

function RemotePanel({
  device,
  draft,
  usage,
  components,
  onChange,
}: {
  device: AudioserverDeviceView;
  draft: Draft;
  usage: Usage;
  components: AudioserverClientsResponse['components'];
  onChange: (change: Partial<Draft>) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const state = device.status?.beoremote?.state;
  const pairing = device.status?.pairing;
  // The room comes from the room's own settings; a device configured before that was possible still
  // carries one of its own, and that is the only case where this screen names the room itself.
  const legacyZoneId = draft.beoremote.enabled === true ? draft.beoremote.zoneId : undefined;
  const zone =
    usage.remotes[device.deviceId] ??
    (typeof legacyZoneId === 'number'
      ? { id: legacyZoneId, name: usage.zones[legacyZoneId] ?? `Zone ${legacyZoneId}` }
      : undefined);

  const setRemote = (change: Partial<AudioserverBeoremoteConfig>): void => {
    onChange({ beoremote: { ...draft.beoremote, ...change } });
  };

  return (
    <>
      <div className="audioserver-group">
        <div className="audioserver-group__head">
          <span className="audioserver-group__label">{t('audioserverClients.group.remoteState')}</span>
        </div>
        <div className="audioserver-readout audioserver-readout--head">
          <span className={`audioserver-chip${state === 'connected' ? ' is-on' : ''}`}>
            <span className="audioserver-chip__dot" aria-hidden="true" />
            {state ? t(`audioserverClients.remote.states.${state}`, state) : t('audioserverClients.remote.notSetUp')}
          </span>
          {device.status?.beoremote?.hid_connected ? (
            <span className="audioserver-chip is-on">
              <span className="audioserver-chip__dot" aria-hidden="true" />
              {t('audioserverClients.remote.keysConnected')}
            </span>
          ) : null}
          {zone ? (
            <span className="audioserver-chip is-on">
              <span className="audioserver-chip__dot" aria-hidden="true" />
              {t('audioserverClients.usage.drivesRoom', { room: zone.name })}
            </span>
          ) : null}
          {pairing?.state ? (
            <span className="audioserver-chip is-warn">
              <span className="audioserver-chip__dot" aria-hidden="true" />
              {t(`audioserverClients.pairing.${pairing.state}`, pairing.state)}
              {pairing.address ? ` · ${pairing.address}` : ''}
            </span>
          ) : null}
        </div>
        <p className="audioserver-note">{t('audioserverClients.remote.desc')}</p>
      </div>

      <div className="audioserver-group">
        <div className="audioserver-group__head">
          <span className="audioserver-group__label">{t('audioserverClients.group.remoteSetup')}</span>
        </div>
        <p className="audioserver-note">{t('audioserverClients.remote.assignOnZone')}</p>
      </div>
    </>
  );
}

/** What the device is, as it reported itself. Nothing here can be typed over. */
/** How long the screen waits for a log after asking: the device polls every few seconds. */
const LOG_WAIT_MS = 1500;
const LOG_WAIT_ATTEMPTS = 12;

function AboutPanel({ device }: { device: AudioserverDeviceView }): JSX.Element {
  const { t } = useTranslation();
  const registration = device.registration;
  const facts: Array<[string, string]> = [
    [t('audioserverClients.about.model'), registration?.model ?? device.config?.model ?? '—'],
    [t('audioserverClients.about.host'), registration?.hostname ?? device.config?.hostname ?? '—'],
    [t('audioserverClients.about.address'), registration?.ip ?? device.config?.ip ?? '—'],
    [t('audioserverClients.about.mac'), registration?.mac ?? device.config?.mac ?? '—'],
    // Most builds already name the architecture in the OS string; only add it when they do not.
    [
      t('audioserverClients.about.os'),
      [registration?.os, registration?.os?.includes(registration?.arch ?? '') ? '' : registration?.arch]
        .filter(Boolean)
        .join(' · ') || '—',
    ],
    [t('audioserverClients.about.version'), registration?.version ?? device.config?.version ?? '—'],
    [
      t('audioserverClients.about.uptime'),
      typeof device.status?.uptime_s === 'number'
        ? t('audioserverClients.about.uptimeValue', { minutes: Math.max(1, Math.round(device.status.uptime_s / 60)) })
        : '—',
    ],
    [
      t('audioserverClients.about.heard'),
      device.statusReceivedAt ? new Date(device.statusReceivedAt).toLocaleString() : t('audioserverClients.neverSeen'),
    ],
  ];

  const installed = device.status?.components ?? registration?.components ?? [];

  return (
    <>
      <div className="audioserver-group">
        <div className="audioserver-group__head">
          <span className="audioserver-group__label">{t('audioserverClients.group.identity')}</span>
        </div>
        <div className="audioserver-facts">
          {facts.map(([label, value]) => (
            <div key={label} className="audioserver-facts__item">
              <span className="audioserver-facts__label">{label}</span>
              <span className="audioserver-facts__value">{value}</span>
            </div>
          ))}
        </div>
        <ClientIdRow clientId={device.deviceId} hint={t('audioserverClients.about.idHint')} />
      </div>

      {installed.length ? (
        <div className="audioserver-group">
          <div className="audioserver-group__head">
            <span className="audioserver-group__label">{t('audioserverClients.about.software')}</span>
          </div>
          <div className="audioserver-readout audioserver-readout--head">
            {installed.map((entry) => (
              <span
                key={entry.name}
                className={`audioserver-chip${entry.state === 'running' || entry.state === 'installed' ? ' is-on' : ''}${
                  entry.state === 'failed' ? ' is-warn' : ''
                }`}
              >
                <span className="audioserver-chip__dot" aria-hidden="true" />
                {entry.name}
                {entry.version ? ` ${entry.version}` : ''}
                {' · '}
                {t(`audioserverClients.components.${entry.state ?? 'absent'}`, entry.state ?? 'absent')}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <DeviceLog device={device} />
    </>
  );
}

/**
 * The device's own last words, on request.
 *
 * Two steps, because that is what actually happens: the ask rides the device's next poll and the
 * lines come back on the one after, so this asks, then reads until something newer than what it
 * started with turns up. It gives up after a while rather than spinning: a device that is not
 * polling has nothing to say and the screen should admit it.
 */
function DeviceLog({ device }: { device: AudioserverDeviceView }): JSX.Element {
  const { t } = useTranslation();
  const [logs, setLogs] = React.useState<AudioserverDeviceLogs | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // What is already there, so a log fetched a minute ago is on screen without asking again.
  React.useEffect(() => {
    let cancelled = false;
    void fetchAudioserverClientLogs(device.deviceId)
      .then((next) => {
        if (!cancelled) setLogs(next);
      })
      .catch(() => {
        // Nothing to show is the honest answer; the button says the rest.
      });
    return () => {
      cancelled = true;
    };
  }, [device.deviceId]);

  const ask = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const before = logs?.receivedAt ?? null;
    try {
      await sendAudioserverClientCommand(device.deviceId, 'send_logs');
      for (let attempt = 0; attempt < LOG_WAIT_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, LOG_WAIT_MS));
        const next = await fetchAudioserverClientLogs(device.deviceId);
        if (next.receivedAt && next.receivedAt !== before) {
          setLogs(next);
          setBusy(false);
          return;
        }
      }
      setError(t('audioserverClients.log.noAnswer'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  return (
    <div className="audioserver-group">
      <div className="audioserver-group__head">
        <span className="audioserver-group__label">{t('audioserverClients.log.title')}</span>
        <button type="button" className="audioserver-modal__btn" disabled={busy} onClick={() => void ask()}>
          {busy ? t('audioserverClients.log.fetching') : t('audioserverClients.log.fetch')}
        </button>
      </div>
      <p className="audioserver-note" style={{ padding: 0 }}>
        {logs?.receivedAt
          ? t('audioserverClients.log.taken', { when: new Date(logs.receivedAt).toLocaleString() })
          : t('audioserverClients.log.none')}
      </p>
      {logs?.lines.length ? <pre className="audioserver-log">{logs.lines.join('\n')}</pre> : null}
      {error ? <p className="audioserver-note audioserver-note--warn" style={{ padding: 0 }}>{error}</p> : null}
    </div>
  );
}

/** How a device gets here in the first place: one line, pasted into a terminal. */
function InstallModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <Modal
      open
      onClose={onClose}
      backdropClassName="audioserver-modal-backdrop"
      dialogClassName="audioserver-modal audioserver-modal--narrow"
      ariaLabelledBy="audioserver-install-title"
    >
      <header className="audioserver-modal__head">
        <div className="audioserver-modal__head-text">
          <p className="audioserver-modal__eyebrow">{t('audioserverClients.installEyebrow')}</p>
          <h3 id="audioserver-install-title" className="audioserver-modal__title">
            {t('audioserverClients.addTitle')}
          </h3>
        </div>
        <button type="button" className="audioserver-modal__close" onClick={onClose} aria-label={t('audioserverClients.close')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>
      <div className="audioserver-modal__body">
        <p className="audioserver-fleet__desc">{t('audioserverClients.addBody')}</p>
        <code className="audioserver-install">{INSTALL_COMMAND}</code>
        <p className="audioserver-note" style={{ padding: 0 }}>
          {t('audioserverClients.emptyHint')}
        </p>
      </div>
      <footer className="audioserver-modal__foot">
        <CopyCommandButton />
        <button type="button" className="audioserver-modal__btn" onClick={onClose}>
          {t('audioserverClients.close')}
        </button>
      </footer>
    </Modal>
  );
}
