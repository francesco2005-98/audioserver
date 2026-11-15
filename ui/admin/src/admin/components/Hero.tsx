import React, { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import './Hero.css';
import { fetchStatus, StatusResponse } from '../services/statusApi';
import { usePolling } from '../hooks/usePolling';
import { formatUptime } from '../utils/format';
import { useGlobalAlert } from './GlobalAlert';

type StatusTone = 'success' | 'warn' | 'error' | 'muted';

export default function Hero(): JSX.Element {
  const { t } = useTranslation();
  const [info, setInfo] = React.useState<StatusResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const { push: pushAlert } = useGlobalAlert();
  const lastPushedErrorRef = React.useRef<string | null>(null);

  const pollStatus = React.useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const status = await fetchStatus(signal);
      if (signal?.aborted) return;
      setInfo(status);
      setError(null);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  usePolling(pollStatus, { delay: 5000 });

  React.useEffect(() => {
    if (!error) {
      lastPushedErrorRef.current = null;
      return;
    }
    if (lastPushedErrorRef.current === error) return;
    lastPushedErrorRef.current = error;
    pushAlert({ tone: 'error', title: t('hero.status.errorTitle'), message: error });
  }, [error, pushAlert, t]);

  const status = React.useMemo((): { label: string; tone: StatusTone } => {
    if (error) return { label: t('hero.status.unavailable'), tone: 'error' };
    if (!info) return { label: t('hero.status.connecting'), tone: 'warn' };
    // Neutral operational status only. The Loxone connection state (connected /
    // pairing / not connected) lives on the Players screen, not in the global header.
    return { label: t('hero.status.online'), tone: 'success' };
  }, [error, info, t]);

  const uptime = formatUptime(info?.uptime);
  const coreVersion = info?.version ?? '';

  return (
    <section className="hero-content">
      <div className="hero-mark" aria-hidden="true">
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle className="hero-mark-peak" cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <g fill="currentColor">
            <rect x="18" y="34" width="3.2" height="8" rx="1.6" opacity="0.45" />
            <rect x="24.2" y="28" width="3.2" height="16" rx="1.6" opacity="0.7" />
            <rect x="30.4" y="22" width="3.2" height="24" rx="1.6" />
            <rect x="36.6" y="26" width="3.2" height="18" rx="1.6" opacity="0.8" />
            <rect x="42.8" y="32" width="3.2" height="10" rx="1.6" opacity="0.5" />
          </g>
        </svg>
      </div>

      {/*
        The wordmark is the door to the player, as the player's wordmark is the door to here.
        A real `<a href>` so the browser performs a real navigation, which is what lets the mark above fly
        across it — see `@view-transition` in `theme.css`.
      */}
      <h1 className="hero-wordmark" aria-label="Audioserver">
        <a className="hero-wordmark__link" href="/player/" title="Listen">
          <span className="hero-wordmark__audioserver">Audioserver</span>
        </a>
      </h1>

      <div className="diag-strip">
        <div className="diag-item">
          <span className={`pulse-dot${status.tone === 'warn' ? ' pulse-dot--warn' : ''}${status.tone === 'error' ? ' pulse-dot--error' : ''}`} />
          <span className={`diag-value diag-value--${status.tone}`}>{status.label}</span>
        </div>
        {uptime ? (
          <div className="diag-item">
            <span className="diag-label">{t('hero.labels.uptime')}</span>
            <span className="diag-value">{uptime}</span>
          </div>
        ) : null}
        {coreVersion ? (
          <div className="diag-item">
            <span className="diag-label">{t('hero.labels.core')}</span>
            <span className="diag-value">{coreVersion}</span>
          </div>
        ) : null}
        <div className="diag-item">
          <span className="diag-label">{t('hero.labels.ui')}</span>
          <span className="diag-value">{__APP_VERSION__}</span>
        </div>
      </div>
    </section>
  );
}
