import { HOME_FIRST, TRACK_LAST } from './board.ts';

// Small numbers, with 100 the biggest award. Balanced with bot games played to third place: knock-outs
// make up about a fifth of all points, so hunting pays but can't match finishing first.
export const POINTS = {
  /** A piece reaching the centre. */
  home: 20,
  /** Knocking out a piece in the first half of its track. */
  captureEarly: 5,
  /** ...between the halfway mark and the last 15%. */
  captureMid: 7,
  /** ...in the last 15% of its track. */
  captureLate: 10,
  /** ...in its home column, which only the opposite player's flight can reach. */
  captureHomeColumn: 20,
  /** Lost when a magic box turns out to take points. */
  boxPenalty: 10,
  /** For the first player to bring all four pieces home. */
  firstHome: 100,
} as const;

/** Knocking out the player who last knocked out one of yours is worth this much more, once per knock-out received. */
export const REVENGE = 1.5;

/** A game counts on the leaderboard only with at least this many people in it, so games against computers alone don't. */
export const RANKED_MIN_PEOPLE = 2;

export const EARLY_UNTIL = Math.floor(TRACK_LAST / 2);
export const LATE_FROM = Math.ceil(TRACK_LAST * 0.85);

/** Points for knocking out a piece standing at this seat-relative position. */
export function captureValue(pos: number): number {
  if (pos >= HOME_FIRST) return POINTS.captureHomeColumn;
  if (pos <= EARLY_UNTIL) return POINTS.captureEarly;
  if (pos >= LATE_FROM) return POINTS.captureLate;
  return POINTS.captureMid;
}
