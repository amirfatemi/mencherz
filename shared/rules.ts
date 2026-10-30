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
  /** Every EVENT_EVERY_ROUNDS rounds a surprise event changes the game for a while (see WORLD_EVENTS). */
  events: boolean;
  /** The points leader has a bounty on them: knocking out their pieces pays extra, more the longer they lead. */
  bounty: boolean;
  /**
   * After DRAGON_FIRST_ROUNDS rounds a dragon appears and goes once round DRAGON_PATH, moved by every roll:
   * the track and, on the way, up every home column and back. It eats any piece where it stops, and two
   * sixes in a row leave a bomb where it stops. Landing on it pays DRAGON_PRIZE; a king that slays it rids
   * the game of dragons. If nobody does, it explodes when its lap is done, taking the pieces next to it
   * (DRAGON_BLAST_REACH) along. The next one comes DRAGON_EVERY_ROUNDS rounds later. It sets off nothing and
   * takes no bridge.
   */
  dragon: boolean;
  /**
   * Heroes: a fifth piece a player picks (see HERO_KINDS) on reaching each of HERO_THRESHOLDS points, after a
   * triple kill, and, once all four pieces are home, every HERO_FINISHED_ROUNDS rounds. It goes round the track
   * only, never up a home column, for HERO_LIFE squares, each kind with its own power. Moving it uses the roll.
   */
  heroes: boolean;
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
  events: true,
  bounty: true,
  dragon: true,
  heroes: true,
  playUntil: 'all',
  winBy: 'points',
};

/**
 * 'place': putting down what was picked on a power square (a bridge, a magic box or a safe square), or the
 * engineer's last super bomb.
 * 'vest': picking which piece wears a vest from a magic box.
 * 'hero': picking a hero, at the start of a turn.
 */
export type Phase = 'box' | 'roll' | 'move' | 'bomb' | 'power' | 'place' | 'vest' | 'hero' | 'over';

export interface Bomb {
  /** Absolute track index (0..51), as in TRACK. */
  square: number;
  /** Null for a bomb the dragon left: it scores for nobody. */
  owner: Seat | null;
  /** A super bomb, from a power square: its blast also takes every piece within SUPER_BOMB_REACH squares. */
  super?: boolean;
}

/** How far along the track, ahead or behind, a super bomb's blast reaches. Home columns are out of reach. */
export const SUPER_BOMB_REACH = 3;

/** Surprise events, and how many rounds each lasts (an earthquake just happens). */
export type WorldEventKind = 'storm' | 'goldRain' | 'earthquake' | 'darkNight' | 'fog';
export const WORLD_EVENTS: Record<WorldEventKind, { rounds: number }> = {
  /** No flights and no colour jumps. */
  storm: { rounds: 1 },
  /** Pieces reaching the centre score EVENT_BOOST times. */
  goldRain: { rounds: 2 },
  /** Every bomb jumps to another free square; it stays announced for a round. */
  earthquake: { rounds: 1 },
  /** Knock-outs score EVENT_BOOST times. */
  darkNight: { rounds: 2 },
  /** Bombs, magic boxes and bridges can't be seen. */
  fog: { rounds: 3 },
};
export const EVENT_EVERY_ROUNDS = 15;
/** How much more gold rain makes a piece home, and a dark night a knock-out. */
export const EVENT_BOOST = 1.2;

/** The bounty on the points leader: what it starts at, what each round in the lead adds, and its most. */
export const BOUNTY = { start: 3, perRound: 1, max: 8 } as const;

/** Rounds before the first dragon comes, and after one explodes or a piece other than a king slays it. */
export const DRAGON_FIRST_ROUNDS = 10;
export const DRAGON_EVERY_ROUNDS = 20;
/** What slaying the dragon pays a king (and any piece when kings are off), and any other piece. */
export const DRAGON_PRIZE = { king: 40, piece: 5 } as const;
/** How far, ahead and behind, the dragon's explosion reaches. */
export const DRAGON_BLAST_REACH = 1;

/** A place on the dragon's route: a track square, or a square of a seat's home column (a seat-relative pos). */
export type DragonCell = { square: number } | { seat: Seat; pos: number };

/**
 * The dragon's route, a loop: the whole track, and at each seat's arrow square up that seat's home column to
 * its last square and back down, before going on along the track.
 */
export const DRAGON_PATH: readonly DragonCell[] = (() => {
  const out: DragonCell[] = [];
  for (let square = 0; square < TRACK_LEN; square++) {
    out.push({ square });
    const seat = SEATS.find((x) => trackIndex(x, TRACK_LAST) === square);
    if (seat === undefined) continue;
    for (let pos = HOME_FIRST; pos <= HOME_LAST; pos++) out.push({ seat, pos });
    for (let pos = HOME_LAST - 1; pos >= HOME_FIRST; pos--) out.push({ seat, pos });
  }
  return out;
})();

/** The pieces and heroes standing on a cell of the dragon's route. A hero's `from` is its square. */
function piecesOn(s: GameState, cell: DragonCell): { seat: Seat; piece: number; from: number }[] {
  const out: { seat: Seat; piece: number; from: number }[] = [];
  for (const seat of s.active) {
    s.pieces[seat].forEach((p, j) => {
      const here = 'square' in cell ? isOnTrack(p) && trackIndex(seat, p) === cell.square : seat === cell.seat && p === cell.pos;
      if (here) out.push({ seat, piece: j, from: p });
    });
    const h = s.heroes?.[seat];
    if (h && 'square' in cell && h.square === cell.square) out.push({ seat, piece: HERO, from: h.square });
  }
  return out;
}

/** The cells next to a cell, `reach` steps either way along the board (a home column leads back to its arrow square). */
function cellsAround(cell: DragonCell, reach: number): DragonCell[] {
  const out: DragonCell[] = [cell];
  let frontier: DragonCell[] = [cell];
  const key = (c: DragonCell) => ('square' in c ? `t${c.square}` : `h${c.seat}:${c.pos}`);
  const seen = new Set([key(cell)]);
  for (let r = 0; r < reach; r++) {
    const next: DragonCell[] = [];
    for (const c of frontier) {
      const around: DragonCell[] = [];
      if ('square' in c) {
        around.push({ square: (c.square + 1) % TRACK_LEN }, { square: (c.square - 1 + TRACK_LEN) % TRACK_LEN });
        const seat = SEATS.find((x) => trackIndex(x, TRACK_LAST) === c.square);
        if (seat !== undefined) around.push({ seat, pos: HOME_FIRST });
      } else {
        around.push(c.pos > HOME_FIRST ? { seat: c.seat, pos: c.pos - 1 } : { square: trackIndex(c.seat, TRACK_LAST) });
        if (c.pos < HOME_LAST) around.push({ seat: c.seat, pos: c.pos + 1 });
      }
      for (const a of around) {
        if (seen.has(key(a))) continue;
        seen.add(key(a));
        next.push(a);
        out.push(a);
      }
    }
    frontier = next;
  }
  return out;
}

/** Whether the dragon stands where a piece of `seat` at `pos` stands. */
function dragonAt(s: GameState, seat: Seat, pos: number): boolean {
  if (!s.dragon) return false;
  const cell = DRAGON_PATH[s.dragon.at];
  if (!cell) return false;
  return 'square' in cell ? isOnTrack(pos) && trackIndex(seat, pos) === cell.square : cell.seat === seat && cell.pos === pos;
}

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

