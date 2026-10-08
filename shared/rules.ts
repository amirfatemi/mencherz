import {
  FLIGHT_CROSSES,
  FLIGHT_FROM,
  FLIGHT_TO,
  GOAL,
  HANGAR,
  JUMP_DISTANCE,
  LAYOUT_VERSION,
  PIECES_PER_SEAT,
  SEATS,
  TAKEOFF,
  TRACK_LAST,
  TRACK_LEN,
  flightCrossedSeat,
  isOnTrack,
  isOwnColor,
  trackIndex,
  type Seat,
} from './board.ts';
import { POINTS, captureValue } from './scoring.ts';

export interface Rules {
  /** Dice values that launch a plane from the hangar to the takeoff spot. */
  launchOn: 'six' | 'fiveSix' | 'even';
  /** Rolling a 6 gives another roll. */
  bonusRollOnSix: boolean;
  /**
   * What a third six in a row does: nothing, ends the turn, sends the planes moved on the sixes back to the
   * hangar (penalty), or sends every piece not yet in the centre back (hangar).
   */
  threeSixes: 'off' | 'forfeit' | 'penalty' | 'hangar';
  /** After a three-sixes penalty the player places a bomb on a free track square; whoever lands on it goes back to the hangar. */
  bombs: boolean;
  /** How mean the dice is: harder makes a third six and landing on a bomb more likely. Normal is a fair dice. */
  difficulty: 'easy' | 'normal' | 'hard';
  /**
   * Before the first roll everyone hides a magic box on a track square. Another player's piece landing on it
   * opens it: a bomb, a protective vest, nothing, or lost points, at random.
   */
  magicBoxes: boolean;
  /** Overshooting the goal bounces back, or the move is not allowed. */
  finish: 'bounce' | 'exact';
  /** Landing on your own colour jumps to the next square of that colour. */
  jumps: boolean;
  /** Landing on your flight square flies across the board. */
  flights: boolean;
  /** A flight sends back an opponent sitting on the home-column square it crosses. */
  flightCapture: boolean;
  /** Capturing an opponent gives another roll. */
  bonusRollOnCapture: boolean;
  /** Stop when the first player finishes, or play on for the full ranking. */
  playUntil: 'winner' | 'all';
  /** Rank by points (pieces home and knock-outs), or by who brought everything home first. */
  winBy: 'points' | 'race';
}

export const DEFAULT_RULES: Rules = {
  launchOn: 'six',
  bonusRollOnSix: true,
  threeSixes: 'hangar',
  bombs: true,
  difficulty: 'normal',
  magicBoxes: true,
  finish: 'bounce',
  jumps: true,
  flights: true,
  flightCapture: true,
  bonusRollOnCapture: false,
  playUntil: 'winner',
  winBy: 'points',
};

export type Phase = 'box' | 'roll' | 'move' | 'bomb' | 'over';

export interface Bomb {
  /** Absolute track index (0..51), as in TRACK. */
  square: number;
  owner: Seat;
}

/** A magic box; it does nothing to its owner's pieces. */
export interface MagicBox {
  square: number;
  owner: Seat;
}

export type BoxOutcome = 'bomb' | 'vest' | 'empty' | 'minus';
export const BOX_OUTCOMES: readonly BoxOutcome[] = ['bomb', 'vest', 'empty', 'minus'];

export interface SeatStats {
  points: number;
  /** Pieces brought to the centre. */
  home: number;
  /** Opponent pieces knocked out. */
  captures: number;
  /** Own pieces knocked out. */
  lost: number;
}

export interface GameState {
  /** Board numbering the positions use (see LAYOUT_VERSION). */
  layout: number;
  rules: Rules;
  /** Seats taking part, in turn order. */
  active: Seat[];
  /** pieces[seat][piece] = seat-relative position (see board.ts). */
  pieces: number[][];
  turn: Seat;
  phase: Phase;
  dice: number | null;
  movable: number[];
  sixStreak: number;
  streakMoved: number[];
  /** Seats in the order they brought all pieces home; at game over, every seat. */
  ranking: Seat[];
  /** Final places, set when the game ends (by points or by race, per the rules). */
  standings: Seat[];
  stats: SeatStats[];
  bombs: Bomb[];
  boxes: MagicBox[];
  /** Protective vests per seat: each one stops a bomb once. */
  vests: number[];
  turnNo: number;
  seq: number;
}

export type StepKind = 'launch' | 'step' | 'bounce' | 'jump' | 'fly';

export interface PathStep {
  pos: number;
  kind: StepKind;
}

