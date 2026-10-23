import { useEffect, useState } from 'react';

type FullscreenDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => void };

const doc = document as FullscreenDoc;
const root = document.documentElement as FullscreenEl;
const isFull = () => !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
/** Already running as an installed app, which has no browser bars to hide. */
const installed = () => typeof matchMedia === 'function' && matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;

/** Fills the screen with the game, like an app: no browser bars, nothing to scroll past. */
export function FullscreenButton() {
  const [on, setOn] = useState(isFull);
  useEffect(() => {
    const changed = () => setOn(isFull());
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('webkitfullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('webkitfullscreenchange', changed);
    };
  }, []);
  // iPhones only let videos go full screen; there, adding the game to the home screen does the same.
  if (installed() || !(root.requestFullscreen || root.webkitRequestFullscreen)) return null;

  const toggle = () => {
    if (isFull()) void (doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.());
    else void (root.requestFullscreen ? root.requestFullscreen() : root.webkitRequestFullscreen?.());
  };
  return (
    <button className="btn ghost small" onClick={toggle} title={on ? 'Leave full screen' : 'Full screen, like an app'} aria-pressed={on}>
      {on ? '🗗' : '⛶'}
      <span className="fullscreen-label"> {on ? 'Exit full screen' : 'Full screen'}</span>
    </button>
  );
}
