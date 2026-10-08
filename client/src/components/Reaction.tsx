import { memo, useState } from 'react';
import { REACTIONS, REACTION_BY_ID } from '../../../shared/reactions.ts';

const FALLBACK = { happy: '🎉', sad: '😡' } as const;

/** A reaction GIF filling its box, or a plain emoji if the GIF can't be loaded. */
export const ReactionArt = memo(function ReactionArt({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  const r = REACTION_BY_ID.get(id);
  if (!r) return null;
  if (failed) {
    return (
      <span className="reaction-emoji-box">
        <span className="reaction-emoji" role="img" aria-label={r.group}>
          {FALLBACK[r.group]}
        </span>
      </span>
    );
  }
  return <img className="reaction-img" src={r.src} alt="" draggable={false} onError={() => setFailed(true)} />;
});

let preloaded = false;

/** Fetches every GIF once in the background, so a reaction shows the moment it happens. */
export function preloadReactions() {
  if (preloaded) return;
  preloaded = true;
  // Respect data saver: GIFs then load when they are first shown.
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
  REACTIONS.forEach((r, i) =>
    setTimeout(() => {
      const img = new Image();
      img.fetchPriority = 'low';
      img.src = r.src;
    }, 300 + i * 150),
  );
}
