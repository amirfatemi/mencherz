import { GOAL, PIECES_PER_SEAT, type Seat } from './board.ts';
import type { GameState, SeatStats } from './rules.ts';
import { killStreakName } from './scoring.ts';

// The end-of-game report, and the medals and titles players collect over the games that count.

/** A highlight of the game, for the report. */
export interface Award {
  id: string;
  icon: string;
  title: string;
  seat: Seat;
  detail: string;
}

/** The seat with the most of something, first in the standings on a tie; none when nobody has any. */
function leader(state: GameState, value: (st: SeatStats) => number, atLeast = 1): Seat | null {
  const order = state.standings.length ? state.standings : state.active;
  let best: Seat | null = null;
  for (const seat of order) {
    const v = value(state.stats[seat]) ?? 0;
    if (v >= atLeast && (best === null || v > (value(state.stats[best]) ?? 0))) best = seat;
  }
  return best;
}

/** Who stood out this game, and how. */
export function gameAwards(state: GameState): Award[] {
  const out: Award[] = [];
  const add = (seat: Seat | null, id: string, icon: string, title: string, detail: (st: SeatStats) => string) => {
    if (seat !== null) out.push({ id, icon, title, seat, detail: detail(state.stats[seat]) });
  };
  add(state.standings[0] ?? null, 'mvp', '🏆', 'Player of the match', (st) => `${st.points} points`);
  add(leader(state, (st) => st.captures), 'hunter', '🏹', 'Top hunter', (st) => `${st.captures} knock-outs`);
  add(leader(state, (st) => st.bestHit), 'bigHit', '🎯', 'Biggest hit', (st) => `+${st.bestHit} in one go`);
  add(leader(state, (st) => st.bestStreak, 2), 'spree', '💀', 'Killing spree', (st) => killStreakName(st.bestStreak) ?? '');
  add(leader(state, (st) => st.bombKills), 'bomber', '💣', 'Demolition expert', (st) => `blew up ${st.bombKills}`);
  add(leader(state, (st) => st.flights, 2), 'flyer', '✈', 'Frequent flyer', (st) => `${st.flights} flights`);
  add(leader(state, (st) => st.sixes, 3), 'sixes', '🎲', 'Six machine', (st) => `${st.sixes} sixes`);
  add(leader(state, (st) => st.lost), 'unlucky', '🤕', 'Unluckiest', (st) => `knocked out ${st.lost} times`);
  return out;
}

/** A medal: won in a game that counts, and kept for good. */
export interface Medal {
  id: string;
  icon: string;
  name: string;
  /** How to win it. */
  how: string;
  /** Whether a seat won it in this game. */
  won: (st: SeatStats, state: GameState, seat: Seat) => boolean;
}

export const MEDALS: readonly Medal[] = [
  { id: 'rocket', icon: '🚀', name: 'Rocket', how: 'First to bring all four pieces home', won: (_st, state, seat) => state.ranking[0] === seat && state.pieces[seat].every((p) => p === GOAL) },
  { id: 'hunter', icon: '🏹', name: 'Hunter', how: '8 or more knock-outs in one game', won: (st) => st.captures >= 8 },
  { id: 'spree', icon: '💀', name: 'Triple kill', how: 'One piece knocks out three in a row', won: (st) => st.bestStreak >= 3 },
  { id: 'sniper', icon: '🎯', name: 'Sniper', how: 'One knock-out worth 30 points or more', won: (st) => st.bestHit >= 30 },
  { id: 'demolisher', icon: '💣', name: 'Demolisher', how: 'Blow up 3 or more pieces in one game', won: (st) => st.bombKills >= 3 },
  { id: 'untouchable', icon: '🛡', name: 'Untouchable', how: 'Bring all four home without losing a piece', won: (st) => st.lost === 0 && st.home === PIECES_PER_SEAT },
  { id: 'phoenix', icon: '🔥', name: 'Phoenix', how: 'Knocked out 6 or more times, and still in the top two', won: (st, state, seat) => st.lost >= 6 && state.standings.slice(0, 2).includes(seat) },
];
export const MEDAL_BY_ID = new Map(MEDALS.map((m) => [m.id, m]));

/** The medals a seat won this game. */
export function medalsWon(state: GameState, seat: Seat): Medal[] {
  const st = state.stats[seat];
  return st ? MEDALS.filter((m) => m.won(st, state, seat)) : [];
}

/** Titles by total points over the games that count. */
export const TITLES = [
  { from: 0, icon: '🐣', name: 'Rookie' },
  { from: 150, icon: '✈', name: 'Pilot' },
  { from: 500, icon: '🧭', name: 'Captain' },
  { from: 1200, icon: '🦅', name: 'Ace' },
  { from: 2500, icon: '👑', name: 'Legend' },
] as const;

export function titleFor(points: number): (typeof TITLES)[number] {
  return [...TITLES].reverse().find((t) => points >= t.from) ?? TITLES[0];
}
