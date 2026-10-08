import { GOAL, type Seat } from './board.ts';
import { blastOf, type GameEvent } from './rules.ts';
import { EARLY_UNTIL } from './scoring.ts';
import { ROLL_MS, arrivalAt, blastAt, boxOpenAt, captureAt } from './timing.ts';

// Reactions are short GIFs shown over a player's hangar after a big moment, picked at random:
//   happy — one of your pieces reaches the centre, or you knock out (or bomb) a piece past the middle of its route,
//           or a magic box gives you something good (a vest, or nothing bad)
//   sad   — your piece is knocked out or bombed after it passed the middle of its route, a box was bad news,
//           or you rolled three sixes

export type ReactionGroup = 'happy' | 'sad';

export interface Reaction {
  id: string;
  group: ReactionGroup;
  src: string;
  /** Pixel size, so the GIF can be shown whole without cropping. */
  w: number;
  h: number;
}

// Giphy's 200px-wide WebP rendition: animated, and a fraction of the size of the full GIF.
const giphy = (group: ReactionGroup, id: string, h: number): Reaction => ({
  id,
  group,
  src: `https://media.giphy.com/media/${id}/200w.webp`,
  w: 200,
  h,
});

export const REACTIONS: readonly Reaction[] = [
  giphy('happy', 'IwAZ6dvvvaTtdI8SD5', 166),
  giphy('happy', 'rjkJD1v80CjYs', 200),
  giphy('happy', 'DlHyR7luOgxnoZ7cE9', 112),
  giphy('happy', 's2qXK8wAvkHTO', 132),
  giphy('happy', '3rgXBxX4myufzT6N2w', 156),
  giphy('happy', '88iYsvbegSUn9bSTF8', 200),
  giphy('happy', 'FmtBtwC8jx1uLwWmk7', 200),
  giphy('happy', '4zzJHOTm1KElgk4r92', 200),
  giphy('happy', 'xNBcChLQt7s9a', 200),
  giphy('happy', '3o7TKr3nzbh5WgCFxe', 200),
  giphy('happy', 'UvUCuoPTjspHBCv1yB', 310),
  giphy('happy', 'MC4TAzWGsVrAIjEGtz', 112),
  giphy('happy', 'jtirFYtVwG5a0o1t9o', 166),
  giphy('happy', 'XHAIMuXxjlzuwjRo3Y', 166),
  giphy('happy', 'iKG1883k0VkFC217Cx', 166),
  giphy('happy', 'cJRkhvcZgwuwR9J3d0', 166),

  giphy('sad', 'l1J9u3TZfpmeDLkD6', 230),
  giphy('sad', '3ohs81rDuEz9ioJzAA', 150),
  giphy('sad', 'GjR6RPcURgiL6', 122),
  giphy('sad', '8HBRAVPws2AYDNa2Gz', 200),
  giphy('sad', '29bKyyjDKX1W8', 156),
  giphy('sad', 'M3KeQ2khSTTrFZZlRI', 200),
  giphy('sad', 'R3FUSQ5H5jzVe', 140),
  giphy('sad', '10H4by255F2UsU', 112),
  giphy('sad', 'fIkT0LdGUc4GushZ2Q', 166),
  giphy('sad', '2A7wAWGp9HUjbK6BJU', 200),
  giphy('sad', 'ibdSCBrJ3BBCVUl8XD', 200),
  giphy('sad', 'cvqG00p5zzWsct09gJ', 200),
  giphy('sad', '4qmcuu67Hxx0Q', 150),
  giphy('sad', 'X0QKGRNCxnwWs', 134),
  giphy('sad', 'l46CCoNzK8DHGPN7y', 126),
  giphy('sad', 'fQDSaJdspGDGkbk0DT', 200),
  giphy('sad', 'aTefcd7QVc8dVafWYC', 200),
  giphy('sad', 'X4UHZ2u4Xp4RZmgXxm', 112),
  giphy('sad', 'lPMACrHNcmW9dQUecJ', 200),
  giphy('sad', 'd7rvF20PqNuGKSQGhf', 200),
  giphy('sad', '3o6gEgkb5xqAyMw5Og', 110),
  giphy('sad', 'RVW5PilbP2tLG', 206),
  giphy('sad', 'SvurQLaHA176wkCmL8', 166),
  giphy('sad', '8bQdMxDSJ8oiQ', 206),
  giphy('sad', 'W0c3xcZ3F1d0EYYb0f', 166),
  giphy('sad', 'McmLoTZCMUkoZGPXU6', 166),
  giphy('sad', 'Su7Bo9MMnyl0ZE263z', 166),
  giphy('sad', 'Kenaq5YK78qy5flMCf', 166),
  giphy('sad', 'spd8OEUnfXDBS', 188),
  giphy('sad', 'W0SLa0YuzWBZ6', 130),
];

export const REACTION_BY_ID = new Map(REACTIONS.map((r) => [r.id, r]));
const POOLS: Record<ReactionGroup, string[]> = {
  happy: REACTIONS.filter((r) => r.group === 'happy').map((r) => r.id),
  sad: REACTIONS.filter((r) => r.group === 'sad').map((r) => r.id),
};

/** How long a reaction stays up. */
export const REACTION_MS = 8000;
/** Knock-outs of pieces at or past this square (the second half of the route, home column included) set off reactions. */
export const HURT_FROM = EARLY_UNTIL + 1;

/** A reaction to show over a seat's hangar for the event it came with, `at` ms into its animation. */
export interface ShownReaction {
  seat: Seat;
  id: string;
  at: number;
}

/** Which reactions an event sets off, one per seat at most. `rand(n)` gives an integer in [0, n). */
export function reactionsFor(ev: GameEvent, rand: (n: number) => number): ShownReaction[] {
  const out: ShownReaction[] = [];
  const show = (seat: Seat, group: ReactionGroup, at: number) => {
    if (!out.some((r) => r.seat === seat)) out.push({ seat, id: POOLS[group][rand(POOLS[group].length)], at });
  };
  // A third six is bad luck: sad as soon as the dice stops.
  if (ev.type === 'roll' && (ev.outcome === 'penalty' || ev.outcome === 'forfeit')) show(ev.seat, 'sad', ROLL_MS);
  if (ev.type !== 'move') return out;
  // An opened magic box always gets a reaction, good or bad, as it opens.
  const box = ev.box;
  if (box?.outcome) {
    const bad = (box.outcome === 'bomb' && !box.saved) || box.outcome === 'minus';
    show(ev.seat, bad ? 'sad' : 'happy', boxOpenAt(ev));
    if (box.outcome === 'bomb' && !box.saved) show(box.owner, 'happy', boxOpenAt(ev));
  }
  const blast = blastOf(ev);
  if (blast && blast.pos >= HURT_FROM) {
    const at = blastAt(ev);
    show(ev.seat, 'sad', at);
    if (blast.owner !== ev.seat) show(blast.owner, 'happy', at);
  }
  const late = ev.captures.filter((c) => c.from >= HURT_FROM);
  if (late.length) {
    show(ev.seat, 'happy', captureAt(ev, late[0]));
    for (const c of late) show(c.seat, 'sad', captureAt(ev, c));
  }
  if (ev.to === GOAL) show(ev.seat, 'happy', arrivalAt(ev));
  return out;
}
