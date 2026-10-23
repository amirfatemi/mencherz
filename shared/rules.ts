import {
  FLIGHT_CROSSES,
  FLIGHT_DISTANCE,
  FLIGHT_FROM,
  GOAL,
  HANGAR,
  HOME_FIRST,
  HOME_LAST,
  JUMP_DISTANCE,
  LAYOUT_VERSION,
  PIECES_PER_SEAT,
  SEATS,
  TAKEOFF,
  TRACK_FIRST,
  TRACK_LAST,
  TRACK_LEN,
  flightCrossedSeat,
  isOnTrack,
  isOwnColor,
  trackColor,
  trackIndex,
  type Seat,
} from './board.ts';
import { KING, POINTS, REVENGE, captureValue, killStreakBonus } from './scoring.ts';

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
   * Before the first roll everyone hides a magic box on a track square. Any piece landing on it, its
   * owner's included, opens it: a bomb, a protective vest, points won or lost, or ice, at random.
   */
  magicBoxes: boolean;
  /** Overshooting the goal bounces back, or the move is not allowed. */
  finish: 'bounce' | 'exact';
  /** Landing on your own colour jumps to the next square of that colour, unless the landing knocks a piece out. */
  jumps: boolean;
  /** Landing on your flight square flies across the board, unless the landing knocks a piece out. */
  flights: boolean;
  /** A flight sends back an opponent sitting on the home-column square it crosses. */
  flightCapture: boolean;
  /** Capturing an opponent gives another roll. */
  bonusRollOnCapture: boolean;
  /**
   * Two or more pieces of one colour on a track square make a wall: other colours can't pass it, not even
   * with a colour jump. Landing on it knocks out every piece there.
   */
  walls: boolean;
  /**
   * A power square that moves every few rounds. Ending a move on it picks a
   * heaven bridge, a hell bridge or a magic box to hide.
   */
  powerSquares: boolean;
  /** Each colour's first piece is a king: knocking one out counts KING times. */
  kings: boolean;
  /** Stop when the first player finishes, or play on until only one is left (the full ranking). */
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
  walls: true,
  powerSquares: true,
  kings: true,
  playUntil: 'all',
  winBy: 'points',
};

/**
 * 'place': putting down what was picked on a power square (a bridge, a magic box or a safe square).
 * 'vest': picking which piece wears a vest from a magic box.
 */
export type Phase = 'box' | 'roll' | 'move' | 'bomb' | 'power' | 'place' | 'vest' | 'over';

export interface Bomb {
  /** Absolute track index (0..51), as in TRACK. */
  square: number;
  owner: Seat;
  /** A super bomb, from a power square: its blast also takes every piece within SUPER_BOMB_REACH squares. */
  super?: boolean;
}

/** How far along the track, ahead or behind, a super bomb's blast reaches. Home columns are out of reach. */
export const SUPER_BOMB_REACH = 2;

/** A magic box. Whoever lands on it first opens it, the owner too. */
export interface MagicBox {
  square: number;
  owner: Seat;
}

/**
 * 'plus' and 'minus' give and take points; 'freeze' locks the piece where it opened the box until its
 * owner's next turn is over.
 */
export type BoxOutcome = 'bomb' | 'vest' | 'plus' | 'minus' | 'freeze';
export const BOX_OUTCOMES: readonly BoxOutcome[] = ['bomb', 'vest', 'plus', 'minus', 'freeze'];

/** Which of each colour's pieces is the king, when kings are on. */
export const KING_PIECE = 0;

export function isKing(state: GameState, piece: number): boolean {
  return !!state.rules.kings && piece === KING_PIECE;
}

/** What a box's ice sets a piece's `frozen` count to: the rest of this turn, then the owner's whole next turn. */
const FROZEN_TURNS = 2;

/**
 * A bridge, placed from a power square: whoever lands on its square first, its owner too, is carried
 * along the track, ahead for heaven and back for hell. Then it's gone.
 */
export type BridgeKind = 'heaven' | 'hell';
export const BRIDGE_SPAN: Record<BridgeKind, number> = { heaven: 10, hell: -20 };
export interface Bridge {
  /** Absolute track square it starts from. */
  square: number;
  /** Absolute track square it leads to. */
  to: number;
  kind: BridgeKind;
  owner: Seat;
}

/** A square made safe from a power square: its owner's pieces there can't be knocked out until turn `until`. */
export interface SafeSquare {
  square: number;
  owner: Seat;
  until: number;
}

/**
 * An ambush over a seat's home column, until turn `until`. The one flight line over that column becomes
 * two: the ✈ square that flies over it shares its corner square with a triangle of another colour, and that
 * colour flies too, from its triangle to the square of its colour on the far side. Every flight over the
 * column knocks out every piece in it, not just the one in the middle.
 */
