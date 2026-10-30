import { GOAL, type Seat } from './board.ts';
import { HERO, blastOf, type GameEvent, type Rand } from './rules.ts';
import { EARLY_UNTIL } from './scoring.ts';
import { ROLL_MS, arrivalAt, blastAt, boxOpenAt, captureAt, dragonStopsAt } from './timing.ts';

// Reactions are short GIFs shown over a player's hangar after a big moment, picked at random:
//   happy — one of your pieces reaches the centre, or you knock out (or bomb) a piece past the middle of its route,
//           or a magic box gives you something good (a vest, or nothing bad)
//           or a piece of yours makes a kill streak (a double kill or more)
//   sad   — your piece is knocked out or bombed after it passed the middle of its route, a box was bad news,
//           you rolled three sixes, or you lost three turns in a row with nothing out of the hangar
// Each game draws them like cards, so no GIF comes back until its whole group has been shown.

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

/** What's left to draw of each group in one game, and the last GIF drawn from it. Saved with the game. */
export type ReactionDeck = Partial<Record<ReactionGroup, { left: string[]; last?: string }>>;

/**
 * Draws the next GIF of a group from a game's deck, updating the deck. A group is shuffled afresh only once
 * every GIF in it has been shown, and never starts over with the one just shown.
 */
export function drawReaction(deck: ReactionDeck, group: ReactionGroup, rand: Rand): string {
  const pile = deck[group] ?? { left: [] };
  let left = pile.left.filter((id) => REACTION_BY_ID.get(id)?.group === group);
  if (!left.length) {
    left = [...POOLS[group]];
    for (let i = left.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [left[i], left[j]] = [left[j], left[i]];
    }
    // Drawn from the end: don't open the new round with the one that closed the last.
    if (left.length > 1 && left.at(-1) === pile.last) [left[0], left[left.length - 1]] = [left[left.length - 1], left[0]];
  }
  const id = left.pop()!;
  deck[group] = { left, last: id };
  return id;
}

/** Which reactions an event sets off, one per seat at most. `pick` chooses the GIF for a group. */
export function reactionsFor(ev: GameEvent, pick: (group: ReactionGroup) => string): ShownReaction[] {
  const out: ShownReaction[] = [];
  const show = (seat: Seat, group: ReactionGroup, at: number) => {
    if (!out.some((r) => r.seat === seat)) out.push({ seat, id: pick(group), at });
  };
  // A third six is bad luck: sad as soon as the dice stops.
  if (ev.type === 'roll' && (ev.outcome === 'penalty' || ev.outcome === 'forfeit')) show(ev.seat, 'sad', ROLL_MS);
  // The dragon eating a piece is bad luck too.
  if (ev.type === 'roll') for (const e of ev.dragon?.eaten ?? []) show(e.seat, 'sad', dragonStopsAt(ev));
  // So is a third lost turn in a row with everything still in the hangar.
  if (ev.type === 'roll' && ev.stuck) show(ev.seat, 'sad', ROLL_MS);
  if (ev.type !== 'move') return out;
  // An opened magic box always gets a reaction, good or bad, as it opens.
  const box = ev.box;
  if (box?.outcome) {
    const hurts = (box.outcome === 'bomb' && !box.saved) || box.outcome === 'freeze';
    show(ev.seat, hurts || box.outcome === 'minus' ? 'sad' : 'happy', boxOpenAt(ev));
    if (hurts) show(box.owner, 'happy', boxOpenAt(ev));
  }
  const blast = blastOf(ev);
  // A hero has no way to go, so only pieces past halfway count as a loss (a hero's positions are squares).
  if (blast && !ev.hero && blast.pos >= HURT_FROM) {
    const at = blastAt(ev);
    show(ev.seat, 'sad', at);
    if (blast.owner !== null && blast.owner !== ev.seat) show(blast.owner, 'happy', at);
  }
  // A super bomb's blast: its owner is happy whenever it catches someone else; anyone caught past halfway is sad.
  const caught = (ev.bombed?.blast ?? []).filter((v) => !v.saved);
  const bomber = ev.bombed?.owner ?? null;
  if (caught.length) {
    const at = blastAt(ev);
    for (const v of caught) if (v.piece < HERO && v.from >= HURT_FROM) show(v.seat, 'sad', at);
    if (bomber !== null && caught.some((v) => v.seat !== bomber)) show(bomber, 'happy', at);
  }
  const late = ev.captures.filter((c) => c.piece < HERO && c.from >= HURT_FROM);
  if (late.length) {
    show(ev.seat, 'happy', captureAt(ev, late[0]));
    for (const c of late) show(c.seat, 'sad', captureAt(ev, c));
  }
  const spree = ev.captures.find((c) => (c.streak ?? 1) >= 2);
  if (spree) show(ev.seat, 'happy', captureAt(ev, spree));
  if (ev.to === GOAL || ev.dragon) show(ev.seat, 'happy', arrivalAt(ev));
  return out;
}