/**
 * The heroes. Each goes round the track for HERO_LIFE squares, then it's gone; a player has each kind once a game.
 * - archer: goes forward or back, as its player likes, with every roll.
 * - engineer: defuses every bomb it passes or stops on (HERO_DEFUSE each) and no bomb hurts it. At the end of its
 *   life its player puts down a super bomb, then it goes off where it stands (DRAGON_BLAST_REACH either side).
 * - guardian: its player's pieces on its square and GUARD_REACH either side can't be knocked out, bombed or eaten.
 * - frost: where it stops, other colours' pieces and heroes within FROST_REACH freeze for a turn.
 * - thief: knocks nobody out; where it stops it takes HERO_STEAL points and the vests of each other colour there,
 *   and the bounty if the leader is one of them. A magic box is always good for it (points or a vest).
 * - rider: the dragon leaves its player's pieces alone, and the rider slays it as a king would.
 */
export type HeroKind = 'archer' | 'engineer' | 'guardian' | 'frost' | 'thief' | 'rider';
export const HERO_KINDS: readonly HeroKind[] = ['archer', 'engineer', 'guardian', 'frost', 'thief', 'rider'];
/** Points at which a player earns a hero, each once. */
export const HERO_THRESHOLDS: readonly number[] = [60, 140, 240];
/** How many squares a hero goes before it's gone: once round the track. */
export const HERO_LIFE = TRACK_LEN;
/** Knocking out a hero, by any means. */
export const HERO_KILL = 15;
export const HERO_DEFUSE = 5;
export const HERO_STEAL = 10;
export const FROST_REACH = 2;
export const GUARD_REACH = 1;
/** Once all its pieces are home, a player gets a hero this many rounds after finishing, and after each one goes. */
export const HERO_FINISHED_ROUNDS = 5;
/** The piece number a hero's move goes by, and the archer's move back. */
export const HERO = 4;
export const HERO_BACK = 5;
/** What a magic box can hold for the thief. */
const THIEF_BOX: readonly BoxOutcome[] = ['plus', 'vest'];

export interface Hero {
  kind: HeroKind;
  /** Absolute track square. */
  square: number;
  /** Squares it has left to go. */
  left: number;
  /** Its knock-outs, for kill streaks. */
  kills: number;
  /** Vests it wears (the thief's): each stops a bomb. */
  vests: number;
  /** Turns of its player's it can't move (frost). */
  frozen: number;
}

/** A piece or hero caught in a blast: the dragon's, or the engineer's. A hero's `from` is its square. */
export interface BlastVictim {
  seat: Seat;
  piece: number;
  from: number;
  saved: boolean;
  /** Points for whoever set it off. */
  points?: number;
}

export interface SeatStats {
  points: number;
  /** Pieces brought to the centre. */
  home: number;
  /** Opponent pieces knocked out. */
  captures: number;
  /** Own pieces knocked out. */
  lost: number;
  // For the end-of-game report and medals:
  /** The most points one knock-out brought, bombs included. */
  bestHit: number;
  /** The longest kill streak of one of the seat's pieces. */
  bestStreak: number;
  /** Opponent pieces blown up by the seat's bombs, box bombs and super bombs. */
  bombKills: number;
  /** Magic boxes opened. */
  boxes: number;
  /** Sixes rolled. */
  sixes: number;
  /** Flights taken. */
  flights: number;
  /** Times the seat ended a move on the power square. */
  powers: number;
  /** Dragons slain. */
  dragons: number;
}

/** A seat's stats at the start of a game. */
export function newStats(): SeatStats {
  return { points: 0, home: 0, captures: 0, lost: 0, bestHit: 0, bestStreak: 0, bombKills: 0, boxes: 0, sixes: 0, flights: 0, powers: 0, dragons: 0 };
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
  /** The surprise event in play: its kind, its number this game (so it's announced once), and until when. */
  event: { kind: WorldEventKind; n: number; until: number } | null;
  /** The turn number of the next surprise event. */
  eventAt: number;
  /** Who has the bounty on them, and what knocking out one of their pieces pays on top. */
  bounty: { seat: Seat; value: number } | null;
  /**
   * The dragon: where it is along DRAGON_PATH, how many cells of its lap it has gone, and how many sixes in a
   * row it has moved with (a second leaves a bomb, a third a super bomb).
   */
  dragon: { at: number; moved: number; sixes: number } | null;
  /** The turn number the next dragon comes. */
  dragonAt: number;
  /** A king slew the dragon: no more dragons this game. */
  dragonGone: boolean;
  /** The dragon's last explosion, numbered so it's shown once: where, and what it took (or a vest saved). */
  dragonBlast: { n: number; at: number; hit: BlastVictim[] } | null;
  /** Each seat's hero on the board. */
  heroes: (Hero | null)[];
  /** Heroes each seat has earned and not yet picked. */
  heroPicks: number[];
  /** The hero kinds each seat has had this game. */
  heroesUsed: HeroKind[][];
  /** How many of HERO_THRESHOLDS each seat has reached. */
  heroMilestones: number[];
  /** For a seat with every piece home: the turn number it earns its next hero. */
  heroAt: number[];
  /** The engineer at the end of its life, waiting for its player to put down its super bomb. */
  heroEnding: Seat | null;
  /** The engineer's last blast, numbered so it's shown once. */
  heroBlast: { n: number; seat: Seat; square: number; hit: BlastVictim[] } | null;
  /** How many surprise events there have been. */
  eventN?: number;
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
  /** Bounty claimed with it, included in points. */
  bounty?: number;
}

/** A piece landing on a bomb: it goes back to the hangar and the bomb is used up. */
export interface BombHit {
  /** Null for the dragon's bomb. */
  owner: Seat | null;
  square: number;
  /** The mover's position on the bomb square. */
  pos: number;
  /** Index in the mover's path where it lands on the bomb. */
  atStep: number;
  /** Points for the bomb's owner (none when it's their own bomb, or a vest stopped it). */
  points: number;
  /** A protective vest took the blast: the piece carries on and the vest is used up. */
  saved: boolean;
  /** It was its guardian that saved it, not a vest. */
  guarded?: boolean;
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
  /** It was its guardian that stopped it, not a vest. */
  guarded?: boolean;
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
  /** The piece landed on the dragon and slew it, for DRAGON_PRIZE (in points); a king does for good. */
  dragon?: { at: number; atStep: number; points: number; king: boolean };
  /** A hero's move. Its `from`, `to` and `path` positions are absolute track squares; `to` is HANGAR when a bomb got it. */
  hero?: HeroMove;
}

