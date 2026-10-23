import {
  FLIGHT_DISTANCE,
  FLIGHT_FROM,
  GOAL,
  HANGAR,
  HOME_FIRST,
  HOME_LAST,
  TAKEOFF,
  TRACK_LAST,
  flightCrossedSeat,
  isOnTrack,
  trackColor,
  trackIndex,
  type Seat,
} from './board.ts';
import {
  SUPER_BOMB_REACH,
  availablePowers,
  ambushTargets,
  asSeen,
  bridgeTarget,
  distinctMoves,
  freeSquares,
  planMove,
  safeSquareOptions,
  ambushStart,
  vestOptions,
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
  // Bots don't see through fog either.
  const seen = asSeen(state);
  const plans = options.map((j) => planMove(seen, seen.turn, j, seen.dice!));
  // Bots hunt first: any move that knocks a piece out beats the rest; then any move that brings one home.
  const hits = options.filter((_, i) => plans[i]?.captures.length);
  const homes = options.filter((_, i) => plans[i]?.to === GOAL);
  const pool = hits.length ? hits : homes.length ? homes : options;
  let best = pool[0];
  let bestScore = -Infinity;
  for (const j of pool) {
    const plan = plans[options.indexOf(j)];
    if (!plan) continue;
    const sc = score(seen, plan, careful) + rand() * 0.5;
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

/** A power picked by a bot, with whose home column an ambush opens. */
export interface PowerPick {
  choice: PowerChoice;
  over?: Seat;
}

/** The bot's piece most worth protecting with a safe square: likely to be hit, and far along. */
function safeCandidate(state: GameState): { square: number; value: number } | null {
  const me = state.turn;
  const options = new Set(safeSquareOptions(state));
  let best: { square: number; value: number } | null = null;
  state.pieces[me].forEach((p, j) => {
    if (!isOnTrack(p) || !options.has(trackIndex(me, p))) return;
    const worth = threatTo(state, me, j) * value(p);
    if (!best || worth > best.value) best = { square: trackIndex(me, p), value: worth };
  });
  return best;
}

/** For each other player, how much an ambush over their home column might win: their pieces there, times the chance of taking that flight soon. */
function ambushValues(state: GameState): { over: Seat; value: number }[] {
  const me = state.turn;
  return ambushTargets(state).map((over) => {
    const inColumn = state.pieces[over].filter((p) => p >= HOME_FIRST && p <= HOME_LAST).length;
    // The bot's own way over that column: its ✈ square, or the ambush square if it's the bot's colour.
    const square = me === flightCrossedSeat(over) ? trackIndex(me, FLIGHT_FROM) : trackColor(ambushStart(over)) === me ? ambushStart(over) : undefined;
    if (square === undefined) return { over, value: 0 };
    let chance = 0;
    for (const p of state.pieces[me]) {
      if (p < TAKEOFF || p >= TRACK_LAST) continue;
      for (let d = 1; d <= 12 && p + d + FLIGHT_DISTANCE <= TRACK_LAST; d++) {
        if (trackIndex(me, p + d) === square) chance += d <= 6 ? 1 / 6 : 1 / 36;
      }
    }
    return { over, value: chance * inColumn * 10 };
  });
}

/** Picks a power: whichever of the bridges, an ambush or a safe square looks best, or a magic box when none does much. */
export function choosePower(state: GameState, level: BotLevel, rand: () => number = Math.random): PowerPick {
  const targets = ambushTargets(state);
  const open = availablePowers(state);
  if (level === 'easy') {
    const choice = open[Math.floor(rand() * open.length)];
    return choice === 'ambush' ? { choice, over: targets[Math.floor(rand() * targets.length)] } : { choice };
  }
  const free = freeSquares(state);
  const best = (kind: BridgeKind) => {
    const values = bridgeValues(state, kind);
    return Math.max(0, ...free.map((sq) => values.get(sq) ?? 0));
  };
  const ambush = ambushValues(state).sort((a, b) => b.value - a.value)[0];
  // A box in front of the others is worth a little whatever it holds; the rest are valued in squares over a turn or two.
  const options: { pick: PowerPick; value: number }[] = [
    { pick: { choice: 'box' }, value: 1.5 },
    { pick: { choice: 'heaven' }, value: best('heaven') },
    { pick: { choice: 'hell' }, value: best('hell') },
    { pick: { choice: 'safe' }, value: (safeCandidate(state)?.value ?? 0) * 0.5 },
  ];
  if (ambush) options.push({ pick: { choice: 'ambush', over: ambush.over }, value: ambush.value });
  options.push({ pick: { choice: 'superBomb' }, value: superBombPlan(state)?.value ?? 0 });
  return options.filter((o) => open.includes(o.pick.choice)).reduce((a, b) => (b.value > a.value ? b : a)).pick;
}

/**
 * The best square for a super bomb: where opponents' pieces are likely to land next, plus how many of
 * their pieces (and how few of the bot's) stand within the blast's reach.
 */
function superBombPlan(state: GameState): { square: number; value: number } | null {
  const near = new Map<number, number>();
  for (const seat of state.active) {
    if (state.ranking.includes(seat)) continue;
    const sign = seat === state.turn ? -1.5 : 1;
    for (const p of state.pieces[seat]) {
      if (!isOnTrack(p)) continue;
      const sq = trackIndex(seat, p);
      for (let d = -SUPER_BOMB_REACH; d <= SUPER_BOMB_REACH; d++) {
        const at = (sq + d + 52) % 52;
        near.set(at, (near.get(at) ?? 0) + sign * (1 + p / 20));
      }
    }
  }
  let best: { square: number; value: number } | null = null;
  for (const sq of freeSquares(state)) {
    const value = (near.get(sq) ?? 0) * 1.5;
    if (!best || value > best.value) best = { square: sq, value };
  }
  return best;
}

/** Picks where a safe square goes: under the piece most worth protecting, or else just ahead of the bot's lead piece. */
export function chooseSafe(state: GameState, rand: () => number = Math.random): number {
  const pick = safeCandidate(state);
  if (pick) return pick.square;
  const options = safeSquareOptions(state);
  return options[Math.floor(rand() * options.length)];
}

/** Picks who wears a vest: the piece furthest along, which has most to lose to a bomb. */
export function chooseVest(state: GameState): number {
  const pieces = state.pieces[state.turn];
  return vestOptions(state).reduce((best, j) => (pieces[j] > pieces[best] ? j : best));
}

/** One thing to do in the current phase. Rolls carry no dice: whoever applies the action rolls. */
export type BotAction =
  | { type: 'roll' }
  | { type: 'move' | 'vest'; piece: number }
  | { type: 'bomb' | 'box' | 'place'; square: number }
  | { type: 'power'; choice: PowerChoice; over?: Seat };

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
      return { type: 'power', ...choosePower(state, level, rand) };
    case 'vest':
      return { type: 'vest', piece: chooseVest(state) };
    case 'place':
      // A box from a power square goes where a bomb would: in front of the others' pieces.
      if (state.placing === 'box') return { type: 'place', square: chooseBomb(state, level, rand) };
      if (state.placing === 'safe') return { type: 'place', square: chooseSafe(state, rand) };
      if (state.placing === 'superBomb') return { type: 'place', square: superBombPlan(state)?.square ?? chooseBomb(state, level, rand) };
      return state.placing ? { type: 'place', square: chooseBridge(state, state.placing, level, rand) } : null;
    default:
      return null;
  }
}