export interface Ambush {
  over: Seat;
  owner: Seat;
  until: number;
}

/**
 * What a player picks on a power square. A bridge, a magic box or a safe square is then placed on a square;
 * an ambush names the seat whose home column it opens.
 */
export type PowerChoice = BridgeKind | 'box' | 'safe' | 'ambush' | 'superBomb';
export const POWER_CHOICES: readonly PowerChoice[] = ['heaven', 'hell', 'box', 'safe', 'ambush', 'superBomb'];
/** Powers that can be picked only once a game: whoever picks one first uses it up for everyone. */
export const ONCE_POWERS: readonly PowerChoice[] = ['heaven', 'hell', 'ambush', 'superBomb'];
/** What gets put on a square in the 'place' phase. */
export type Placeable = Exclude<PowerChoice, 'ambush'>;
/** How many rounds a safe square lasts. */
export const SAFE_ROUNDS = 2;
/** How many rounds an ambush lasts. */
export const AMBUSH_ROUNDS = 5;
/** The power squares move after this many rounds. */
export const POWER_EVERY_ROUNDS = 5;
/** Turns in a row without a piece out of the hangar that earn a sad reaction. */
export const STUCK_TURNS = 3;

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
  /** vested[seat][piece]: protective vests that piece wears; each stops one bomb, and stays on until then. */
  vested: number[][];
  /** Who last knocked out one of each seat's pieces, until it takes its revenge. */
  lastHitBy: (Seat | null)[];
  /** frozen[seat][piece]: how many more of that seat's turns the piece can't move (0 = free). Each turn's end takes one off. */
  frozen: number[][];
  /** kills[seat][piece]: knock-outs by that piece since it last left the hangar, for kill streaks. */
  kills: number[][];
  /** Absolute track square of the power square (a list, empty when they're off; older games had two). */
  power: number[];
  /** The turn number at which the power squares move next. */
  powerMovesAt: number;
  bridges: Bridge[];
  /** After a power square or a vest: whether the same seat rolls again once it's done, or the turn passes. */
  powerThen: 'roll' | 'next' | null;
  /** A vest is being handed out, and the move also ended on the power square, which comes next. */
  powerAfterVest: boolean;
  /** What's being put down in the 'place' phase. */
  placing: Placeable | null;
  safe: SafeSquare[];
  ambush: Ambush | null;
  /** ONCE_POWERS already picked this game. */
  usedPowers: PowerChoice[];
  /** Turns in a row each seat had nothing to move and no piece out of the hangar. */
  stuck: number[];
  turnNo: number;
  seq: number;
}

export type StepKind = 'launch' | 'step' | 'bounce' | 'jump' | 'fly' | 'bridge';

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
  /** The victim had last knocked out one of the mover's pieces, so this counts REVENGE times. */
  revenge: boolean;
  /** The moving piece's knock-out count with this one, since it left the hangar: 2 is a double kill. */
  streak: number;
  /** The piece knocked out was a king. */
  king: boolean;
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
  revenge: boolean;
  /** The piece blown up was a king. */
  king: boolean;
  /** A super bomb: the other pieces its blast reached. */
  blast?: BlastHit[];
}

/** A piece caught in a super bomb's blast. */
export interface BlastHit {
  seat: Seat;
  piece: number;
  /** Its seat-relative position. */
  from: number;
  /** Points for the bomb's owner (none for the owner's own pieces, or when a vest stopped it). */
  points: number;
  /** Its vest took the blast and is used up. */
  saved: boolean;
  revenge: boolean;
  king: boolean;
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
  revenge: boolean;
  king: boolean;
}

/** A piece carried by a bridge. */
export interface BridgeHit {
  owner: Seat;
  kind: BridgeKind;
  square: number;
  /** The mover's positions before and after the bridge. */
  from: number;
  to: number;
  /** Index in the mover's path of the bridge step. */
  atStep: number;
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
  bridge?: BridgeHit;
  /** The move ends on a power square, so the mover picks a power. */
  power?: boolean;
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
  /** STUCK_TURNS turns in a row lost with nothing out of the hangar. */
  stuck?: boolean;
}

export interface PowerEvent {
  type: 'power';
  seat: Seat;
  choice: PowerChoice;
  /** For an ambush: whose home column it opens. */
  over?: Seat;
}

export interface BridgeEvent {
  type: 'bridge';
  seat: Seat;
  kind: BridgeKind;
  square: number;
  to: number;
}

/** The piece picked to wear a vest from a magic box. */
export interface VestEvent {
  type: 'vest';
  seat: Seat;
  piece: number;
}

