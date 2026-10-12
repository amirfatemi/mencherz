import { GOAL, HANGAR, HOME_FIRST, TAKEOFF, TRACK_LAST, isOnTrack, trackIndex, type Seat } from './board.ts';
import {
  bridgeTarget,
  distinctMoves,
  freeSquares,
  planMove,
  type BridgeKind,
  type GameState,
  type MovePlan,
  type PowerChoice,
} from './rules.ts';

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
  // A magic box is a gamble: a 1 in 5 chance each of a bomb and of being frozen in place; the points even out.
  if (plan.box) s -= value(plan.to) * 0.2 + 1;
  // A power square gives a bridge or a magic box.
  if (plan.power) s += 4;
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

/**
 * How good a bridge starting on each free square would be for the player placing it: for every piece that
 * might land there soon, its gain or loss (positive for the placer's own pieces, negative for opponents'),
 * weighted by the chance of landing there with the next roll or the one after.
 */
function bridgeValues(state: GameState, kind: BridgeKind): Map<number, number> {
  const out = new Map<number, number>();
  for (const seat of state.active) {
    if (state.ranking.includes(seat)) continue;
    const sign = seat === state.turn ? 1 : -1;
    for (const p of state.pieces[seat]) {
      if (p < TAKEOFF || p >= TRACK_LAST) continue;
      for (let d = 1; d <= 12 && p + d <= TRACK_LAST; d++) {
        const to = bridgeTarget(kind, p + d);
        if (to === null) continue;
        const chance = d <= 6 ? 1 / 6 : 1 / 36;
        const sq = trackIndex(seat, p + d);
        out.set(sq, (out.get(sq) ?? 0) + sign * chance * (to - (p + d)));
      }
    }
  }
  return out;
}

/** Picks where a bridge starts: where it most helps the placer, or most hurts the others. */
export function chooseBridge(state: GameState, kind: BridgeKind, level: BotLevel, rand: () => number = Math.random): number {
  const options = freeSquares(state);
  if (level === 'easy' && rand() < 0.6) return options[Math.floor(rand() * options.length)];
  const values = bridgeValues(state, kind);
  let best = options[0];
  let bestScore = -Infinity;
  for (const sq of options) {
    const sc = (values.get(sq) ?? 0) + rand() * 0.05;
    if (sc > bestScore) {
      bestScore = sc;
      best = sq;
    }
  }
  return best;
}

/** Picks a power: the better of the best bridge of each kind, or a magic box when neither does much. */
export function choosePower(state: GameState, level: BotLevel, rand: () => number = Math.random): PowerChoice {
  if (level === 'easy') return (['heaven', 'hell', 'box'] as const)[Math.floor(rand() * 3)];
  const free = freeSquares(state);
  const best = (kind: BridgeKind) => {
    const values = bridgeValues(state, kind);
    return Math.max(0, ...free.map((sq) => values.get(sq) ?? 0));
  };
  const heaven = best('heaven');
  const hell = best('hell');
  // A box in front of the others is worth a little whatever it holds; a bridge's value is in squares over a turn or two.
  const box = 1.5;
  if (box >= heaven && box >= hell) return 'box';
  return heaven >= hell ? 'heaven' : 'hell';
}

/** One thing to do in the current phase. Rolls carry no dice: whoever applies the action rolls. */
export type BotAction =
  | { type: 'roll' }
  | { type: 'move'; piece: number }
  | { type: 'bomb' | 'box' | 'place'; square: number }
  | { type: 'power'; choice: PowerChoice };

/** What a bot does next, whatever the phase; also plays the turn of a player whose time ran out. */
export function botAction(state: GameState, level: BotLevel, rand: () => number = Math.random): BotAction | null {
  switch (state.phase) {
    case 'roll':
      return { type: 'roll' };
    case 'move':
      return { type: 'move', piece: chooseMove(state, level, rand) };
    case 'bomb':
      return { type: 'bomb', square: chooseBomb(state, level, rand) };
    case 'box':
      return { type: 'box', square: chooseBox(state, level, rand) };
    case 'power':
      return { type: 'power', choice: choosePower(state, level, rand) };
    case 'place':
      // A box from a power square goes where a bomb would: in front of the others' pieces.
      if (state.placing === 'box') return { type: 'place', square: chooseBomb(state, level, rand) };
      return state.placing ? { type: 'place', square: chooseBridge(state, state.placing, level, rand) } : null;
    default:
      return null;
  }
}