export interface HeroMove {
  kind: HeroKind;
  /** The archer going back. */
  back: boolean;
  /** Squares of the bombs the engineer defused. */
  defused: number[];
  /** What the thief took from each colour where it stopped. */
  stolen: { seat: Seat; points: number; vests: number }[];
  /** The bounty the thief took. */
  bounty?: number;
  /** What the frost froze where it stopped. */
  froze: { seat: Seat; piece: number }[];
  /** Its life is over with this move. */
  ends: boolean;
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
  /**
   * The dragon moving with the roll: from and to along DRAGON_PATH, in `steps` cells (fewer than the dice when
   * its lap ends there), the pieces it ate where it stopped, the square of a bomb it left there, and whether its
   * lap ended, so it exploded (see dragonBlast).
   */
  dragon?: {
    from: number;
    to: number;
    steps: number;
    eaten: { seat: Seat; piece: number; from: number }[];
    bomb?: number;
    /** The bomb it left is a super bomb: three sixes in a row. */
    superBomb?: boolean;
    exploded?: boolean;
  };
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
  /** A super bomb, from a power square, or the engineer's last. */
  super?: boolean;
  /** The engineer put it down at the end of its life, and went off (see heroBlast). */
  ends?: boolean;
}

/** A hero picked: it comes on at its player's first track square. */
export interface HeroEvent {
  type: 'hero';
  seat: Seat;
  kind: HeroKind;
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
  /** Points on top of `points` for being the first to bring every piece home. */
  bonus: number;
  gameOver: boolean;
}

export type GameEvent = RollEvent | MoveEvent | BombEvent | BoxEvent | PowerEvent | BridgeEvent | SafeEvent | VestEvent | HeroEvent;

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
    stats: SEATS.map(newStats),
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
    event: null,
    eventAt: 1 + EVENT_EVERY_ROUNDS * order.length,
    bounty: null,
    dragon: null,
    dragonAt: 1 + DRAGON_FIRST_ROUNDS * order.length,
    dragonGone: false,
    dragonBlast: null,
    heroes: SEATS.map(() => null),
    heroPicks: SEATS.map(() => 0),
    heroesUsed: SEATS.map(() => []),
    heroMilestones: SEATS.map(() => 0),
    heroAt: SEATS.map(() => 0),
    heroEnding: null,
    heroBlast: null,
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
  s.powerMovesAt = s.turnNo + roundsOf(s, POWER_EVERY_ROUNDS);
}

/** The turn number a power used now runs until: that many rounds of the players taking turns. */
function holdUntil(s: GameState, rounds: number): number {
  return s.turnNo + roundsOf(s, rounds);
}

/** Hero kinds a seat hasn't had yet this game. */
export function heroOptions(state: GameState, seat: Seat): HeroKind[] {
  return HERO_KINDS.filter((k) => !(state.heroesUsed?.[seat] ?? []).includes(k));
}

/**
 * Whether a seat takes turns: still playing, or with every piece home but a hero on the board or one to pick,
 * so it's never just out of the game.
 */
export function takesTurns(state: GameState, seat: Seat): boolean {
  if (!state.ranking.includes(seat)) return true;
  if (!state.rules.heroes) return false;
  return !!state.heroes?.[seat] || ((state.heroPicks?.[seat] ?? 0) > 0 && heroOptions(state, seat).length > 0);
}