export interface SafeEvent {
  type: 'safe';
  seat: Seat;
  square: number;
}

export interface BombEvent {
  type: 'bomb';
  seat: Seat;
  square: number;
  /** A super bomb, from a power square. */
  super?: boolean;
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
  /** Points on top of `points` for being the first to bring every piece home. */
  bonus: number;
  gameOver: boolean;
}

export type GameEvent = RollEvent | MoveEvent | BombEvent | BoxEvent | PowerEvent | BridgeEvent | SafeEvent | VestEvent;

/** `rand(n)` gives an integer in [0, n). */
export type Rand = (n: number) => number;
const defaultRand: Rand = (n) => Math.floor(Math.random() * n);

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

/** A zero for every piece of every seat. */
export function perPiece(): number[][] {
  return SEATS.map(() => Array.from({ length: PIECES_PER_SEAT }, () => 0));
}

export function createGame(active: Seat[], rules: Rules = DEFAULT_RULES, firstTurn?: Seat, rand: Rand = defaultRand): GameState {
  if (active.length < 2) throw new RuleError('At least two players are needed');
  const order = SEATS.filter((s) => active.includes(s));
  const game: GameState = {
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
    vested: perPiece(),
    lastHitBy: SEATS.map(() => null),
    frozen: perPiece(),
    kills: perPiece(),
    power: [],
    powerMovesAt: 0,
    bridges: [],
    powerThen: null,
    powerAfterVest: false,
    placing: null,
    safe: [],
    ambush: null,
    usedPowers: [],
    stuck: SEATS.map(() => 0),
    turnNo: 1,
    seq: 0,
  };
  if (rules.powerSquares) movePower(game, rand);
  return game;
}

/** Moves the power square to a random free square and sets when it moves next. */
function movePower(s: GameState, rand: Rand): void {
  // Not on a flight square: a power square is nobody's colour, and a flight square has to stay one.
  const flights = new Set(SEATS.map((seat) => trackIndex(seat, FLIGHT_FROM)));
  const free = freeSquares(s).filter((i) => !flights.has(i));
  s.power = free.length ? [free[rand(free.length)]] : [];
  const playing = s.active.filter((x) => !s.ranking.includes(x)).length;
  s.powerMovesAt = s.turnNo + POWER_EVERY_ROUNDS * Math.max(1, playing);
}

/** The turn number a power used now runs until: that many rounds of the players still playing. */
function holdUntil(s: GameState, rounds: number): number {
  return s.turnNo + rounds * Math.max(1, s.active.filter((x) => !s.ranking.includes(x)).length);
}

/**
 * The square an ambush over `over`'s home column adds a flight from: the other triangle of the corner
 * square whose ✈ flies over that column.
 */
export function ambushStart(over: Seat): number {
  return trackIndex(flightCrossedSeat(over), FLIGHT_FROM - 1);
}

/**
 * Whose home column a piece of `seat` flies over from `pos`, if it flies: from its own ✈ square, or during a
 * ambush from the ambush square when it's that piece's colour, unless that would take it past its turn home.
 */
function flightOver(state: GameState, seat: Seat, pos: number): Seat | null {
  if (pos === FLIGHT_FROM) return flightCrossedSeat(seat);
  const sb = state.ambush;
  if (!sb || !isOnTrack(pos) || pos + FLIGHT_DISTANCE > TRACK_LAST) return null;
  const square = trackIndex(seat, pos);
  return trackColor(square) === seat && square === ambushStart(sb.over) ? sb.over : null;
}

/** Whether a piece of `seat` on this absolute square is on its own safe square, so can't be knocked out. */
function isSafe(state: GameState, seat: Seat, square: number): boolean {
  return !!state.safe?.some((x) => x.owner === seat && x.square === square);
}

/** Where a bridge takes a piece standing at `pos`, or null when a heaven bridge leads past its route's turn home. */
export function bridgeTarget(kind: BridgeKind, pos: number): number | null {
  const to = pos + BRIDGE_SPAN[kind];
  if (kind === 'heaven') return to <= TRACK_LAST ? to : null;
  return to >= TRACK_FIRST ? to : TAKEOFF;
}

/** Absolute squares where another colour has a wall in `seat`'s way. */
function wallsAgainst(state: GameState, seat: Seat): Set<number> {
  const walls = new Set<number>();
  if (!state.rules.walls) return walls;
  for (const other of state.active) {
    if (other === seat) continue;
    const seen = new Set<number>();
    for (const p of state.pieces[other]) {
      if (!isOnTrack(p)) continue;
      const sq = trackIndex(other, p);
      if (seen.has(sq)) walls.add(sq);
      seen.add(sq);
    }
  }
  return walls;
}