export interface Capture {
  seat: Seat;
  piece: number;
  from: number;
  /** Index in the mover's path at which the capture happens. */
  atStep: number;
  byFlight: boolean;
  points: number;
}

/** A piece landing on a bomb: it goes back to the hangar and the bomb is used up. */
export interface BombHit {
  owner: Seat;
  square: number;
  /** The mover's position on the bomb square. */
  pos: number;
  /** Index in the mover's path where it lands on the bomb. */
  atStep: number;
  /** Points for the bomb's owner (none when it's their own bomb, or a vest stopped it). */
  points: number;
  /** A protective vest took the blast: the piece carries on and the vest is used up. */
  saved: boolean;
}

/** A piece opening someone's magic box. */
export interface BoxHit {
  owner: Seat;
  square: number;
  pos: number;
  atStep: number;
  /** Unknown while previewing a move; drawn when the move is made. */
  outcome?: BoxOutcome;
  /** It was a bomb and a vest stopped it. */
  saved: boolean;
  /** Points for the box's owner when its bomb goes off. */
  points: number;
}

export interface MovePlan {
  seat: Seat;
  piece: number;
  dice: number;
  from: number;
  to: number;
  path: PathStep[];
  captures: Capture[];
  jumped: boolean;
  flew: boolean;
  /** Points the move earns: knock-outs plus a piece reaching the centre. */
  points: number;
  bombed?: BombHit;
  box?: BoxHit;
}

export type RollOutcome = 'move' | 'pass' | 'again' | 'forfeit' | 'penalty';

export interface RollEvent {
  type: 'roll';
  seat: Seat;
  dice: number;
  outcome: RollOutcome;
  movable: number[];
  /** Pieces sent back to the hangar by the three-sixes penalty. */
  penalized: { piece: number; from: number }[];
  /** The roller now places a bomb. */
  bomb?: boolean;
}

export interface BombEvent {
  type: 'bomb';
  seat: Seat;
  square: number;
}

export interface BoxEvent {
  type: 'box';
  seat: Seat;
  square: number;
}

export interface MoveEvent extends MovePlan {
  type: 'move';
  extraRoll: boolean;
  seatFinished: boolean;
  gameOver: boolean;
}

export type GameEvent = RollEvent | MoveEvent | BombEvent | BoxEvent;

export class RuleError extends Error {}

export function canLaunch(rules: Rules, dice: number): boolean {
  switch (rules.launchOn) {
    case 'six':
      return dice === 6;
    case 'fiveSix':
      return dice >= 5;
    case 'even':
      return dice % 2 === 0;
  }
}

export function createGame(active: Seat[], rules: Rules = DEFAULT_RULES, firstTurn?: Seat): GameState {
  if (active.length < 2) throw new RuleError('At least two players are needed');
  const order = SEATS.filter((s) => active.includes(s));
  return {
    layout: LAYOUT_VERSION,
    rules: { ...rules },
    active: order,
    pieces: SEATS.map(() => Array.from({ length: PIECES_PER_SEAT }, () => HANGAR)),
    // With magic boxes, everyone hides theirs first, starting with the first player.
    turn: firstTurn !== undefined && order.includes(firstTurn) ? firstTurn : order[0],
    phase: rules.magicBoxes ? 'box' : 'roll',
    dice: null,
    movable: [],
    sixStreak: 0,
    streakMoved: [],
    ranking: [],
    standings: [],
    stats: SEATS.map(() => ({ points: 0, home: 0, captures: 0, lost: 0 })),
    bombs: [],
    boxes: [],
    vests: SEATS.map(() => 0),
    turnNo: 1,
    seq: 0,
  };
}

/**
 * Works out where a piece would go with this roll, or null if the move is not allowed. Does not change `state`.
 * `openBox` draws what a magic box holds; without it (previews, bots) a box's outcome is left unknown.
 */