/** Rounds of the seats taking turns, in turns. */
function roundsOf(s: GameState, rounds: number): number {
  return rounds * Math.max(1, s.active.filter((x) => takesTurns(s, x)).length);
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
  if (state.event?.kind === 'storm') return null;
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

/** Track squares apart, the shorter way round. */
const apart = (a: number, b: number) => Math.min((a - b + TRACK_LEN) % TRACK_LEN, (b - a + TRACK_LEN) % TRACK_LEN);

/** Whether a piece of `seat` on track square `square` is under its guardian's watch: it can't be knocked out, bombed or eaten. */
function guarded(state: GameState, seat: Seat, square: number): boolean {
  const h = state.heroes?.[seat];
  return h?.kind === 'guardian' && apart(h.square, square) <= GUARD_REACH;
}

/** Vests a piece wears; a hero's are its own. */
const vestsOf = (state: GameState, seat: Seat, piece: number) =>
  piece >= HERO ? (state.heroes?.[seat]?.vests ?? 0) : (state.vested?.[seat]?.[piece] ?? 0);

function useVest(s: GameState, seat: Seat, piece: number): void {
  if (piece >= HERO) s.heroes[seat]!.vests--;
  else s.vested[seat][piece]--;
}

/** Whether the dragon stands on this absolute track square. */
function dragonOn(state: GameState, square: number): boolean {
  const cell = state.dragon ? DRAGON_PATH[state.dragon.at] : undefined;
  return !!cell && 'square' in cell && cell.square === square;
}

/**
 * A knock-out's points: by how far the victim had come, times REVENGE when the victim last knocked out one of
 * the hitter's pieces, KING when the victim is a king, and the moving piece's kill streak (bombs have none),
 * capped at the biggest award. A hero is worth HERO_KILL. The dragon's bombs score for nobody.
 */
function worth(state: GameState, hitter: Seat | null, victim: Seat, victimPiece: number, pos: number, streak = 0) {
  const king = isKing(state, victimPiece);
  if (hitter === null) return { points: 0, revenge: false, king };
  // The leader's bounty comes on top, for whoever knocks out one of their pieces.
  const bounty = state.rules.bounty && state.bounty?.seat === victim && hitter !== victim ? state.bounty.value : 0;
  const extra = bounty ? { bounty } : {};
  if (victimPiece >= HERO) return { points: HERO_KILL + bounty, revenge: false, king: false, ...extra };
  const revenge = state.lastHitBy?.[hitter] === victim;
  const night = state.event?.kind === 'darkNight' ? EVENT_BOOST : 1;
  const times = (revenge ? REVENGE : 1) * (king ? KING : 1) * killStreakBonus(streak) * night;
  const points = Math.min(POINTS.firstHome, Math.round(captureValue(pos) * times) + bounty);
  return { points, revenge, king, ...extra };
}

/**
 * Everyone `seat` knocks out by landing on track square `square`: other colours' pieces and heroes, unless on
 * their own safe square or (pieces) under their guardian's watch. `taken` (keys "seat:piece") are already out,
 * and the mover's kill streak counts on from `streakFrom`.
 */
function knockOutsAt(state: GameState, seat: Seat, square: number, taken: Set<string>, streakFrom: number, atStep: number): Capture[] {
  const out: Capture[] = [];
  const hit = (other: Seat, piece: number, from: number) => {
    taken.add(`${other}:${piece}`);
    const streak = streakFrom + out.length + 1;
    out.push({ seat: other, piece, from, atStep, byFlight: false, streak, ...worth(state, seat, other, piece, from, streak) });
  };
  for (const other of state.active) {
    if (other === seat || isSafe(state, other, square)) continue;
    state.pieces[other].forEach((p, j) => {
      if (taken.has(`${other}:${j}`) || !isOnTrack(p) || trackIndex(other, p) !== square || guarded(state, other, square)) return;
      hit(other, j, p);
    });
    const h = state.heroes?.[other];
    if (h && h.square === square && !taken.has(`${other}:${HERO}`)) hit(other, HERO, square);
  }
  return out;
}

/**
 * The pieces and heroes on track squares within reach of a super bomb on `center`: anyone's, the owner's too,
 * unless on their own safe square, under their guardian's watch, the engineer (no bomb hurts it), or in `skip`.
 * A vest saves its wearer.
 */
function blastAround(state: GameState, owner: Seat | null, center: number, skip: Set<string>): BlastHit[] {
  const out: BlastHit[] = [];
  const add = (other: Seat, piece: number, from: number) => {
    const saved = vestsOf(state, other, piece) > 0;
    const hit = saved || other === owner ? { points: 0, revenge: false } : worth(state, owner, other, piece, from);
    out.push({ seat: other, piece, from, saved, points: hit.points, revenge: hit.revenge, king: isKing(state, piece) });
  };
  for (const other of state.active) {
    state.pieces[other].forEach((p, j) => {
      if (skip.has(`${other}:${j}`) || !isOnTrack(p)) return;
      const sq = trackIndex(other, p);
      if (apart(sq, center) > SUPER_BOMB_REACH || isSafe(state, other, sq) || guarded(state, other, sq)) return;
      add(other, j, p);
    });
    const h = state.heroes?.[other];
    if (!h || h.kind === 'engineer' || skip.has(`${other}:${HERO}`)) continue;
    if (apart(h.square, center) <= SUPER_BOMB_REACH && !isSafe(state, other, h.square)) add(other, HERO, h.square);
  }
  return out;
}

/**
 * Works out where a piece would go with this roll, or null if the move is not allowed. Does not change `state`.
 * `openBox` draws what a magic box holds; without it (previews, bots) a box's outcome is left unknown.
 */
export function planMove(state: GameState, seat: Seat, piece: number, dice: number, openBox?: OpenBox): MovePlan | null {
  if (piece >= HERO) return planHeroMove(state, seat, dice, piece === HERO_BACK, openBox);
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

  // Every knock-out in a move is the moving piece's, so its streak counts on from what it had.
  const killsBefore = state.kills?.[seat]?.[piece] ?? 0;
  const nextStreak = () => killsBefore + plan.captures.length + 1;

  // Positions of everyone else, updated as captures happen along the chain.
  const taken = new Set<string>();
  const captureAt = (pos: number) => {
    if (!isOnTrack(pos)) return;
    plan.captures.push(...knockOutsAt(state, seat, trackIndex(seat, pos), taken, killsBefore + plan.captures.length, plan.path.length - 1));
  };

  // Everything that happens where the piece lands: a bomb, knock-outs, then a magic box. A blast sends the
  // piece back to the hangar ('hangar'); a knock-out or a box's ice keeps it on that square, with no jump or
  // flight after ('stay'); otherwise the move carries on ('on').
  // Only the moving piece's own vests count. One from a box on the way is handed out after the move.
  let vests = state.vested?.[seat]?.[piece] ?? 0;
  const slay = (pos: number) => {
    if (plan.dragon || !dragonAt(state, seat, pos)) return false;
    // With kings off, any piece slays it as a king would.
    const king = isKing(state, piece) || !rules.kings;
    plan.dragon = { at: state.dragon!.at, atStep: plan.path.length - 1, points: king ? DRAGON_PRIZE.king : DRAGON_PRIZE.piece, king };
    return true;
  };
  const land = (pos: number): 'hangar' | 'stay' | 'on' => {
    // The dragon goes up home columns too, so a piece can meet it there.
    if (!isOnTrack(pos)) return slay(pos) ? 'stay' : 'on';
    const square = trackIndex(seat, pos);
    const atStep = plan.path.length - 1;
    // The piece's guardian saves it from bombs as a vest would, without using one up.
    const guard = guarded(state, seat, square);
    const bomb = state.bombs.find((b) => b.square === square);
    if (bomb && !plan.bombed) {
      const saved = guard || vests > 0;
      if (saved && !guard) vests--;
      const { points, revenge } = saved || bomb.owner === seat ? { points: 0, revenge: false } : worth(state, bomb.owner, seat, piece, pos);
      plan.bombed = { owner: bomb.owner, square, pos, atStep, saved, points, revenge, king: isKing(state, piece), ...(guard ? { guarded: true } : {}) };
      // A super bomb goes off even when a vest saves the piece that set it off.
      if (bomb.super) plan.bombed.blast = blastAround(state, bomb.owner, square, new Set([...taken, `${seat}:${piece}`]));
      if (!saved) return 'hangar';
    }
    const knocked = plan.captures.length;
    captureAt(pos);
    // Landing on the dragon slays it, and the piece stops there.
    if (slay(pos)) return 'stay';
    // Anyone's piece opens a box, its owner's included.
    const box = state.boxes?.find((b) => b.square === square);
    if (box && !plan.box) {
      const outcome = openBox?.(BOX_OUTCOMES);
      const blast = outcome === 'bomb';
      const saved = blast && (guard || vests > 0);
      if (saved && !guard) vests--;
      const scores = blast && !saved && box.owner !== seat;
      const { points, revenge } = scores ? worth(state, box.owner, seat, piece, pos) : { points: 0, revenge: false };
      plan.box = { owner: box.owner, square, pos, atStep, outcome, saved, points, revenge, king: isKing(state, piece), ...(saved && guard ? { guarded: true } : {}) };
      if (blast && !saved) return 'hangar';
      if (outcome === 'freeze') return 'stay';
    }
    return plan.captures.length > knocked ? 'stay' : 'on';
  };

  let landed = land(cur);
  if (landed === 'hangar') return finishPlan(plan, HANGAR, state);
  if (landed === 'on' && isOnTrack(cur)) {
    for (;;) {
      // A bridge carries the piece on, and the move ends where it puts it down.
      const bridge = !plan.bridge && isOnTrack(cur) ? state.bridges?.find((b) => b.square === trackIndex(seat, cur)) : undefined;
      const across = bridge ? bridgeTarget(bridge.kind, cur) : null;
      if (bridge && across !== null) {
        plan.bridge = { owner: bridge.owner, kind: bridge.kind, square: bridge.square, from: cur, to: across, atStep: plan.path.length };
        cur = across;
        plan.path.push({ pos: cur, kind: 'bridge' });
        if (land(cur) === 'hangar') return finishPlan(plan, HANGAR, state);
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
              plan.captures.push({ seat: crossed, piece: j, from: p, atStep: plan.path.length, byFlight: true, streak, ...worth(state, seat, crossed, j, p, streak) });
            });
          }
        }
        cur += FLIGHT_DISTANCE;
        plan.flew = true;
        plan.path.push({ pos: cur, kind: 'fly' });
        landed = land(cur);
        if (landed === 'hangar') return finishPlan(plan, HANGAR, state);
        if (landed === 'stay') break;
        continue;
      }
      const wallInTheWay = [1, 2, 3].some((k) => wallAt(cur + k));
      // A power square is nobody's colour, so nobody jumps from it; nor does anyone in a storm.
      const onPower = state.power?.includes(trackIndex(seat, cur));
      const storm = state.event?.kind === 'storm';
      if (rules.jumps && !plan.jumped && isOwnColor(cur) && cur < TRACK_LAST && !wallInTheWay && !onPower && !storm) {
        cur += JUMP_DISTANCE;
        plan.jumped = true;
        plan.path.push({ pos: cur, kind: 'jump' });
        landed = land(cur);
        if (landed === 'hangar') return finishPlan(plan, HANGAR, state);
        if (landed === 'stay') break;
        continue;
      }
      break;
    }
  }

  finishPlan(plan, cur, state);
  if (isOnTrack(cur) && state.power?.includes(trackIndex(seat, cur))) plan.power = true;
  return plan;
}