/** Absolute squares holding a wall: two or more pieces of one colour. */
export function wallSquares(state: GameState): number[] {
  if (!state.rules.walls) return [];
  const count = new Map<string, number>();
  for (const seat of state.active) {
    for (const p of state.pieces[seat]) {
      if (!isOnTrack(p)) continue;
      const key = `${seat}:${trackIndex(seat, p)}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  return [...count].filter(([, n]) => n > 1).map(([k]) => Number(k.split(':')[1]));
}

/**
 * Works out where a piece would go with this roll, or null if the move is not allowed. Does not change `state`.
 * `openBox` draws what a magic box holds; without it (previews, bots) a box's outcome is left unknown.
 */
export function planMove(state: GameState, seat: Seat, piece: number, dice: number, openBox?: () => BoxOutcome): MovePlan | null {
  const { rules } = state;
  const from = state.pieces[seat][piece];
  if (from === GOAL || state.frozen?.[seat]?.[piece]) return null;

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

  // Another colour's wall can be landed on, which knocks it all out, but not passed.
  const walls = wallsAgainst(state, seat);
  const wallAt = (pos: number) => isOnTrack(pos) && walls.has(trackIndex(seat, pos));
  if (plan.path.slice(0, -1).some((step) => wallAt(step.pos))) return null;

  // A knock-out's points: by how far the victim had come, times REVENGE when the victim last knocked out one
  // of the hitter's pieces, KING when the victim is a king, and the moving piece's kill streak (bombs have
  // none), capped at the biggest award.
  const worth = (hitter: Seat, victim: Seat, victimPiece: number, pos: number, streak = 0) => {
    const revenge = state.lastHitBy?.[hitter] === victim;
    const king = isKing(state, victimPiece);
    const times = (revenge ? REVENGE : 1) * (king ? KING : 1) * killStreakBonus(streak);
    return { points: Math.min(POINTS.firstHome, Math.round(captureValue(pos) * times)), revenge, king };
  };
  // Every knock-out in a move is the moving piece's, so its streak counts on from what it had.
  const killsBefore = state.kills?.[seat]?.[piece] ?? 0;
  const nextStreak = () => killsBefore + plan.captures.length + 1;

  // Positions of everyone else, updated as captures happen along the chain.
  const taken = new Set<string>();
  const captureAt = (pos: number) => {
    if (!isOnTrack(pos)) return;
    const idx = trackIndex(seat, pos);
    for (const other of state.active) {
      if (other === seat) continue;
      state.pieces[other].forEach((p, j) => {
        const key = `${other}:${j}`;
        if (taken.has(key) || !isOnTrack(p) || trackIndex(other, p) !== idx || isSafe(state, other, idx)) return;
        taken.add(key);
        const streak = nextStreak();
        plan.captures.push({ seat: other, piece: j, from: p, atStep: plan.path.length - 1, byFlight: false, streak, ...worth(seat, other, j, p, streak) });
      });
    }
  };

  // The other pieces on track squares within reach of a super bomb: anyone's, the owner's too, unless on
  // their own safe square or already knocked out on the way. A vest saves its wearer.
  const blastAround = (owner: Seat, center: number): BlastHit[] => {
    const out: BlastHit[] = [];
    for (const other of state.active) {
      state.pieces[other].forEach((p, j) => {
        if ((other === seat && j === piece) || !isOnTrack(p) || taken.has(`${other}:${j}`)) return;
        const sq = trackIndex(other, p);
        const apart = Math.min((sq - center + TRACK_LEN) % TRACK_LEN, (center - sq + TRACK_LEN) % TRACK_LEN);
        if (apart > SUPER_BOMB_REACH || isSafe(state, other, sq)) return;
        const saved = (state.vested?.[other]?.[j] ?? 0) > 0;
        const hit = saved || other === owner ? { points: 0, revenge: false } : worth(owner, other, j, p);
        out.push({ seat: other, piece: j, from: p, saved, points: hit.points, revenge: hit.revenge, king: isKing(state, j) });
      });
    }
    return out;
  };

  // Everything that happens where the piece lands: a bomb, knock-outs, then a magic box. A blast sends the
  // piece back to the hangar ('hangar'); a knock-out or a box's ice keeps it on that square, with no jump or
  // flight after ('stay'); otherwise the move carries on ('on').
  // Only the moving piece's own vests count. One from a box on the way is handed out after the move.
  let vests = state.vested?.[seat]?.[piece] ?? 0;
  const land = (pos: number): 'hangar' | 'stay' | 'on' => {
    if (!isOnTrack(pos)) return 'on';
    const square = trackIndex(seat, pos);
    const atStep = plan.path.length - 1;
    const bomb = state.bombs.find((b) => b.square === square);
    if (bomb && !plan.bombed) {
      const saved = vests > 0;
      if (saved) vests--;
      const { points, revenge } = saved || bomb.owner === seat ? { points: 0, revenge: false } : worth(bomb.owner, seat, piece, pos);
      plan.bombed = { owner: bomb.owner, square, pos, atStep, saved, points, revenge, king: isKing(state, piece) };
      // A super bomb goes off even when a vest saves the piece that set it off.
      if (bomb.super) plan.bombed.blast = blastAround(bomb.owner, square);
      if (!saved) return 'hangar';
    }
    const knocked = plan.captures.length;
    captureAt(pos);
    // Anyone's piece opens a box, its owner's included.
    const box = state.boxes?.find((b) => b.square === square);
    if (box && !plan.box) {
      const outcome = openBox?.();
      const blast = outcome === 'bomb';
      const saved = blast && vests > 0;
      if (saved) vests--;
      const scores = blast && !saved && box.owner !== seat;
      const { points, revenge } = scores ? worth(box.owner, seat, piece, pos) : { points: 0, revenge: false };
      plan.box = { owner: box.owner, square, pos, atStep, outcome, saved, points, revenge, king: isKing(state, piece) };
      if (blast && !saved) return 'hangar';
      if (outcome === 'freeze') return 'stay';
    }
    return plan.captures.length > knocked ? 'stay' : 'on';
  };

  let landed = land(cur);
  if (landed === 'hangar') return finishPlan(plan, HANGAR);
  if (landed === 'on' && isOnTrack(cur)) {
    for (;;) {
      // A bridge carries the piece on, and the move ends where it puts it down.
      const bridge = !plan.bridge && isOnTrack(cur) ? state.bridges?.find((b) => b.square === trackIndex(seat, cur)) : undefined;
      const across = bridge ? bridgeTarget(bridge.kind, cur) : null;
      if (bridge && across !== null) {
        plan.bridge = { owner: bridge.owner, kind: bridge.kind, square: bridge.square, from: cur, to: across, atStep: plan.path.length };
        cur = across;
        plan.path.push({ pos: cur, kind: 'bridge' });
        if (land(cur) === 'hangar') return finishPlan(plan, HANGAR);
        break;
      }
      const crossed = rules.flights && !plan.flew ? flightOver(state, seat, cur) : null;
      if (crossed !== null) {
        // An ambush opens the whole home column: every piece in it is in the flight's way.
        const open = state.ambush?.over === crossed;
        if ((rules.flightCapture || open) && crossed !== seat) {
          if (state.active.includes(crossed)) {
            state.pieces[crossed].forEach((p, j) => {
              const key = `${crossed}:${j}`;
              if (taken.has(key) || (open ? p < HOME_FIRST || p > HOME_LAST : p !== FLIGHT_CROSSES)) return;
              taken.add(key);
              const streak = nextStreak();
              plan.captures.push({ seat: crossed, piece: j, from: p, atStep: plan.path.length, byFlight: true, streak, ...worth(seat, crossed, j, p, streak) });
            });
          }
        }
        cur += FLIGHT_DISTANCE;
        plan.flew = true;
        plan.path.push({ pos: cur, kind: 'fly' });
        landed = land(cur);
        if (landed === 'hangar') return finishPlan(plan, HANGAR);
        if (landed === 'stay') break;
        continue;
      }
      const wallInTheWay = [1, 2, 3].some((k) => wallAt(cur + k));
      // A power square is nobody's colour, so nobody jumps from it.
      const onPower = state.power?.includes(trackIndex(seat, cur));
      if (rules.jumps && !plan.jumped && isOwnColor(cur) && cur < TRACK_LAST && !wallInTheWay && !onPower) {
        cur += JUMP_DISTANCE;
        plan.jumped = true;
        plan.path.push({ pos: cur, kind: 'jump' });
        landed = land(cur);
        if (landed === 'hangar') return finishPlan(plan, HANGAR);
        if (landed === 'stay') break;
        continue;
      }
      break;
    }
  }

  finishPlan(plan, cur);
  if (isOnTrack(cur) && state.power?.includes(trackIndex(seat, cur))) plan.power = true;
  return plan;
}

function finishPlan(plan: MovePlan, to: number): MovePlan {
  plan.to = to;
  plan.points =
    plan.captures.reduce((sum, c) => sum + c.points, 0) +
    (to === GOAL ? POINTS.home : 0) +
    (plan.box?.outcome === 'plus' ? POINTS.boxBonus : 0) -
    (plan.box?.outcome === 'minus' ? POINTS.boxPenalty : 0);
  return plan;
}

/** The bomb (placed, or from a magic box) that blew this move's piece back to the hangar, if any. */
export function blastOf(plan: MovePlan): { owner: Seat; square: number; pos: number; atStep: number; points: number } | null {
  if (plan.bombed && !plan.bombed.saved) return plan.bombed;
  if (plan.box?.outcome === 'bomb' && !plan.box.saved) return plan.box;
  return null;
}

/** Track squares (absolute indices) a safe square can go on: anything but a bomb, box, bridge, power square or safe square, pieces or not. */
export function safeSquareOptions(state: GameState): number[] {
  const used = new Set([...state.bombs, ...(state.boxes ?? []), ...(state.bridges ?? []), ...(state.safe ?? [])].map((b) => b.square));
  for (const sq of state.power ?? []) used.add(sq);
  return Array.from({ length: TRACK_LEN }, (_, i) => i).filter((i) => !used.has(i));
}

/** Squares the thing being placed in the 'place' phase may go on. */
export function placeOptions(state: GameState): number[] {
  return state.placing === 'safe' ? safeSquareOptions(state) : freeSquares(state);
}

/**
 * Track squares (absolute indices) free for a bomb, a magic box or a bridge: no piece, bomb, box, power
 * square, bridge or safe square on them.
 */
export function freeSquares(state: GameState): number[] {
  const used = new Set([...state.bombs, ...(state.boxes ?? []), ...(state.bridges ?? []), ...(state.safe ?? [])].map((b) => b.square));
  for (const sq of state.power ?? []) used.add(sq);
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
  const seen = new Set<string>();
  const out: number[] = [];
  for (const j of state.movable) {
    // A king scores differently from the pieces sharing its square, so moving it is a move of its own.
    const key = `${state.pieces[state.turn][j]}:${isKing(state, j)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(j);
  }
  return out;
}

export function seatFinished(state: GameState, seat: Seat): boolean {
  return state.pieces[seat].every((p) => p === GOAL);
}

function nextTurn(s: GameState, rand: Rand): void {
  s.frozen ??= perPiece();
  s.frozen[s.turn] = s.frozen[s.turn].map((n) => Math.max(0, n - 1));
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
      if (s.rules.powerSquares && s.turnNo >= (s.powerMovesAt ?? 0)) movePower(s, rand);
      s.safe = (s.safe ?? []).filter((x) => x.until > s.turnNo);
      if (s.ambush && s.ambush.until <= s.turnNo) s.ambush = null;
      return;
    }
  }
  s.phase = 'over';
}

