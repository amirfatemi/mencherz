import { GOAL, HANGAR, HOME_FIRST, TAKEOFF, TRACK_LAST, isOnTrack, trackIndex, type Seat } from './board.ts';
import { distinctMoves, freeSquares, planMove, type GameState, type MovePlan } from './rules.ts';

export type BotLevel = 'easy' | 'normal' | 'hard';
export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'normal', 'hard'];

const value = (pos: number) => (pos === HANGAR ? 0 : pos + 2);

/** Chance that some opponent can land on this piece with their next roll. */
export function threatTo(state: GameState, seat: Seat, piece: number): number {
  const pos = state.pieces[seat][piece];
  if (!isOnTrack(pos)) return 0;
  let safe = 1;
  for (const other of state.active) {
    if (other === seat || state.ranking.includes(other)) continue;
    const hits = new Set<number>();
    state.pieces[other].forEach((p, j) => {
      if (p < TAKEOFF || p >= HOME_FIRST) return;
      for (let d = 1; d <= 6; d++) {
        if (hits.has(d)) continue;
        const plan = planMove(state, other, j, d);
        if (plan?.captures.some((c) => c.seat === seat && c.piece === piece)) hits.add(d);
      }
    });
    safe *= 1 - hits.size / 6;
  }
  return 1 - safe;
}

function applyPlan(state: GameState, plan: MovePlan): GameState {
  const pieces = state.pieces.map((row) => row.slice());
  pieces[plan.seat][plan.piece] = plan.to;
  for (const c of plan.captures) pieces[c.seat][c.piece] = HANGAR;
  return { ...state, pieces };
}

function score(state: GameState, plan: MovePlan, careful: boolean): number {
  const onBoard = state.pieces[plan.seat].filter((p) => p !== HANGAR && p !== GOAL).length;
  let s = value(plan.to) - value(plan.from);
  if (plan.from === HANGAR) s += 9 - onBoard * 2;
  for (const c of plan.captures) s += 12 + value(c.from) * 0.6;
  if (plan.to === GOAL) s += 18;
  if (plan.from < HOME_FIRST && plan.to >= HOME_FIRST) s += 6;
  if (plan.path.some((p) => p.kind === 'bounce')) s -= 4;
  if (plan.bombed) s -= plan.bombed.saved ? 3 : 15;
  // A magic box is a gamble: a 1 in 4 chance of a bomb, and of losing points.
  if (plan.box) s -= value(plan.to) * 0.25 + 1;
  // When points decide the winner, knock-outs and pieces home are worth chasing for their own sake.
  if (state.rules.winBy === 'points') s += plan.points * 1.5;
  if (careful) {
    const before = threatTo(state, plan.seat, plan.piece) * (value(plan.from) + 12);
    const after = threatTo(applyPlan(state, plan), plan.seat, plan.piece) * (value(plan.to) + 12);
    s += before - after;
  }
  return s;
}

/**
 * Picks a square for a bomb: where opponents are most likely to land next turn, weighted by how far
 * the piece has come, minus the same risk for the bomber's own pieces.
 */
export function chooseBomb(state: GameState, level: BotLevel, rand: () => number = Math.random): number {
  const options = freeSquares(state);
  if (level === 'easy' && rand() < 0.6) return options[Math.floor(rand() * options.length)];
  const risk = new Map<number, number>();
  for (const seat of state.active) {
    if (state.ranking.includes(seat)) continue;
    const sign = seat === state.turn ? -1.5 : 1;
    for (const p of state.pieces[seat]) {
      if (p < TAKEOFF || p >= TRACK_LAST) continue;
      for (let d = 1; d <= 6 && p + d <= TRACK_LAST; d++) {
        const sq = trackIndex(seat, p + d);
        risk.set(sq, (risk.get(sq) ?? 0) + sign * (1 + p / 20));
      }
    }
  }
  let best = options[0];
  let bestScore = -Infinity;
  for (const sq of options) {
    const sc = (risk.get(sq) ?? 0) + rand() * 0.3;
    if (sc > bestScore) {
      bestScore = sc;
      best = sq;
    }
  }
  return best;
}

/** Picks a square for a magic box at the start: the first stretch after the opponents' takeoff spots, where they all pass. */
export function chooseBox(state: GameState, level: BotLevel, rand: () => number = Math.random): number {
  const options = freeSquares(state);
  if (level === 'easy' && rand() < 0.6) return options[Math.floor(rand() * options.length)];
  const pull = new Map<number, number>();
  for (const seat of state.active) {
    if (seat === state.turn) continue;
    for (let p = 1; p <= 12; p++) {
      const sq = trackIndex(seat, p);
      pull.set(sq, (pull.get(sq) ?? 0) + (p <= 6 ? 1 : 0.5));
    }
  }
  let best = options[0];
  let bestScore = -Infinity;
  for (const sq of options) {
    const sc = (pull.get(sq) ?? 0) + rand() * 0.8;
    if (sc > bestScore) {
      bestScore = sc;
      best = sq;
    }
  }
  return best;
}

/** Picks which piece to move in the `move` phase. */
export function chooseMove(state: GameState, level: BotLevel, rand: () => number = Math.random): number {
  const options = distinctMoves(state);
  if (options.length === 1) return options[0];
  if (level === 'easy' && rand() < 0.6) return options[Math.floor(rand() * options.length)];

  const careful = level === 'hard';
  const plans = options.map((j) => planMove(state, state.turn, j, state.dice!));
  // Bots hunt first: any move that knocks a piece out beats the rest; then any move that brings one home.
  const hits = options.filter((_, i) => plans[i]?.captures.length);
  const homes = options.filter((_, i) => plans[i]?.to === GOAL);
  const pool = hits.length ? hits : homes.length ? homes : options;
  let best = pool[0];
  let bestScore = -Infinity;
  for (const j of pool) {
    const plan = plans[options.indexOf(j)];
    if (!plan) continue;
    const sc = score(state, plan, careful) + rand() * 0.5;
    if (sc > bestScore) {
      bestScore = sc;
      best = j;
    }
  }
  return best;
}