function finishPlan(plan: MovePlan, to: number, state: GameState): MovePlan {
  plan.to = to;
  // Gold rain raises what a piece reaching the centre scores.
  const home = Math.round(POINTS.home * (state.event?.kind === 'goldRain' ? EVENT_BOOST : 1));
  plan.points =
    plan.captures.reduce((sum, c) => sum + c.points, 0) +
    (to === GOAL ? home : 0) +
    (plan.dragon?.points ?? 0) +
    (plan.box?.outcome === 'plus' ? POINTS.boxBonus : 0) -
    (plan.box?.outcome === 'minus' ? POINTS.boxPenalty : 0);
  return plan;
}

/** Draws what a magic box holds, from these outcomes. */
export type OpenBox = (options: readonly BoxOutcome[]) => BoxOutcome;

/**
 * Where a hero would go with this roll, or null if it can't move. It goes round the track only, as far as the
 * dice says (the archer forward or back) but no further than its life has left, and can't pass another
 * colour's wall. Where it stops it knocks out other colours (the thief robs them instead), slays the dragon and
 * sets off a bomb (the engineer defuses every bomb on its way instead). It takes no colour jump, flight, bridge
 * or power square, and opens no magic box, but the thief, for whom it's always good.
 */
function planHeroMove(state: GameState, seat: Seat, dice: number, back: boolean, openBox?: OpenBox): MovePlan | null {
  const h = state.heroes?.[seat];
  if (!state.rules.heroes || !h || h.frozen > 0 || (back && h.kind !== 'archer')) return null;
  const steps = Math.min(dice, h.left);
  const at = (k: number) => (((h.square + (back ? -k : k)) % TRACK_LEN) + TRACK_LEN) % TRACK_LEN;
  const path: PathStep[] = Array.from({ length: steps }, (_, i) => ({ pos: at(i + 1), kind: 'step' }));
  const walls = wallsAgainst(state, seat);
  if (path.slice(0, -1).some((step) => walls.has(step.pos))) return null;
  const to = at(steps);
  const atStep = steps - 1;
  const move: HeroMove = { kind: h.kind, back, defused: [], stolen: [], froze: [], ends: steps >= h.left };
  const plan: MovePlan = { seat, piece: back ? HERO_BACK : HERO, dice, from: h.square, to, path, captures: [], jumped: false, flew: false, points: 0, hero: move };
  const taken = new Set([`${seat}:${HERO}`]);

  if (h.kind === 'engineer') {
    move.defused = state.bombs.filter((b) => path.some((step) => step.pos === b.square)).map((b) => b.square);
  } else {
    const bomb = state.bombs.find((b) => b.square === to);
    if (bomb) {
      const saved = h.vests > 0;
      const { points, revenge } = saved || bomb.owner === seat ? { points: 0, revenge: false } : worth(state, bomb.owner, seat, HERO, to);
      plan.bombed = { owner: bomb.owner, square: to, pos: to, atStep, saved, points, revenge, king: false };
      if (bomb.super) plan.bombed.blast = blastAround(state, bomb.owner, to, taken);
      if (!saved) return finishHeroPlan(plan, HANGAR, state);
    }
  }

  if (h.kind === 'thief') {
    const here = (o: Seat) => state.pieces[o].some((p) => isOnTrack(p) && trackIndex(o, p) === to) || state.heroes?.[o]?.square === to;
    for (const o of state.active.filter((o) => o !== seat && here(o))) {
      const vests =
        state.pieces[o].reduce((n, p, j) => n + (isOnTrack(p) && trackIndex(o, p) === to ? vestsOf(state, o, j) : 0), 0) +
        (state.heroes?.[o]?.square === to ? state.heroes[o]!.vests : 0);
      move.stolen.push({ seat: o, points: Math.max(0, Math.min(HERO_STEAL, state.stats[o].points)), vests });
    }
    if (state.rules.bounty && state.bounty && move.stolen.some((x) => x.seat === state.bounty!.seat)) move.bounty = state.bounty.value;
    const box = state.boxes?.find((b) => b.square === to);
    if (box) plan.box = { owner: box.owner, square: to, pos: to, atStep, outcome: openBox?.(THIEF_BOX), saved: false, points: 0, revenge: false, king: false };
  } else {
    plan.captures = knockOutsAt(state, seat, to, taken, h.kills, atStep);
  }

  if (dragonOn(state, to)) {
    // The dragon rider slays it as a king would; any other hero as a plain piece.
    const king = h.kind === 'rider';
    plan.dragon = { at: state.dragon!.at, atStep, points: king ? DRAGON_PRIZE.king : DRAGON_PRIZE.piece, king };
  }

  if (h.kind === 'frost') {
    for (const o of state.active) {
      if (o === seat) continue;
      state.pieces[o].forEach((p, j) => {
        if (isOnTrack(p) && apart(trackIndex(o, p), to) <= FROST_REACH && !taken.has(`${o}:${j}`)) move.froze.push({ seat: o, piece: j });
      });
      const oh = state.heroes?.[o];
      if (oh && apart(oh.square, to) <= FROST_REACH && !taken.has(`${o}:${HERO}`)) move.froze.push({ seat: o, piece: HERO });
    }
  }
  return finishHeroPlan(plan, to, state);
}

function finishHeroPlan(plan: MovePlan, to: number, state: GameState): MovePlan {
  finishPlan(plan, to, state);
  const move = plan.hero!;
  plan.points += move.defused.length * HERO_DEFUSE + move.stolen.reduce((n, x) => n + x.points, 0) + (move.bounty ?? 0);
  return plan;
}

/** The bomb (placed, or from a magic box) that blew this move's piece back to the hangar, if any. */
export function blastOf(plan: MovePlan): { owner: Seat | null; square: number; pos: number; atStep: number; points: number } | null {
  if (plan.bombed && !plan.bombed.saved) return plan.bombed;
  if (plan.box?.outcome === 'bomb' && !plan.box.saved) return plan.box;
  return null;
}

/** The game as the players can see it: in fog, without the bombs, magic boxes and bridges it hides. */
export function asSeen(state: GameState): GameState {
  if (state.event?.kind !== 'fog') return state;
  return { ...state, bombs: [], boxes: [], bridges: [] };
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
  // A hero moves instead of a piece; the archer may go either way.
  for (const j of [HERO, HERO_BACK]) if (planHeroMove(state, seat, dice, j === HERO_BACK)) out.push(j);
  return out;
}

/** One representative per group of movable pieces that would make the same move. */
export function distinctMoves(state: GameState): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  for (const j of state.movable) {
    // A king scores differently from the pieces sharing its square, so moving it is a move of its own; so is a hero's.
    const key = j >= HERO ? `hero${j}` : `${state.pieces[state.turn][j]}:${isKing(state, j)}`;
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
  const hero = s.heroes?.[s.turn];
  if (hero && hero.frozen > 0) hero.frozen--;
  s.sixStreak = 0;
  s.streakMoved = [];
  s.dice = null;
  s.movable = [];
  const order = s.active;
  const idx = order.indexOf(s.turn);
  for (let i = 1; i <= order.length; i++) {
    const cand = order[(idx + i) % order.length];
    if (takesTurns(s, cand)) {
      s.turn = cand;
      s.phase = 'roll';
      s.turnNo++;
      if (s.rules.powerSquares && s.turnNo >= (s.powerMovesAt ?? 0)) movePower(s, rand);
      s.safe = (s.safe ?? []).filter((x) => x.until > s.turnNo);
      if (s.ambush && s.ambush.until <= s.turnNo) s.ambush = null;
      newRound(s, rand);
      // A hero earned and waiting is picked before the roll, once the last one has gone.
      if (s.rules.heroes && !s.heroes[cand] && s.heroPicks[cand] > 0 && heroOptions(s, cand).length) s.phase = 'hero';
      return;
    }
  }
  s.phase = 'over';
}