/**
 * Counts a lost turn for a seat with nothing out of the hangar. Returns true on every STUCK_TURNS-th one in
 * a row, for a sad reaction.
 */
function countStuck(s: GameState, seat: Seat): boolean {
  s.stuck ??= SEATS.map(() => 0);
  if (s.pieces[seat].some((p) => p !== HANGAR && p !== GOAL)) {
    s.stuck[seat] = 0;
    return false;
  }
  s.stuck[seat]++;
  if (s.stuck[seat] < STUCK_TURNS) return false;
  s.stuck[seat] = 0;
  return true;
}

export function applyRoll(state: GameState, dice: number, rand: Rand = defaultRand): { state: GameState; event: RollEvent } {
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
        if (s.frozen) s.frozen[seat][j] = 0;
        if (s.kills) s.kills[seat][j] = 0;
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
      nextTurn(s, rand);
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
    if (countStuck(s, seat)) event.stuck = true;
    nextTurn(s, rand);
  }
  return { state: s, event };
}

/** `rand(n)` gives an integer in [0, n); it decides what a magic box holds. */
export function applyMove(state: GameState, piece: number, rand: Rand = defaultRand): { state: GameState; event: MoveEvent } {
  if (state.phase !== 'move' || state.dice === null) throw new RuleError('Not time to move');
  if (!state.movable.includes(piece)) throw new RuleError('That plane cannot move');

  const seat = state.turn;
  const dice = state.dice;
  const plan = planMove(state, seat, piece, dice, () => BOX_OUTCOMES[rand(BOX_OUTCOMES.length)]);
  if (!plan) throw new RuleError('That plane cannot move');

  const s = structuredClone(state);
  s.seq++;
  s.frozen ??= perPiece();
  s.kills ??= perPiece();
  s.stuck ??= SEATS.map(() => 0);
  s.stuck[seat] = 0;
  s.pieces[seat][piece] = plan.to;
  s.kills[seat][piece] = plan.to === HANGAR ? 0 : s.kills[seat][piece] + plan.captures.length;
  for (const c of plan.captures) {
    s.pieces[c.seat][c.piece] = HANGAR;
    s.frozen[c.seat][c.piece] = 0;
    s.kills[c.seat][c.piece] = 0;
    s.stats[c.seat].lost++;
  }
  if (plan.bridge) s.bridges = s.bridges.filter((b) => b.square !== plan.bridge!.square);
  s.stats[seat].captures += plan.captures.length;
  s.stats[seat].points += plan.points;
  if (plan.bombed) {
    const { owner, square, points, saved } = plan.bombed;
    s.bombs = s.bombs.filter((b) => b.square !== square);
    if (saved) s.vested[seat][piece]--;
    else {
      s.stats[seat].lost++;
      if (owner !== seat) {
        s.stats[owner].captures++;
        s.stats[owner].points += points;
      }
    }
    for (const v of plan.bombed.blast ?? []) {
      if (v.saved) {
        s.vested[v.seat][v.piece]--;
        continue;
      }
      s.pieces[v.seat][v.piece] = HANGAR;
      s.frozen[v.seat][v.piece] = 0;
      s.kills[v.seat][v.piece] = 0;
      s.stats[v.seat].lost++;
      if (owner !== v.seat) {
        s.stats[owner].captures++;
        s.stats[owner].points += v.points;
      }
    }
  }
  if (plan.box) {
    const { owner, square, points, saved, outcome } = plan.box;
    s.boxes = s.boxes.filter((b) => b.square !== square);
    if (outcome === 'freeze') s.frozen[seat][piece] = FROZEN_TURNS;
    if (outcome === 'bomb' && saved) s.vested[seat][piece]--;
    if (outcome === 'bomb' && !saved) {
      s.stats[seat].lost++;
      if (owner !== seat) {
        s.stats[owner].captures++;
        s.stats[owner].points += points;
      }
    }
  }
  if (plan.to === GOAL) s.stats[seat].home++;
  if (dice === 6) s.streakMoved.push(piece);

  // Revenge settles a score; each new knock-out opens one.
  s.lastHitBy ??= SEATS.map(() => null);
  for (const c of plan.captures) {
    if (c.revenge) s.lastHitBy[seat] = null;
    s.lastHitBy[c.seat] = seat;
  }
  const blast = blastOf(plan);
  if (blast && blast.owner !== seat) {
    if ((plan.bombed && !plan.bombed.saved ? plan.bombed : plan.box)?.revenge) s.lastHitBy[blast.owner] = null;
    s.lastHitBy[seat] = blast.owner;
  }
  for (const v of plan.bombed?.blast ?? []) {
    if (v.saved || v.seat === plan.bombed!.owner) continue;
    if (v.revenge) s.lastHitBy[plan.bombed!.owner] = null;
    s.lastHitBy[v.seat] = plan.bombed!.owner;
  }

  const event: MoveEvent = { ...plan, type: 'move', extraRoll: false, seatFinished: false, bonus: 0, gameOver: false };

  if (seatFinished(s, seat)) {
    event.seatFinished = true;
    if (s.ranking.length === 0) {
      event.bonus = POINTS.firstHome;
      s.stats[seat].points += POINTS.firstHome;
    }
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
    nextTurn(s, rand);
    return { state: s, event };
  }

  const extra =
    (dice === 6 && s.rules.bonusRollOnSix) || (s.rules.bonusRollOnCapture && plan.captures.length > 0);
  event.extraRoll = extra;
  if (extra && dice !== 6) {
    s.sixStreak = 0;
    s.streakMoved = [];
  }
  if (plan.box?.outcome === 'vest' || plan.power) {
    // The turn waits while the mover picks who wears the vest, then a power, and carries on as it would have.
    s.phase = plan.box?.outcome === 'vest' ? 'vest' : 'power';
    s.powerAfterVest = s.phase === 'vest' && !!plan.power;
    s.powerThen = extra ? 'roll' : 'next';
    s.dice = null;
    s.movable = [];
  } else if (extra) {
    s.phase = 'roll';
    s.dice = null;
    s.movable = [];
  } else {
    nextTurn(s, rand);
  }
  return { state: s, event };
}

