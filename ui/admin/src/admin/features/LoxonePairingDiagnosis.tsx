import React, { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoxonePairing, setLoxoneCapture, type LoxonePairingStatus } from '../services/setupApi';

type Verdict = { tone: 'ok' | 'warn' | 'error'; text: string };

/**
 * Where pairing with the Miniserver stopped, read live from the server.
 *
 * Every way pairing fails looks the same from the outside: the card keeps saying
 * "Pairing…". The server records each step the Miniserver takes, so this names
 * the one it did not take and what to change for it.
 */
export default function LoxonePairingDiagnosis({ active }: { active: boolean }): JSX.Element | null {
  const { t } = useTranslation();
  const [status, setStatus] = React.useState<LoxonePairingStatus | null>(null);

  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const next = await fetchLoxonePairing();
        if (!cancelled) setStatus(next);
      } catch {
        // A server without the endpoint keeps the window as it was.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active]);

  if (!active || !status || !status.enabled) return null;

  const time = (at: number | null | undefined): string =>
    at ? new Date(at).toLocaleTimeString() : t('zones.loxone.diag.never');
  const failedListener = status.listeners.find((listener) => !listener.ok);
  const serials = status.lastSetConfig?.serials.join(', ') || '—';
  const lastStep = status.steps[status.steps.length - 1]?.command ?? '—';
  const verdict: Verdict = status.paired
    ? { tone: 'ok', text: t('zones.loxone.diag.paired') }
    : status.startError || failedListener || !status.running
      ? {
          tone: 'error',
          text: t('zones.loxone.diag.notListening', {
            error: failedListener?.error ?? status.startError ?? '—',
          }),
        }
      : status.lastSetConfigError
        ? { tone: 'error', text: t('zones.loxone.diag.unreadable', { reason: status.lastSetConfigError.reason }) }
        : status.lastSetConfig && !status.lastSetConfig.matched
          ? {
              tone: 'error',
              text: t('zones.loxone.diag.otherSerial', { serials, serial: status.serial ?? '—' }),
            }
          : status.lastGetConfig
            ? { tone: 'warn', text: t('zones.loxone.diag.noPush', { serial: status.serial ?? '—' }) }
            : status.lastConnection
              ? { tone: 'warn', text: t('zones.loxone.diag.handshake', { command: lastStep }) }
              : {
                  tone: 'warn',
                  text: t('zones.loxone.diag.noConnection', { ip: status.ip ?? window.location.hostname }),
                };

  const portsOk = status.running && !failedListener;
  const rows: Array<[string, string]> = [
    [
      t('zones.loxone.diag.ports'),
      portsOk
        ? t('zones.loxone.diag.portsOk', {
            ports: status.listeners.map((listener) => listener.port).join(', '),
          })
        : t('zones.loxone.diag.portsDown'),
    ],
    [
      t('zones.loxone.diag.search'),
      status.udp.lastProbeAt
        ? t('zones.loxone.diag.searchSeen', {
            time: time(status.udp.lastProbeAt),
            from: status.udp.lastProbeFrom ?? '—',
          })
        : status.udp.ok
          ? t('zones.loxone.diag.searchReady')
          : t('zones.loxone.diag.searchDown', { error: status.udp.error ?? '—' }),
    ],
    [
      t('zones.loxone.diag.connection'),
      status.lastConnection
        ? t('zones.loxone.diag.connectionSeen', {
            time: time(status.lastConnection.at),
            from: status.lastConnection.remote ?? '—',
          })
        : t('zones.loxone.diag.never'),
    ],
    [t('zones.loxone.diag.getConfig'), time(status.lastGetConfig?.at)],
    [
      t('zones.loxone.diag.setConfig'),
      status.lastSetConfig
        ? t('zones.loxone.diag.setConfigSeen', { time: time(status.lastSetConfig.at), serials })
        : t('zones.loxone.diag.never'),
    ],
  ];

  const unhandled = status.unhandled ?? [];
  const unhandledList = unhandled.length ? (
    <details className="zones-loxone-diag__steps" open>
      <summary>{t('zones.loxone.diag.unhandled', { count: unhandled.length })}</summary>
      <ol>
        {unhandled.slice(-15).map((entry) => (
          <li key={entry.command}>
            <time>{time(entry.at)}</time> <code>{entry.command}</code>
            {entry.count > 1 ? ` ×${entry.count}` : ''}
          </li>
        ))}
      </ol>
    </details>
  ) : null;

  const capture = status.capture ?? { until: null, entries: [] };
  const recording = capture.until !== null && capture.until > status.now;
  const toggleCapture = async (): Promise<void> => {
    try {
      setStatus(await setLoxoneCapture(!recording));
    } catch {
      // The next poll shows whatever the server ended up doing.
    }
  };
  const captureBlock = (
    <div className="zones-loxone-diag__capture">
      <p className="zones-loxone-diag__hint">
        {recording
          ? t('zones.loxone.diag.captureRunning', {
            seconds: Math.max(0, Math.round(((capture.until ?? 0) - status.now) / 1000)),
          })
          : t('zones.loxone.diag.captureHint')}
      </p>
      <button type="button" className="zones-modal__btn" onClick={() => void toggleCapture()}>
        {recording ? t('zones.loxone.diag.captureStop') : t('zones.loxone.diag.captureStart')}
      </button>
      {capture.entries.length ? (
        <details className="zones-loxone-diag__steps" open>
          <summary>{t('zones.loxone.diag.captureEntries', { count: capture.entries.length })}</summary>
          <ol>
            {capture.entries.slice(-60).map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                <time>{time(entry.at)}</time> {entry.source} {entry.remote ?? ''} <code>{entry.detail}</code>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );

  // Once paired, only what can still go wrong is worth the room: Config actions such as the
  // Tree Turbo search that this server does not answer yet.
  if (status.paired) {
    return (
      <section className="zones-loxone-diag" aria-live="polite">
        {unhandledList ?? <p className="zones-loxone-diag__hint">{t('zones.loxone.diag.unhandledNone')}</p>}
        {captureBlock}
      </section>
    );
  }

  return (
    <section className="zones-loxone-diag" aria-live="polite">
      <p className={`zones-loxone-diag__verdict zones-loxone-diag__verdict--${verdict.tone}`}>{verdict.text}</p>
      {unhandledList}
      {captureBlock}
      <dl className="zones-loxone-diag__rows">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {status.steps.length ? (
        <details className="zones-loxone-diag__steps">
          <summary>{t('zones.loxone.diag.steps', { count: status.steps.length })}</summary>
          <ol>
            {status.steps.slice(-15).map((step) => (
              <li key={`${step.at}-${step.command}`}>
                <time>{time(step.at)}</time> <code>{step.command}</code>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
