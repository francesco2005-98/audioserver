/**
 * The splash.
 *
 * Brought back from the older player, where it was the best thing about the first second: the mark
 * draws its roofline, the bars breathe like a level meter, and the wordmark and tagline rise in
 * behind it. It is not decoration — it *is* the connecting phase. The event stream takes a beat to
 * open (`server.snapshot` carries the whole zone snapshot), and a player that shows an empty shell for
 * that beat looks broken in a way that a mark holding on a black field does not.
 *
 * Controlled in two steps by whoever owns it, which is what keeps the hand-off invisible:
 *  - `fading` fades the *contents* out while the black layer stays, so nothing pops.
 *  - `out` then fades the black layer itself away, revealing the app already rendered beneath.
 *
 * A minimum on-screen time is the caller's business (see `Root`): without one a fast local server
 * makes the whole thing a flash, which is worse than no splash at all.
 */
export function Intro({ fading, out, vt = false }: { fading: boolean; out: boolean; vt?: boolean }) {
  return (
    <div className="intro" data-fading={fading || undefined} data-out={out || undefined} data-vt={vt || undefined}>
      {/*
        The animated copy of the mark, not `<Mark>`: every bar has to be addressable by
        `:nth-child` so each gets its own delay, and the roofline is stroked with a dash offset it
        animates away. The static mark has neither, and giving it both would put animation
        machinery into the one drawing that is used in six calm places.
      */}
      {/*
        A wrapper, only so the rings have something to hang on: pseudo-elements do not render on an
        `<svg>` element, and the two expanding circles are `::before`/`::after`. Borrowed from the admin
        interface's own splash, where the mark pulses twice as it lands — the two products share a
        wordmark and an accent, so they may as well share the gesture.
      */}
      <div className="intro-glyph">
        <svg className="intro-mark" viewBox="0 0 64 64" aria-hidden="true">
          <circle className="intro-ring" cx="32" cy="32" r="22" />
          <rect x="18" y="34" width="3.2" height="8" rx="1.6" />
          <rect x="24.2" y="28" width="3.2" height="16" rx="1.6" />
          <rect x="30.4" y="22" width="3.2" height="24" rx="1.6" />
          <rect x="36.6" y="26" width="3.2" height="18" rx="1.6" />
          <rect x="42.8" y="32" width="3.2" height="10" rx="1.6" />
        </svg>
      </div>

      <div className="intro-word disp">
        audioserver <span className="intro-word-light mono">player</span>
      </div>
      <div className="intro-tag mono">Every room, one system</div>
    </div>
  );
}