/** Carries on after a power was used: another roll for the same seat, or the next turn. */
function resumeAfterPower(s: GameState, rand: Rand): void {
  const then = s.powerThen;
  s.powerThen = null;
  s.placing = null;
  if (then === 'roll') {
    s.phase = 'roll';
    s.dice = null;
    s.movable = [];
  } else {
    nextTurn(s, rand);
  }
}

/** Pieces that can be given a vest: any not yet in the centre, in the hangar or out. */
export function vestOptions(state: GameState): number[] {
  return state.pieces[state.turn].flatMap((p, j) => (p === GOAL ? [] : [j]));
}

/** Puts the vest from a magic box on one of the mover's pieces, where it stays until it stops a bomb. */
export function applyVest(state: GameState, piece: number, rand: Rand = defaultRand): { state: GameState; event: VestEvent } {
  if (state.phase !== 'vest') throw new RuleError('There is no vest to hand out');
  if (!vestOptions(state).includes(piece)) throw new RuleError('That piece cannot wear the vest');
  const s = structuredClone(state);
  s.seq++;
  s.vested ??= perPiece();
  s.vested[s.turn][piece]++;
  const event: VestEvent = { type: 'vest', seat: s.turn, piece };
  if (s.powerAfterVest) {
    s.powerAfterVest = false;
    s.phase = 'power';
  } else {
    resumeAfterPower(s, rand);
  }
  return { state: s, event };
}