export function planMove(state: GameState, seat: Seat, piece: number, dice: number, openBox?: () => BoxOutcome): MovePlan | null {
  const { rules } = state;
  const from = state.pieces[seat][piece];
  if (from === GOAL) return null;

  const plan: MovePlan = { seat, piece, dice, from, to: from, path: [], captures: [], jumped: false, flew: false, points: 0 };

  if (from === HANGAR) {
    if (!canLaunch(rules, dice)) return null;
    plan.to = TAKEOFF;
    plan.path.push({ pos: TAKEOFF, kind: 'launch' });
    return plan;
  }

  const target = from + dice;
  let cur: number;
  if (target > GOAL) {
    if (rules.finish === 'exact') return null;
    for (let p = from + 1; p <= GOAL; p++) plan.path.push({ pos: p, kind: 'step' });
    const back = target - GOAL;
    for (let i = 1; i <= back; i++) plan.path.push({ pos: GOAL - i, kind: 'bounce' });
    cur = GOAL - back;
  } else {
    for (let p = from + 1; p <= target; p++) plan.path.push({ pos: p, kind: 'step' });
    cur = target;
  }

  // Positions of everyone else, updated as captures happen along the chain.
  const taken = new Set<string>();
  const captureAt = (pos: number) => {
    if (!isOnTrack(pos)) return;
    const idx = trackIndex(seat, pos);
    for (const other of state.active) {
      if (other === seat) continue;
      state.pieces[other].forEach((p, j) => {
        const key = `${other}:${j}`;
        if (taken.has(key) || !isOnTrack(p) || trackIndex(other, p) !== idx) return;
        taken.add(key);
        plan.captures.push({ seat: other, piece: j, from: p, atStep: plan.path.length - 1, byFlight: false, points: captureValue(p) });
      });
    }
  };

  // Everything that happens where the piece lands: a bomb, knock-outs, then a magic box. Returns true
  // when the piece is blown back to the hangar, which ends the move.
  let vests = state.vests?.[seat] ?? 0;
  const land = (pos: number): boolean => {
    if (!isOnTrack(pos)) return false;
    const square = trackIndex(seat, pos);
    const atStep = plan.path.length - 1;
    const bomb = state.bombs.find((b) => b.square === square);
    if (bomb && !plan.bombed) {
      const saved = vests > 0;
      if (saved) vests--;
      plan.bombed = { owner: bomb.owner, square, pos, atStep, points: saved || bomb.owner === seat ? 0 : captureValue(pos), saved };
      if (!saved) return true;
    }
    captureAt(pos);
    const box = state.boxes?.find((b) => b.square === square && b.owner !== seat);
    if (box && !plan.box) {
      const outcome = openBox?.();
      const blast = outcome === 'bomb';
      const saved = blast && vests > 0;
      if (saved) vests--;
      if (outcome === 'vest') vests++;
      plan.box = { owner: box.owner, square, pos, atStep, outcome, saved, points: blast && !saved ? captureValue(pos) : 0 };
      if (blast && !saved) return true;
    }
    return false;
  };

  if (land(cur)) return finishPlan(plan, HANGAR);
  if (isOnTrack(cur)) {
    for (;;) {
      if (rules.flights && !plan.flew && cur === FLIGHT_FROM) {
        if (rules.flightCapture) {
          const crossed = flightCrossedSeat(seat);
          if (state.active.includes(crossed)) {
            state.pieces[crossed].forEach((p, j) => {
              const key = `${crossed}:${j}`;
              if (p !== FLIGHT_CROSSES || taken.has(key)) return;
              taken.add(key);
              plan.captures.push({ seat: crossed, piece: j, from: p, atStep: plan.path.length, byFlight: true, points: captureValue(p) });
            });
          }
        }
        cur = FLIGHT_TO;
        plan.flew = true;
        plan.path.push({ pos: cur, kind: 'fly' });
        if (land(cur)) return finishPlan(plan, HANGAR);
        continue;
      }
      if (rules.jumps && !plan.jumped && isOwnColor(cur) && cur < TRACK_LAST) {
        cur += JUMP_DISTANCE;
        plan.jumped = true;
        plan.path.push({ pos: cur, kind: 'jump' });
        if (land(cur)) return finishPlan(plan, HANGAR);
        continue;
      }
      break;
    }
  }

  return finishPlan(plan, cur);
}

function finishPlan(plan: MovePlan, to: number): MovePlan {
  plan.to = to;
  plan.points =
    plan.captures.reduce((sum, c) => sum + c.points, 0) +
    (to === GOAL ? POINTS.home : 0) -
    (plan.box?.outcome === 'minus' ? POINTS.boxPenalty : 0);
  return plan;
}

/** The bomb (placed, or from a magic box) that blew this move's piece back to the hangar, if any. */
export function blastOf(plan: MovePlan): { owner: Seat; square: number; pos: number; atStep: number; points: number } | null {
  if (plan.bombed && !plan.bombed.saved) return plan.bombed;
  if (plan.box?.outcome === 'bomb' && !plan.box.saved) return plan.box;
  return null;
}