/** What comes and goes with the turns: surprise events, the dragon, and the bounty on the leader. */
function newRound(s: GameState, rand: Rand): void {
  if (s.event && s.turnNo >= s.event.until) s.event = null;
  if (s.rules.events && s.turnNo >= (s.eventAt ?? 0)) {
    startEvent(s, rand);
    s.eventAt = s.turnNo + roundsOf(s, EVENT_EVERY_ROUNDS);
  }
  if (s.rules.dragon && !s.dragon && !s.dragonGone && s.turnNo >= (s.dragonAt ?? 0)) {
    const free = freeSquares(s);
    if (free.length) {
      const square = free[rand(free.length)];
      s.dragon = { at: DRAGON_PATH.findIndex((c) => 'square' in c && c.square === square), moved: 0, sixes: 0 };
    } else s.dragonAt = s.turnNo + 1;
  }
  // A seat with every piece home earns a hero every HERO_FINISHED_ROUNDS rounds, while it has kinds left.
  if (s.rules.heroes) {
    for (const seat of s.ranking) {
      if (s.heroes[seat] || s.heroPicks[seat] > 0 || !heroOptions(s, seat).length || s.turnNo < s.heroAt[seat]) continue;
      s.heroPicks[seat]++;
    }
  }
  updateBounty(s);
}

/** Takes a piece off the board: a piece back to its hangar, a hero gone for good. */
function knockOut(s: GameState, seat: Seat, piece: number): void {
  s.stats[seat].lost++;
  if (piece >= HERO) return heroGone(s, seat);
  s.pieces[seat][piece] = HANGAR;
  if (s.frozen) s.frozen[seat][piece] = 0;
  if (s.kills) s.kills[seat][piece] = 0;
}

/** A hero leaves the board. A seat with every piece home earns its next one HERO_FINISHED_ROUNDS rounds on. */
function heroGone(s: GameState, seat: Seat): void {
  s.heroes[seat] = null;
  if (s.ranking.includes(seat)) s.heroAt[seat] = s.turnNo + roundsOf(s, HERO_FINISHED_ROUNDS);
}

/** Whether the dragon leaves a piece alone: on its own safe square, under its guardian's watch, or its player's dragon rider is out. */
function spared(s: GameState, v: { seat: Seat; piece: number; from: number }): boolean {
  if (s.heroes?.[v.seat]?.kind === 'rider') return true;
  if (v.piece >= HERO) return isSafe(s, v.seat, v.from);
  if (!isOnTrack(v.from)) return false;
  const sq = trackIndex(v.seat, v.from);
  return isSafe(s, v.seat, sq) || guarded(s, v.seat, sq);
}

/**
 * The dragon's lap is done: it explodes, and every piece where it is or DRAGON_BLAST_REACH squares either side
 * (home columns too) goes back to the hangar, unless on its own safe square or saved by a vest.
 */
function dragonExplodes(s: GameState): void {
  const at = s.dragon!.at;
  const hit: BlastVictim[] = [];
  for (const cell of cellsAround(DRAGON_PATH[at], DRAGON_BLAST_REACH)) {
    for (const v of piecesOn(s, cell)) {
      if (spared(s, v)) continue;
      const saved = vestsOf(s, v.seat, v.piece) > 0;
      hit.push({ ...v, saved });
      if (saved) useVest(s, v.seat, v.piece);
      else knockOut(s, v.seat, v.piece);
    }
  }
  s.dragonBlast = { n: (s.dragonBlast?.n ?? 0) + 1, at, hit };
  s.dragon = null;
  s.dragonAt = s.turnNo + roundsOf(s, DRAGON_EVERY_ROUNDS);
}

/** Starts a surprise event at random, among those that would change something. */
function startEvent(s: GameState, rand: Rand): void {
  const shaken = s.bombs.length + (s.boxes ?? []).length;
  const hidden = shaken + (s.bridges ?? []).length;
  const kinds = (Object.keys(WORLD_EVENTS) as WorldEventKind[]).filter((k) => (k !== 'earthquake' || shaken > 0) && (k !== 'fog' || hidden > 0));
  const kind = kinds[rand(kinds.length)];
  s.eventN = (s.eventN ?? 0) + 1;
  s.event = { kind, n: s.eventN, until: s.turnNo + roundsOf(s, WORLD_EVENTS[kind].rounds) };
  if (kind === 'earthquake') {
    // Every bomb, super bomb and magic box jumps to a free square, never one another has just taken.
    const bombs = s.bombs;
    const boxes = s.boxes ?? [];
    s.bombs = [];
    s.boxes = [];
    const elsewhere = (from: number) => {
      const free = freeSquares(s).filter((sq) => sq !== from);
      return free.length ? free[rand(free.length)] : from;
    };
    for (const b of bombs) s.bombs.push({ ...b, square: elsewhere(b.square) });
    for (const b of boxes) s.boxes.push({ ...b, square: elsewhere(b.square) });
  }
}

/**
 * The bounty sits on whoever leads on points among those still playing (nobody on a tie). It starts at
 * BOUNTY.start when someone takes the lead and grows by BOUNTY.perRound each time their turn comes round.
 */
function updateBounty(s: GameState): void {
  if (!s.rules.bounty) {
    s.bounty = null;
    return;
  }
  const playing = s.active.filter((x) => !s.ranking.includes(x));
  const top = Math.max(...playing.map((x) => s.stats[x].points));
  const leaders = playing.filter((x) => s.stats[x].points === top);
  const leader = leaders.length === 1 && top > 0 ? leaders[0] : null;
  if (leader === null) s.bounty = null;
  else if (s.bounty?.seat !== leader) s.bounty = { seat: leader, value: BOUNTY.start };
  else if (s.turn === leader) s.bounty.value = Math.min(BOUNTY.max, s.bounty.value + BOUNTY.perRound);
}

/**
 * Counts a lost turn for a seat with nothing out of the hangar. Returns true on every STUCK_TURNS-th one in
 * a row, for a sad reaction.
 */
function countStuck(s: GameState, seat: Seat): boolean {
  s.stuck ??= SEATS.map(() => 0);
  if (s.pieces[seat].some((p) => p !== HANGAR && p !== GOAL) || s.heroes?.[seat]) {
    s.stuck[seat] = 0;
    return false;
  }
  s.stuck[seat]++;
  if (s.stuck[seat] < STUCK_TURNS) return false;
  s.stuck[seat] = 0;
  return true;
}

/**
 * The dragon goes as far along its route as the dice says, setting nothing off on the way, and eats every
 * piece and hero where it stops, unless spared. A second six in a row leaves a bomb where it stops, a third a
 * super bomb, on a free track square. Back where it started, its lap is done and it explodes there.
 */