/** The powers the player on a power square may pick: all but the once-a-game ones already used. */
export function availablePowers(state: GameState): PowerChoice[] {
  return POWER_CHOICES.filter((c) => !(ONCE_POWERS.includes(c) && state.usedPowers?.includes(c)));
}

/** Who an ambush may be built over: the other players still playing. */
export function ambushTargets(state: GameState): Seat[] {
  return state.active.filter((x) => x !== state.turn && !state.ranking.includes(x));
}

/**
 * Picks a power on a power square. An ambush opens `over`'s home column at once; anything else is
 * placed on a square next.
 */
export function applyPower(state: GameState, choice: PowerChoice, rand: Rand = defaultRand, over?: Seat): { state: GameState; event: PowerEvent } {
  if (state.phase !== 'power') throw new RuleError('Not time to pick a power');
  if (!POWER_CHOICES.includes(choice)) throw new RuleError('Unknown power');
  if (!availablePowers(state).includes(choice)) throw new RuleError('That power has already been used this game');
  const s = structuredClone(state);
  s.seq++;
  if (ONCE_POWERS.includes(choice)) (s.usedPowers ??= []).push(choice);
  const event: PowerEvent = { type: 'power', seat: s.turn, choice };
  if (choice === 'ambush') {
    if (over === undefined || !ambushTargets(state).includes(over)) throw new RuleError('Pick another player for the ambush');
    s.ambush = { over, owner: s.turn, until: holdUntil(s, AMBUSH_ROUNDS) };
    event.over = over;
    resumeAfterPower(s, rand);
    return { state: s, event };
  }
  s.placing = choice;
  if (placeOptions(s).length) s.phase = 'place';
  else resumeAfterPower(s, rand);
  return { state: s, event };
}

