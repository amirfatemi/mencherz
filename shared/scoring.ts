import { HOME_FIRST, TRACK_LAST } from './board.ts';

export const POINTS = {
  /** A piece reaching the centre. */
  home: 100,
  /** Knocking out a piece in the first half of its track. */
  captureEarly: 20,
  /** ...between the halfway mark and the last 15%. */
  captureMid: 25,
  /** ...in the last 15% of its track. */
  captureLate: 30,
  /** ...in its home column, which only the opposite player's flight can reach. */
  captureHomeColumn: 70,
  /** Lost when a magic box turns out to take points. */
  boxPenalty: 10,
} as const;

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