function moveDragon(s: GameState, dice: number, event: RollEvent): void {
  const d = s.dragon!;
  const from = d.at;
  const steps = Math.min(dice, DRAGON_PATH.length - d.moved);
  const to = (from + steps) % DRAGON_PATH.length;
  d.at = to;
  d.moved += steps;
  event.dragon = { from, to, steps, eaten: [] };
  if (d.moved >= DRAGON_PATH.length) {
    dragonExplodes(s);
    event.dragon.exploded = true;
    return;
  }
  const eaten = piecesOn(s, DRAGON_PATH[to]).filter((v) => !spared(s, v));
  for (const v of eaten) knockOut(s, v.seat, v.piece);
  event.dragon.eaten = eaten;
  const cell = DRAGON_PATH[to];
  d.sixes = dice === 6 ? (d.sixes ?? 0) + 1 : 0;
  if (d.sixes >= 2 && 'square' in cell && freeSquares(s).includes(cell.square)) {
    const big = d.sixes >= 3;
    s.bombs.push({ square: cell.square, owner: null, ...(big ? { super: true } : {}) });
    event.dragon.bomb = cell.square;
    if (big) event.dragon.superBomb = true;
  }
  // Three in a row is as far as it goes: the count starts over.
  if (d.sixes >= 3) d.sixes = 0;
}

