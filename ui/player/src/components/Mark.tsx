/**
 * The mark: a glass ring around a level meter.
 *
 * Inline SVG rather than an asset so it inherits `currentColor` and can be sized by CSS.
 * The bars stay individual `<rect>`s so the intro can animate each one.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeWidth="2.4" opacity="0.85" />
      <g fill="currentColor">
        <rect x="18" y="34" width="3.2" height="8" rx="1.6" fillOpacity="0.45" />
        <rect x="24.2" y="28" width="3.2" height="16" rx="1.6" fillOpacity="0.7" />
        <rect x="30.4" y="22" width="3.2" height="24" rx="1.6" />
        <rect x="36.6" y="26" width="3.2" height="18" rx="1.6" fillOpacity="0.8" />
        <rect x="42.8" y="32" width="3.2" height="10" rx="1.6" fillOpacity="0.5" />
      </g>
    </svg>
  );
}