/** Track squares (absolute indices) free for a bomb or a magic box: no piece, bomb or box on them. */
export function freeSquares(state: GameState): number[] {
  const used = new Set([...state.bombs, ...(state.boxes ?? [])].map((b) => b.square));
  for (const seat of state.active) {
    for (const p of state.pieces[seat]) if (isOnTrack(p)) used.add(trackIndex(seat, p));
  }
  return Array.from({ length: TRACK_LEN }, (_, i) => i).filter((i) => !used.has(i));
}

export function legalPieces(state: GameState, seat: Seat, dice: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < PIECES_PER_SEAT; j++) {
    if (planMove(state, seat, j, dice)) out.push(j);
  }
  return out;
}

/** One representative per group of movable pieces that would make the same move. */
export function distinctMoves(state: GameState): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const j of state.movable) {
    const pos = state.pieces[state.turn][j];
    if (seen.has(pos)) continue;
    seen.add(pos);
    out.push(j);
  }
  return out;
}

export function seatFinished(state: GameState, seat: Seat): boolean {
  return state.pieces[seat].every((p) => p === GOAL);
}

function nextTurn(s: GameState): void {
  s.sixStreak = 0;
  s.streakMoved = [];
  s.dice = null;
  s.movable = [];
  const order = s.active;
  const idx = order.indexOf(s.turn);
  for (let i = 1; i <= order.length; i++) {
    const cand = order[(idx + i) % order.length];
    if (!s.ranking.includes(cand)) {
      s.turn = cand;
      s.phase = 'roll';
      s.turnNo++;
      return;
    }
  }
  s.phase = 'over';
}

export function applyRoll(state: GameState, dice: number): { state: GameState; event: RollEvent } {
  if (state.phase !== 'roll') throw new RuleError('Not time to roll');
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) throw new RuleError('Bad dice value');

  const s = structuredClone(state);
  const seat = s.turn;
  s.seq++;
  s.dice = dice;
  const event: RollEvent = { type: 'roll', seat, dice, outcome: 'move', movable: [], penalized: [] };

  if (dice === 6) {
    s.sixStreak++;
  } else {
    s.sixStreak = 0;
    s.streakMoved = [];
  }

  if (dice === 6 && s.sixStreak >= 3 && s.rules.bonusRollOnSix && s.rules.threeSixes !== 'off') {
    if (s.rules.threeSixes === 'penalty' || s.rules.threeSixes === 'hangar') {
      const back = s.rules.threeSixes === 'hangar' ? s.pieces[seat].map((_, j) => j) : [...new Set(s.streakMoved)];
      for (const j of back) {
        const from = s.pieces[seat][j];
        if (from === GOAL || from === HANGAR) continue;
        s.pieces[seat][j] = HANGAR;
        event.penalized.push({ piece: j, from });
      }
      event.outcome = 'penalty';
    } else {
      event.outcome = 'forfeit';
    }
    if (s.rules.bombs && event.outcome === 'penalty' && freeSquares(s).length) {
      // The same player stays on to place a bomb; the turn passes once it's down.
      event.bomb = true;
      s.phase = 'bomb';
      s.dice = null;
      s.movable = [];
      s.sixStreak = 0;
      s.streakMoved = [];
    } else {
      nextTurn(s);
    }
    return { state: s, event };
  }

  const movable = legalPieces(s, seat, dice);
  event.movable = movable;
  if (movable.length > 0) {
    s.phase = 'move';
    s.movable = movable;
  } else if (dice === 6 && s.rules.bonusRollOnSix) {
    event.outcome = 'again';
    s.dice = null;
  } else {
    event.outcome = 'pass';
    nextTurn(s);
  }
  return { state: s, event };
}