export function applyRoll(state: GameState, dice: number, rand: Rand = defaultRand): { state: GameState; event: RollEvent } {
  if (state.phase !== 'roll') throw new RuleError('Not time to roll');
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) throw new RuleError('Bad dice value');

  const s = structuredClone(state);
  const seat = s.turn;
  s.seq++;
  s.dice = dice;
  const event: RollEvent = { type: 'roll', seat, dice, outcome: 'move', movable: [], penalized: [] };
  if (s.dragon) moveDragon(s, dice, event);

  if (dice === 6) {
    s.sixStreak++;
    s.stats[seat].sixes = (s.stats[seat].sixes ?? 0) + 1;
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
  const plan = planMove(state, seat, piece, dice, (options) => options[rand(options.length)]);
  if (!plan) throw new RuleError('That plane cannot move');

  const s = structuredClone(state);
  s.seq++;
  s.frozen ??= perPiece();
  s.kills ??= perPiece();
  s.stuck ??= SEATS.map(() => 0);
  s.stuck[seat] = 0;
  // A hero keeps its square and counts down its life; a bomb that gets it takes it off the board (below).
  const hero = plan.hero ? s.heroes[seat]! : null;
  if (hero) {
    if (plan.to !== HANGAR) hero.square = plan.to;
    hero.left -= plan.path.length;
    hero.kills += plan.captures.length;
  } else {
    s.pieces[seat][piece] = plan.to;
    s.kills[seat][piece] = plan.to === HANGAR ? 0 : s.kills[seat][piece] + plan.captures.length;
  }
  for (const c of plan.captures) knockOut(s, c.seat, c.piece);
  if (plan.bridge) s.bridges = s.bridges.filter((b) => b.square !== plan.bridge!.square);
  if (plan.dragon) {
    // Slain by a king, it's gone for good; by any other piece, another comes later.
    s.dragon = null;
    s.dragonAt = s.turnNo + roundsOf(s, DRAGON_EVERY_ROUNDS);
    if (plan.dragon.king) s.dragonGone = true;
    s.stats[seat].dragons = (s.stats[seat].dragons ?? 0) + 1;
  }
  // A claimed bounty goes back to its starting value; it stays on the leader.
  const claimed =
    plan.captures.some((c) => c.bounty) ||
    (plan.bombed && !plan.bombed.saved && plan.bombed.owner !== null && plan.bombed.owner !== seat && s.bounty?.seat === seat) ||
    (plan.bombed?.blast ?? []).some((v) => !v.saved && v.seat === s.bounty?.seat && v.seat !== plan.bombed!.owner) ||
    (plan.box?.outcome === 'bomb' && !plan.box.saved && plan.box.owner !== seat && s.bounty?.seat === seat);
  if (claimed && s.bounty) s.bounty.value = BOUNTY.start;
  s.stats[seat].captures += plan.captures.length;
  s.stats[seat].points += plan.points;
  // Report and medal bookkeeping; a bomb's owner is credited with what it blew up.
  const mine = s.stats[seat];
  const credit = (owner: Seat | null, points: number) => {
    if (owner === null) return;
    const st = s.stats[owner];
    st.bestHit = Math.max(st.bestHit ?? 0, points);
    st.bombKills = (st.bombKills ?? 0) + 1;
  };
  for (const c of plan.captures) {
    mine.bestHit = Math.max(mine.bestHit ?? 0, c.points);
    mine.bestStreak = Math.max(mine.bestStreak ?? 0, c.streak);
  }
  if (plan.flew) mine.flights = (mine.flights ?? 0) + 1;
  if (plan.box) mine.boxes = (mine.boxes ?? 0) + 1;
  if (plan.power) mine.powers = (mine.powers ?? 0) + 1;
  if (plan.bombed && !plan.bombed.saved && plan.bombed.owner !== seat) credit(plan.bombed.owner, plan.bombed.points);
  for (const v of plan.bombed?.blast ?? []) if (!v.saved && v.seat !== plan.bombed!.owner) credit(plan.bombed!.owner, v.points);
  if (plan.box?.outcome === 'bomb' && !plan.box.saved && plan.box.owner !== seat) credit(plan.box.owner, plan.box.points);
  if (plan.bombed) {
    const { owner, square, points, saved, guarded: guard } = plan.bombed;
    s.bombs = s.bombs.filter((b) => b.square !== square);
    if (saved) {
      if (!guard) useVest(s, seat, piece);
    } else {
      s.stats[seat].lost++;
      if (hero) heroGone(s, seat);
      if (owner !== null && owner !== seat) {
        s.stats[owner].captures++;
        s.stats[owner].points += points;
      }
    }
    for (const v of plan.bombed.blast ?? []) {
      if (v.saved) {
        useVest(s, v.seat, v.piece);
        continue;
      }
      knockOut(s, v.seat, v.piece);
      if (owner !== null && owner !== v.seat) {
        s.stats[owner].captures++;
        s.stats[owner].points += v.points;
      }
    }
  }
  if (plan.box) {
    const { owner, square, points, saved, outcome, guarded: guard } = plan.box;
    s.boxes = s.boxes.filter((b) => b.square !== square);
    if (outcome === 'freeze') s.frozen[seat][piece] = FROZEN_TURNS;
    if (outcome === 'bomb' && saved && !guard) useVest(s, seat, piece);
    // The thief wears a vest it finds itself.
    if (outcome === 'vest' && hero) hero.vests++;
    if (outcome === 'bomb' && !saved) {
      s.stats[seat].lost++;
      if (owner !== seat) {
        s.stats[owner].captures++;
        s.stats[owner].points += points;
      }
    }
  }
  if (plan.hero) heroDoes(s, plan, hero);
  if (plan.to === GOAL && !hero) s.stats[seat].home++;
  if (dice === 6 && !hero) s.streakMoved.push(piece);

  // Revenge settles a score; each new knock-out opens one.
  s.lastHitBy ??= SEATS.map(() => null);
  for (const c of plan.captures) {
    if (c.revenge) s.lastHitBy[seat] = null;
    s.lastHitBy[c.seat] = seat;
  }
  const blast = blastOf(plan);
  if (blast && blast.owner !== null && blast.owner !== seat) {
    if ((plan.bombed && !plan.bombed.saved ? plan.bombed : plan.box)?.revenge) s.lastHitBy[blast.owner] = null;
    s.lastHitBy[seat] = blast.owner;
  }
  const bomber = plan.bombed?.owner ?? null;
  for (const v of plan.bombed?.blast ?? []) {
    if (v.saved || bomber === null || v.seat === bomber) continue;
    if (v.revenge) s.lastHitBy[bomber] = null;
    s.lastHitBy[v.seat] = bomber;
  }

  // A triple kill earns a hero, as do points (heroMilestones).
  if (s.rules.heroes && plan.captures.some((c) => c.streak === 3)) s.heroPicks[seat]++;
  // A hero's life is over: it's gone, but for the engineer, whose player puts down its super bomb first.
  if (hero && plan.hero!.ends && s.heroes[seat]) {
    if (hero.kind === 'engineer') {
      s.heroEnding = seat;
      if (!freeSquares(s).length) engineerExplodes(s);
    } else heroGone(s, seat);
  }

  const event: MoveEvent = { ...plan, type: 'move', extraRoll: false, seatFinished: false, bonus: 0, gameOver: false };

  if (!hero && seatFinished(s, seat)) {
    event.seatFinished = true;
    if (s.ranking.length === 0) {
      event.bonus = POINTS.firstHome;
      s.stats[seat].points += POINTS.firstHome;
    }
    heroMilestones(s);
    s.ranking.push(seat);
    s.heroAt[seat] = s.turnNo + roundsOf(s, HERO_FINISHED_ROUNDS);
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

  heroMilestones(s);
  const extra =
    (dice === 6 && s.rules.bonusRollOnSix) || (s.rules.bonusRollOnCapture && plan.captures.length > 0);
  event.extraRoll = extra;
  if (extra && dice !== 6) {
    s.sixStreak = 0;
    s.streakMoved = [];
  }
  const vest = plan.box?.outcome === 'vest' && !hero;
  if (s.heroEnding !== null || vest || plan.power) {
    // The turn waits while the mover puts down the engineer's super bomb, or picks who wears the vest, then a
    // power, and carries on as it would have.
    s.phase = s.heroEnding !== null ? 'place' : vest ? 'vest' : 'power';
    if (s.phase === 'place') s.placing = 'superBomb';
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

/** What a hero's move does besides moving and knocking out: bombs defused, things stolen, pieces frozen. */
function heroDoes(s: GameState, plan: MovePlan, hero: Hero | null): void {
  const move = plan.hero!;
  s.bombs = s.bombs.filter((b) => !move.defused.includes(b.square));
  for (const x of move.stolen) {
    s.stats[x.seat].points -= x.points;
    s.pieces[x.seat].forEach((p, j) => {
      if (isOnTrack(p) && trackIndex(x.seat, p) === plan.to) s.vested[x.seat][j] = 0;
    });
    const theirs = s.heroes[x.seat];
    if (theirs && theirs.square === plan.to) theirs.vests = 0;
    if (hero) hero.vests += x.vests;
  }
  if (move.bounty && s.bounty) s.bounty.value = BOUNTY.start;
  for (const f of move.froze) {
    if (f.piece < HERO) s.frozen[f.seat][f.piece] = Math.max(s.frozen[f.seat][f.piece], 1);
    else if (s.heroes[f.seat]) s.heroes[f.seat]!.frozen = Math.max(s.heroes[f.seat]!.frozen, 1);
  }
}

/** Heroes earned by points: one the first time a seat reaches each of HERO_THRESHOLDS. */
function heroMilestones(s: GameState): void {
  if (!s.rules.heroes) return;
  for (const seat of s.active) {
    while (s.heroMilestones[seat] < HERO_THRESHOLDS.length && s.stats[seat].points >= HERO_THRESHOLDS[s.heroMilestones[seat]]) {
      s.heroMilestones[seat]++;
      s.heroPicks[seat]++;
    }
  }
}

/**
 * The engineer's life is over: it goes off where it stands, taking other colours' pieces and heroes on its
 * square and DRAGON_BLAST_REACH squares either side (vests, safe squares and guardians save them; other
 * engineers don't mind), each scored as a knock-out for its player.
 */
function engineerExplodes(s: GameState): void {
  const seat = s.heroEnding!;
  s.heroEnding = null;
  const h = s.heroes[seat];
  if (!h) return;
  const hit: BlastVictim[] = [];
  for (const other of s.active) {
    if (other === seat) continue;
    s.pieces[other].forEach((p, j) => {
      if (!isOnTrack(p)) return;
      const sq = trackIndex(other, p);
      if (apart(sq, h.square) <= DRAGON_BLAST_REACH && !isSafe(s, other, sq) && !guarded(s, other, sq)) hit.push({ seat: other, piece: j, from: p, saved: false });
    });
    const theirs = s.heroes[other];
    if (theirs && theirs.kind !== 'engineer' && apart(theirs.square, h.square) <= DRAGON_BLAST_REACH && !isSafe(s, other, theirs.square)) {
      hit.push({ seat: other, piece: HERO, from: theirs.square, saved: false });
    }
  }
  const mine = s.stats[seat];
  for (const v of hit) {
    v.saved = vestsOf(s, v.seat, v.piece) > 0;
    if (v.saved) {
      useVest(s, v.seat, v.piece);
      continue;
    }
    v.points = worth(s, seat, v.seat, v.piece, v.from).points;
    knockOut(s, v.seat, v.piece);
    mine.captures++;
    mine.points += v.points;
    mine.bombKills = (mine.bombKills ?? 0) + 1;
    mine.bestHit = Math.max(mine.bestHit ?? 0, v.points);
    s.lastHitBy[v.seat] = seat;
  }
  s.heroBlast = { n: (s.heroBlast?.n ?? 0) + 1, seat, square: h.square, hit };
  heroGone(s, seat);
}

/** Picks a hero, at the start of a turn: it comes on at the player's first track square, and the turn goes on to the roll. */
export function applyHero(state: GameState, kind: HeroKind): { state: GameState; event: HeroEvent } {
  if (state.phase !== 'hero') throw new RuleError('Not time to pick a hero');
  if (!heroOptions(state, state.turn).includes(kind)) throw new RuleError("That hero can't be picked");
  const s = structuredClone(state);
  s.seq++;
  const seat = s.turn;
  s.heroPicks[seat]--;
  s.heroesUsed[seat].push(kind);
  const square = trackIndex(seat, TRACK_FIRST);
  s.heroes[seat] = { kind, square, left: HERO_LIFE, kills: 0, vests: 0, frozen: 0 };
  s.phase = 'roll';
  return { state: s, event: { type: 'hero', seat, kind, square } };
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
  // The engineer's last super bomb goes down like the power square's, and then it goes off.
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
    if (s.heroEnding !== null) {
      engineerExplodes(s);
      heroMilestones(s);
      event.ends = true;
    }
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