/**
 * Puts down what was picked on a power square on this free absolute track square: a bridge starting
 * there, or a magic box that opens for whoever lands on it first, its owner too.
 */
export function applyPlace(state: GameState, square: number, rand: Rand = defaultRand): { state: GameState; event: BridgeEvent | BoxEvent | SafeEvent | BombEvent } {
  if (state.phase !== 'place' || !state.placing) throw new RuleError('Not time to place that');
  if (!placeOptions(state).includes(square)) throw new RuleError("That can't go on that square");
  const s = structuredClone(state);
  s.seq++;
  const kind = state.placing;
  let event: BridgeEvent | BoxEvent | SafeEvent | BombEvent;
  if (kind === 'safe') {
    s.safe ??= [];
    s.safe.push({ square, owner: s.turn, until: holdUntil(s, SAFE_ROUNDS) });
    event = { type: 'safe', seat: s.turn, square };
  } else if (kind === 'superBomb') {
    s.bombs.push({ square, owner: s.turn, super: true });
    event = { type: 'bomb', seat: s.turn, square, super: true };
  } else if (kind === 'box') {
    s.boxes ??= [];
    s.boxes.push({ square, owner: s.turn });
    event = { type: 'box', seat: s.turn, square };
  } else {
    const to = (square + BRIDGE_SPAN[kind] + TRACK_LEN) % TRACK_LEN;
    s.bridges ??= [];
    s.bridges.push({ square, to, kind, owner: s.turn });
    event = { type: 'bridge', seat: s.turn, kind, square, to };
  }
  resumeAfterPower(s, rand);
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

export function applyBomb(state: GameState, square: number, rand: Rand = defaultRand): { state: GameState; event: BombEvent } {
  if (state.phase !== 'bomb') throw new RuleError('Not time to place a bomb');
  if (!freeSquares(state).includes(square)) throw new RuleError('A bomb can only go on an empty track square');
  const s = structuredClone(state);
  s.seq++;
  const event: BombEvent = { type: 'bomb', seat: s.turn, square };
  s.bombs.push({ square, owner: s.turn });
  nextTurn(s, rand);
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