/** `rand(n)` gives an integer in [0, n); it decides what a magic box holds. */
export function applyMove(
  state: GameState,
  piece: number,
  rand: (n: number) => number = (n) => Math.floor(Math.random() * n),
): { state: GameState; event: MoveEvent } {
  if (state.phase !== 'move' || state.dice === null) throw new RuleError('Not time to move');
  if (!state.movable.includes(piece)) throw new RuleError('That plane cannot move');

  const seat = state.turn;
  const dice = state.dice;
  const plan = planMove(state, seat, piece, dice, () => BOX_OUTCOMES[rand(BOX_OUTCOMES.length)]);
  if (!plan) throw new RuleError('That plane cannot move');

  const s = structuredClone(state);
  s.seq++;
  s.pieces[seat][piece] = plan.to;
  for (const c of plan.captures) {
    s.pieces[c.seat][c.piece] = HANGAR;
    s.stats[c.seat].lost++;
  }
  s.stats[seat].captures += plan.captures.length;
  s.stats[seat].points += plan.points;
  if (plan.bombed) {
    const { owner, square, points, saved } = plan.bombed;
    s.bombs = s.bombs.filter((b) => b.square !== square);
    if (saved) s.vests[seat]--;
    else {
      s.stats[seat].lost++;
      if (owner !== seat) {
        s.stats[owner].captures++;
        s.stats[owner].points += points;
      }
    }
  }
  if (plan.box) {
    const { owner, square, points, saved, outcome } = plan.box;
    s.boxes = s.boxes.filter((b) => b.square !== square);
    if (outcome === 'vest') s.vests[seat]++;
    if (outcome === 'bomb' && saved) s.vests[seat]--;
    if (outcome === 'bomb' && !saved) {
      s.stats[seat].lost++;
      s.stats[owner].captures++;
      s.stats[owner].points += points;
    }
  }
  if (plan.to === GOAL) s.stats[seat].home++;
  if (dice === 6) s.streakMoved.push(piece);

  const event: MoveEvent = { ...plan, type: 'move', extraRoll: false, seatFinished: false, gameOver: false };

  if (seatFinished(s, seat)) {
    event.seatFinished = true;
    s.ranking.push(seat);
    const remaining = s.active
      .filter((x) => !s.ranking.includes(x))
      .sort((a, b) => progressOf(s, b) - progressOf(s, a));
    if (s.rules.playUntil === 'winner' || remaining.length <= 1) {
      s.ranking.push(...remaining);
      s.standings = standingsOf(s);
      s.phase = 'over';
      s.dice = null;
      s.movable = [];
      event.gameOver = true;
      return { state: s, event };
    }
    nextTurn(s);
    return { state: s, event };
  }

  const extra =
    (dice === 6 && s.rules.bonusRollOnSix) || (s.rules.bonusRollOnCapture && plan.captures.length > 0);
  if (extra) {
    event.extraRoll = true;
    s.phase = 'roll';
    s.dice = null;
    s.movable = [];
    if (dice !== 6) {
      s.sixStreak = 0;
      s.streakMoved = [];
    }
  } else {
    nextTurn(s);
  }
  return { state: s, event };
}

/** Hides the current player's magic box; once everyone has one down, the first player rolls. */
export function applyBox(state: GameState, square: number): { state: GameState; event: BoxEvent } {
  if (state.phase !== 'box') throw new RuleError('Not time to place a magic box');
  if (!freeSquares(state).includes(square)) throw new RuleError('A magic box can only go on an empty track square');
  const s = structuredClone(state);
  s.seq++;
  const event: BoxEvent = { type: 'box', seat: s.turn, square };
  s.boxes.push({ square, owner: s.turn });
  // Boxes go down in turn order from the first player, so the seat after the last one is the first player again.
  s.turn = s.active[(s.active.indexOf(s.turn) + 1) % s.active.length];
  if (s.active.every((seat) => s.boxes.some((b) => b.owner === seat))) s.phase = 'roll';
  return { state: s, event };
}

export function applyBomb(state: GameState, square: number): { state: GameState; event: BombEvent } {
  if (state.phase !== 'bomb') throw new RuleError('Not time to place a bomb');
  if (!freeSquares(state).includes(square)) throw new RuleError('A bomb can only go on an empty track square');
  const s = structuredClone(state);
  s.seq++;
  const event: BombEvent = { type: 'bomb', seat: s.turn, square };
  s.bombs.push({ square, owner: s.turn });
  nextTurn(s);
  return { state: s, event };
}

/**
 * Final places. By points: most points first, then more pieces home, then the finishing order
 * (which already ranks unfinished seats by progress). By race: the finishing order.
 */
export function standingsOf(state: GameState): Seat[] {
  if (state.rules.winBy === 'race') return [...state.ranking];
  const place = (s: Seat) => {
    const i = state.ranking.indexOf(s);
    return i === -1 ? Infinity : i;
  };
  return [...state.active].sort(
    (a, b) =>
      state.stats[b].points - state.stats[a].points ||
      state.stats[b].home - state.stats[a].home ||
      place(a) - place(b) ||
      progressOf(state, b) - progressOf(state, a),
  );
}

/** Rough distance covered by a seat's planes, for tie-breaks and bots. */
export function progressOf(state: GameState, seat: Seat): number {
  return state.pieces[seat].reduce((sum, p) => sum + (p === HANGAR ? 0 : p + 1), 0);
}

