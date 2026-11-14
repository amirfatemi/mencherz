import {
  ABSOLUTE,
  FLIGHT_CROSSES,
  FLIGHT_DISTANCE,
  FLIGHT_FROM,
  GOAL,
  HANGAR,
  HOME_FIRST,
  HOME_LAST,
  homeCell,
  JUMP_DISTANCE,
  LAYOUT_VERSION,
  PIECES_PER_SEAT,
  SEATS,
  TAKEOFF,
  TRACK_FIRST,
  TRACK_LAST,
  TRACK_LEN,
  along,
  flightCrossedSeat,
  isOnTrack,
  isOwnColor,
  trackColor,
  trackIndex,
  seatPos,
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
   * sixes in a row leave a bomb where it stops, three a super bomb, home columns too. It plays like a player: what
   * it takes scores for it (dragonStats). Landing on it pays DRAGON_PRIZE. If nobody slays it, it explodes
   * when its lap is done, taking the pieces next to it (DRAGON_BLAST_REACH) along. Slain (by a king too) or
   * exploded, the next one comes DRAGON_EVERY_ROUNDS rounds later. It sets off nothing and takes no bridge.
   */
  dragon: boolean;
  /**
   * Heroes: each player picks HERO_TEAM kinds (see HERO_KINDS) before the game starts, and launches one of them
   * instead of a piece, one at a time, as often as they like. A hero goes round the track only, never up a home
   * column, for HERO_LIFE squares, each kind with its own power. Moving it uses the roll.
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
  /** Absolute track index (0..51), as in TRACK; the dragon's can also be in a home column (homeCell). */
  square: number;
  /** Null for a bomb the dragon left: it scores for the dragon (dragonStats). */
  owner: Seat | null;
  /** A super bomb, from a power square: its blast also takes every piece within SUPER_BOMB_REACH squares. */
  super?: boolean;
}

/**
 * How far along the track, ahead or behind, a super bomb's blast reaches. A track bomb's blast doesn't reach into
 * home columns; the dragon's super bomb in a home column blasts that column as far.
 */
export const SUPER_BOMB_REACH = 3;

/** Surprise events, and how many rounds each lasts (an earthquake just happens, and stays announced a round). */
export type WorldEventKind = 'storm' | 'goldRain' | 'earthquake' | 'darkNight' | 'fog';
export const EVENT_ROUNDS = 5;
export const WORLD_EVENTS: Record<WorldEventKind, { rounds: number }> = {
  /** No flights and no colour jumps. */
  storm: { rounds: EVENT_ROUNDS },
  /** Pieces reaching the centre score EVENT_BOOST times. */
  goldRain: { rounds: EVENT_ROUNDS },
  /** Every bomb and magic box jumps to another free square, once. */
  earthquake: { rounds: 1 },
  /** Knock-outs score EVENT_BOOST times. */
  darkNight: { rounds: EVENT_ROUNDS },
  /** Bombs, magic boxes and bridges can't be seen. */
  fog: { rounds: EVENT_ROUNDS },
};
export const EVENT_EVERY_ROUNDS = 15;
/** How much more gold rain makes a piece home, and a dark night a knock-out. */
export const EVENT_BOOST = 1.2;

/** The bounty on the points leader: what it starts at, what each round in the lead adds, and its most. */
export const BOUNTY = { start: 3, perRound: 1, max: 8 } as const;

/** Rounds before the first dragon comes, and after one is slain (whoever slays it) or explodes. */
export const DRAGON_FIRST_ROUNDS = 10;
export const DRAGON_EVERY_ROUNDS = 10;
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

/** How many of its owner's turns a piece a magic box froze sits out. */
export const ICE_TURNS = 3;
/** What a box's ice sets a piece's `frozen` count to: the rest of this turn, then the owner's next ICE_TURNS turns. */
const FROZEN_TURNS = ICE_TURNS + 1;

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
export const AMBUSH_ROUNDS = 10;
/** The power squares move after this many rounds. */
export const POWER_EVERY_ROUNDS = 5;
/** Turns in a row without a piece out of the hangar that earn a sad reaction. */
export const STUCK_TURNS = 3;

/**
 * The heroes. Each player picks HERO_TEAM kinds before the game starts, and from then on any roll that would launch
 * a piece can launch one of them instead (LAUNCH), one on the board at a time. A hero that has left the board rests
 * for HERO_REST_ROUNDS rounds before it can come on again; the other two can come on meanwhile. A hero
 * waits at its player's takeoff spot (HERO_START), then goes round the track for HERO_LIFE squares and is gone. It
 * never goes home, so a player with every piece home plays on with it. Only the archer knocks anyone out (and death
 * kings); the others just have their power, and can stop where anyone stands.
 * - archer: goes forward or back, as its player likes, with every roll, and knocks out pieces and heroes.
 * - engineer: takes over a bomb of another colour it stops on (not one it passes), so it's its player's now (no
 *   points for it; the dragon's stay the dragon's), and no bomb hurts it. At the end of its life its player puts
 *   down a super bomb, then it goes off where it stands (DRAGON_BLAST_REACH either side), taking opponents only.
 * - guardian: the first time one of its player's pieces on its square or GUARD_REACH either side would be knocked
 *   out or eaten by the dragon, it's knocked out in their place (which pays GUARDIAN_KILL). Bombs and blasts still
 *   get them.
 * - frost: where it stops, other colours' pieces and heroes within FROST_REACH freeze for FROST_TURNS of their turns.
 * - thief: knocks nobody out; where it stops it robs every other colour's piece and hero there of THIEF_TIMES what
 *   knocking it out would have paid, takes their vests, and the bounty if the leader is one of them. A magic box
 *   is always good for it (points or a vest).
 * - rider: the first time the dragon would eat or blow up one of its player's pieces, it goes in their place (not
 *   from the takeoff spot). It slays the dragon for a king's prize. (The archer slays it too, as a plain piece;
 *   no other hero does.)
 * - wizard: where it stops, other colours' pieces there but kings are charmed: for CHARM_ROUNDS rounds its player
 *   moves them (CHARM) round the track, past their own home column, as its own piece: they knock out anyone, and
 *   anyone can knock them out. Then they're their owners' again, where they stand.
 * - death: knocks out kings only, and for each it sends one of that colour's pieces in the centre back to its
 *   hangar, taking the points it brought (POINTS.home).
 */
export type HeroKind = 'archer' | 'engineer' | 'guardian' | 'frost' | 'thief' | 'rider' | 'wizard' | 'death';
export const HERO_KINDS: readonly HeroKind[] = ['archer', 'engineer', 'guardian', 'frost', 'thief', 'rider', 'wizard', 'death'];
/** How many hero kinds each player picks for the game. */
export const HERO_TEAM = 3;
/** Rounds a hero rests after it leaves the board, knocked out or done, before its player can launch it again. */
export const HERO_REST_ROUNDS = 9;
/** How many squares a hero goes before it's gone: once round the track. */
export const HERO_LIFE = TRACK_LEN;
/** Knocking out a hero, by any means; the guardian pays more. */
export const HERO_KILL = 15;
export const GUARDIAN_KILL = 20;
export const GUARD_REACH = 2;
export const FROST_REACH = 2;
export const FROST_TURNS = 5;
/** What the thief takes, times what a knock-out would pay. */
export const THIEF_TIMES = 1.5;
export const CHARM_ROUNDS = 5;
/** The piece number a hero's move goes by, and the archer's move back. */
export const HERO = 4;
export const HERO_BACK = 5;
/** Piece numbers for launching each of the player's heroes: LAUNCH + its place in their team. */
export const LAUNCH = 6;
/** Piece numbers for moving a charmed piece: CHARM + 4 × its seat + its piece. */
export const CHARM = 10;
export const charmMove = (seat: Seat, piece: number) => CHARM + seat * PIECES_PER_SEAT + piece;
export const charmOf = (move: number) => ({ seat: Math.floor((move - CHARM) / PIECES_PER_SEAT) as Seat, piece: (move - CHARM) % PIECES_PER_SEAT });
/**
 * Where a hero waits when it comes on: its player's takeoff spot, like a piece just launched. Nothing reaches it
 * there; its first move takes it onto the track, forward only.
 */
export const HERO_START = -2;
/** What a magic box can hold for the thief. */
const THIEF_BOX: readonly BoxOutcome[] = ['plus', 'vest'];

export interface Hero {
  kind: HeroKind;
  /** Absolute track square, or HERO_START. */
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

/** A piece its guardian or its dragon rider saved, going in its place. */
export interface HeroSave {
  seat: Seat;
  piece: number;
  /** The absolute track square it was on. */
  square: number;
  by: 'guardian' | 'rider';
}

/** Another colour's piece under a wizard's spell: `by` moves it until turn `until`. */
export interface Charm {
  seat: Seat;
  piece: number;
  by: Seat;
  until: number;
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
  /** The dragon's last explosion, numbered so it's shown once: where, what it took (or a vest saved), and who a rider saved. */
  dragonBlast: { n: number; at: number; hit: BlastVictim[]; saved?: HeroSave[] } | null;
  /** Each seat's hero on the board. */
  heroes: (Hero | null)[];
  /** The hero kinds each seat picked for the game (empty until it has). */
  heroTeams: HeroKind[][];
  /** Per seat, the turn number from which each of its hero kinds that has left the board can be launched again. */
  heroRest: Partial<Record<HeroKind, number>>[];
  /**
   * The dragon as a player: the points it has made eating and blowing up pieces and heroes (and with its bombs),
   * how many it took, and how many times it was slain.
   */
  dragonStats: { points: number; captures: number; slain: number };
  /** Pieces under a wizard's spell. */
  charmed: Charm[];
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
  /** A guardian knocked out in place of its pieces (see MovePlan.heroSaves). */
  sacrifice?: boolean;
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
  /** The piece landed on the dragon and slew it, for DRAGON_PRIZE (in points), the king's if `king`. */
  dragon?: { at: number; atStep: number; points: number; king: boolean };
  /**
   * A hero's move. Its `from`, `to` and `path` positions are absolute track squares; `to` is HANGAR when a bomb got
   * it. Launching one goes from HANGAR to HERO_START.
   */
  hero?: HeroMove;
  /** A charmed piece of another colour moving for the mover: its seat and piece. Positions are that seat's. */
  charm?: { seat: Seat; piece: number };
  /** Pieces their guardian kept from being knocked out, knocked out itself instead. */
  heroSaves?: HeroSave[];
}

export interface HeroMove {
  kind: HeroKind;
  /** It comes on, at the takeoff spot. */
  launch?: boolean;
  /** The archer going back. */
  back: boolean;
  /** Squares of the bombs the engineer took over: they're its player's now. */
  hijacked: number[];
  /**
   * What the thief took from each piece or hero where it stopped (`from` as in a capture): `points` for the thief,
   * `lost` by its owner (no more than they had).
   */
  stolen: { seat: Seat; piece: number; from: number; points: number; lost: number; vests: number; king: boolean }[];
  /** The bounty the thief took. */
  bounty?: number;
  /** What the frost froze where it stopped. */
  froze: { seat: Seat; piece: number }[];
  /** What the wizard charmed where it stopped (`from`: the piece's position). */
  charmed: { seat: Seat; piece: number; from: number }[];
  /** Pieces death sent back from the centre for each king it took, and the points it took with each. */
  raised: { seat: Seat; piece: number; points: number; lost: number }[];
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
    /** Pieces a guardian or dragon rider kept from being eaten, eaten itself instead (it's in `eaten`). */
    saved?: HeroSave[];
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

/** A player's heroes picked for the game, before it starts. */
export interface HeroEvent {
  type: 'hero';
  seat: Seat;
  kinds: HeroKind[];
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
    // Everyone picks their heroes first, then hides their magic box, starting with the first player.
    turn: firstTurn !== undefined && order.includes(firstTurn) ? firstTurn : order[0],
    phase: rules.heroes ? 'hero' : rules.magicBoxes ? 'box' : 'roll',
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
    dragonBlast: null,
    heroes: SEATS.map(() => null),
    heroTeams: SEATS.map(() => []),
    heroRest: SEATS.map(() => ({})),
    dragonStats: { points: 0, captures: 0, slain: 0 },
    charmed: [],
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

/** Whether a seat takes turns: still playing, or with every piece home but heroes to play, until the game ends. */
export function takesTurns(state: GameState, seat: Seat): boolean {
  if (!state.ranking.includes(seat)) return true;
  return !!state.rules.heroes && (state.heroTeams?.[seat]?.length ?? 0) > 0;
}

/** Who has charmed this piece, if anyone. */
export function charmedBy(state: GameState, seat: Seat, piece: number): Seat | null {
  return state.charmed?.find((c) => c.seat === seat && c.piece === piece)?.by ?? null;
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
    for (const [j, p] of state.pieces[other].entries()) {
      if (!isOnTrack(p) || charmedBy(state, other, j) !== null) continue;
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
    for (const [j, p] of state.pieces[seat].entries()) {
      if (!isOnTrack(p) || charmedBy(state, seat, j) !== null) continue;
      const key = `${seat}:${trackIndex(seat, p)}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  return [...count].filter(([, n]) => n > 1).map(([k]) => Number(k.split(':')[1]));
}

/** Track squares apart, the shorter way round. */
const apart = (a: number, b: number) => Math.min((a - b + TRACK_LEN) % TRACK_LEN, (b - a + TRACK_LEN) % TRACK_LEN);

/**
 * Whether a piece of `seat` on track square `square` is under its guardian's watch, the guardian not already out
 * (`taken`, keys "seat:piece"): then the guardian goes in its place.
 */
function guarded(state: GameState, seat: Seat, square: number, taken?: Set<string>): boolean {
  const h = state.heroes?.[seat];
  return h?.kind === 'guardian' && h.square >= 0 && apart(h.square, square) <= GUARD_REACH && !taken?.has(`${seat}:${HERO}`);
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
 * capped at the biggest award. A hero is worth HERO_KILL, the guardian GUARDIAN_KILL. The dragon's bombs score
 * for nobody.
 */
function worth(state: GameState, hitter: Seat | null, victim: Seat, victimPiece: number, pos: number, streak = 0) {
  const king = isKing(state, victimPiece);
  if (hitter === null) return { points: 0, revenge: false, king };
  // The leader's bounty comes on top, for whoever knocks out one of their pieces.
  const bounty = state.rules.bounty && state.bounty?.seat === victim && hitter !== victim ? state.bounty.value : 0;
  const extra = bounty ? { bounty } : {};
  if (victimPiece >= HERO) {
    const kill = state.heroes?.[victim]?.kind === 'guardian' ? GUARDIAN_KILL : HERO_KILL;
    return { points: kill + bounty, revenge: false, king: false, ...extra };
  }
  const revenge = state.lastHitBy?.[hitter] === victim;
  const night = state.event?.kind === 'darkNight' ? EVENT_BOOST : 1;
  const times = (revenge ? REVENGE : 1) * (king ? KING : 1) * killStreakBonus(streak) * night;
  const points = Math.min(POINTS.firstHome, Math.round(captureValue(along(victim, pos)) * times) + bounty);
  return { points, revenge, king, ...extra };
}

/**
 * Everyone `seat` knocks out by landing on track square `square`: other players' pieces and heroes (a charmed piece
 * is its charmer's, so its own colour can knock it out and its charmer can't), unless on their own safe square. A
 * guardian watching over pieces there goes in their place, and they go in `saves`. `taken` (keys "seat:piece") are
 * already out, and the mover's kill streak counts on from `streakFrom`. `kingsOnly`: death's way, kings and nothing else.
 */
function knockOutsAt(
  state: GameState,
  seat: Seat,
  square: number,
  taken: Set<string>,
  streakFrom: number,
  atStep: number,
  saves: HeroSave[],
  kingsOnly = false,
): Capture[] {
  const out: Capture[] = [];
  const hit = (other: Seat, piece: number, from: number, sacrifice = false) => {
    taken.add(`${other}:${piece}`);
    const streak = streakFrom + out.length + 1;
    out.push({ seat: other, piece, from, atStep, byFlight: false, streak, ...worth(state, seat, other, piece, from, streak), ...(sacrifice ? { sacrifice } : {}) });
  };
  for (const other of state.active) {
    if (isSafe(state, other, square)) continue;
    const here = state.pieces[other].flatMap((p, j) => {
      if (taken.has(`${other}:${j}`) || !isOnTrack(p) || trackIndex(other, p) !== square) return [];
      if ((charmedBy(state, other, j) ?? other) === seat) return [];
      return kingsOnly && state.rules.kings && !isKing(state, j) ? [] : [j];
    });
    // A guardian watches over its own colour's pieces, not ones under a spell.
    const watched = here.filter((j) => charmedBy(state, other, j) === null);
    const h = state.heroes?.[other];
    if (watched.length && guarded(state, other, square, taken)) {
      for (const j of watched) saves.push({ seat: other, piece: j, square, by: 'guardian' });
      hit(other, HERO, h!.square, true);
      for (const j of here.filter((j) => !watched.includes(j))) hit(other, j, state.pieces[other][j]);
    } else {
      for (const j of here) hit(other, j, state.pieces[other][j]);
    }
    if (other !== seat && !kingsOnly && h && h.square === square && !taken.has(`${other}:${HERO}`)) hit(other, HERO, square);
  }
  return out;
}

/**
 * The pieces and heroes on track squares within reach of a super bomb on `center`: anyone's, the owner's too,
 * unless on their own safe square, the engineer (no bomb hurts it), or in `skip`. A vest saves its wearer.
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
      if (apart(sq, center) > SUPER_BOMB_REACH || isSafe(state, other, sq)) return;
      add(other, j, p);
    });
    const h = state.heroes?.[other];
    if (!h || h.square < 0 || h.kind === 'engineer' || skip.has(`${other}:${HERO}`)) continue;
    if (apart(h.square, center) <= SUPER_BOMB_REACH && !isSafe(state, other, h.square)) add(other, HERO, h.square);
  }
  return out;
}

/** The pieces a super bomb in `seat`'s home column at `pos` takes along: that column's, SUPER_BOMB_REACH either side. */
function blastAroundHome(state: GameState, owner: Seat | null, seat: Seat, pos: number, skip: Set<string>): BlastHit[] {
  const out: BlastHit[] = [];
  state.pieces[seat].forEach((p, j) => {
    if (skip.has(`${seat}:${j}`) || p < HOME_FIRST || p >= GOAL || Math.abs(p - pos) > SUPER_BOMB_REACH) return;
    const saved = vestsOf(state, seat, j) > 0;
    const hit = saved || owner === seat ? { points: 0, revenge: false } : worth(state, owner, seat, j, p);
    out.push({ seat, piece: j, from: p, saved, points: hit.points, revenge: hit.revenge, king: isKing(state, j) });
  });
  return out;
}

/**
 * Works out where a piece would go with this roll, or null if the move is not allowed. Does not change `state`.
 * `openBox` draws what a magic box holds; without it (previews, bots) a box's outcome is left unknown.
 */
export function planMove(state: GameState, seat: Seat, piece: number, dice: number, openBox?: OpenBox): MovePlan | null {
  if (piece >= CHARM) return planCharmMove(state, seat, piece, dice);
  if (piece >= LAUNCH) return planLaunch(state, seat, piece - LAUNCH, dice);
  if (piece >= HERO) return planHeroMove(state, seat, dice, piece === HERO_BACK, openBox);
  const { rules } = state;
  const from = state.pieces[seat][piece];
  // A charmed piece is moved by whoever charmed it.
  if (from === GOAL || state.frozen?.[seat]?.[piece] || charmedBy(state, seat, piece) !== null) return null;

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
    plan.captures.push(...knockOutsAt(state, seat, trackIndex(seat, pos), taken, killsBefore + plan.captures.length, plan.path.length - 1, (plan.heroSaves ??= [])));
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
    // The dragon goes up home columns too, so a piece can meet it there, or one of its bombs.
    if (!isOnTrack(pos)) {
      const square = pos >= HOME_FIRST && pos < GOAL ? homeCell(seat, pos) : -1;
      const bomb = state.bombs.find((b) => b.square === square);
      if (bomb && !plan.bombed) {
        const saved = vests > 0;
        if (saved) vests--;
        const { points, revenge } = saved || bomb.owner === seat ? { points: 0, revenge: false } : worth(state, bomb.owner, seat, piece, pos);
        plan.bombed = { owner: bomb.owner, square, pos, atStep: plan.path.length - 1, saved, points, revenge, king: isKing(state, piece) };
        if (bomb.super) plan.bombed.blast = blastAroundHome(state, bomb.owner, seat, pos, new Set([`${seat}:${piece}`]));
        if (!saved) return 'hangar';
      }
      return slay(pos) ? 'stay' : 'on';
    }
    const square = trackIndex(seat, pos);
    const atStep = plan.path.length - 1;
    const bomb = state.bombs.find((b) => b.square === square);
    if (bomb && !plan.bombed) {
      const saved = vests > 0;
      if (saved) vests--;
      const { points, revenge } = saved || bomb.owner === seat ? { points: 0, revenge: false } : worth(state, bomb.owner, seat, piece, pos);
      plan.bombed = { owner: bomb.owner, square, pos, atStep, saved, points, revenge, king: isKing(state, piece) };
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
      const saved = blast && vests > 0;
      if (saved) vests--;
      const scores = blast && !saved && box.owner !== seat;
      const { points, revenge } = scores ? worth(state, box.owner, seat, piece, pos) : { points: 0, revenge: false };
      plan.box = { owner: box.owner, square, pos, atStep, outcome, saved, points, revenge, king: isKing(state, piece) };
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
  if (!plan.heroSaves?.length) delete plan.heroSaves;
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

/** A hero's move before anything happens on it. */
const heroMove = (kind: HeroKind, back = false): HeroMove => ({ kind, back, hijacked: [], stolen: [], froze: [], charmed: [], raised: [], ends: false });

/** Rounds left before a hero kind that left the board can come on again; 0 when it can. */
export function heroRestLeft(state: GameState, seat: Seat, kind: HeroKind): number {
  const until = state.heroRest?.[seat]?.[kind] ?? 0;
  if (until <= state.turnNo) return 0;
  return Math.ceil((until - state.turnNo) / Math.max(1, state.active.filter((x) => takesTurns(state, x)).length));
}

/**
 * Launching the `i`th hero of the seat's team: with a roll that launches a piece, none of its heroes out, and
 * this one not resting since it last left the board.
 */
function planLaunch(state: GameState, seat: Seat, i: number, dice: number): MovePlan | null {
  const kind = state.heroTeams?.[seat]?.[i];
  if (!state.rules.heroes || !kind || state.heroes?.[seat] || !canLaunch(state.rules, dice)) return null;
  if ((state.heroRest?.[seat]?.[kind] ?? 0) > state.turnNo) return null;
  const hero: HeroMove = { ...heroMove(kind), launch: true };
  return { seat, piece: LAUNCH + i, dice, from: HANGAR, to: HERO_START, path: [{ pos: HERO_START, kind: 'launch' }], captures: [], jumped: false, flew: false, points: 0, hero };
}

/**
 * Where a hero would go with this roll, or null if it can't move. It goes round the track only, as far as the
 * dice says (the archer forward or back) but no further than its life has left, and can't pass another
 * colour's wall. Where it stops it does what its power does: the archer knocks out other colours, death their kings,
 * the thief robs them, the wizard charms them. A bomb there sets it off (the engineer takes it over instead). It takes no colour jump, flight, bridge or power square, and opens no magic box, but the thief, for
 * whom it's always good.
 */
function planHeroMove(state: GameState, seat: Seat, dice: number, back: boolean, openBox?: OpenBox): MovePlan | null {
  const h = state.heroes?.[seat];
  const waiting = h?.square === HERO_START;
  if (!state.rules.heroes || !h || h.frozen > 0 || (back && (h.kind !== 'archer' || waiting))) return null;
  const steps = Math.min(dice, h.left);
  // From the takeoff spot its first step is the player's first track square.
  const from = waiting ? (trackIndex(seat, TRACK_FIRST) - 1 + TRACK_LEN) % TRACK_LEN : h.square;
  const at = (k: number) => (((from + (back ? -k : k)) % TRACK_LEN) + TRACK_LEN) % TRACK_LEN;
  const path: PathStep[] = Array.from({ length: steps }, (_, i) => ({ pos: at(i + 1), kind: 'step' }));
  const walls = wallsAgainst(state, seat);
  if (path.slice(0, -1).some((step) => walls.has(step.pos))) return null;
  const to = at(steps);
  const atStep = steps - 1;
  const move: HeroMove = { ...heroMove(h.kind, back), ends: steps >= h.left };
  const plan: MovePlan = { seat, piece: back ? HERO_BACK : HERO, dice, from: h.square, to, path, captures: [], jumped: false, flew: false, points: 0, hero: move };
  const taken = new Set([`${seat}:${HERO}`]);

  if (h.kind === 'engineer') {
    move.hijacked = state.bombs.filter((b) => b.owner !== seat && b.owner !== null && b.square === to).map((b) => b.square);
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

  // Everyone of another colour where it stops, but what the mover has charmed: pieces (with their positions) and heroes.
  const here: { seat: Seat; piece: number; from: number }[] = [];
  for (const o of state.active) {
    if (o === seat) continue;
    state.pieces[o].forEach((p, j) => {
      if (isOnTrack(p) && trackIndex(o, p) === to && charmedBy(state, o, j) !== seat) here.push({ seat: o, piece: j, from: p });
    });
    if (state.heroes?.[o]?.square === to) here.push({ seat: o, piece: HERO, from: to });
  }

  if (h.kind === 'thief') {
    // It robs each of them of what knocking it out would pay, times THIEF_TIMES; nobody loses more than they have.
    const left = new Map<Seat, number>();
    for (const v of here) {
      if (isSafe(state, v.seat, to)) continue;
      const w = worth(state, seat, v.seat, v.piece, v.from);
      const points = Math.round((w.points - (w.bounty ?? 0)) * THIEF_TIMES);
      const have = left.get(v.seat) ?? Math.max(0, state.stats[v.seat].points);
      const lost = Math.min(points, have);
      left.set(v.seat, have - lost);
      move.stolen.push({ seat: v.seat, piece: v.piece, from: v.from, points, lost, vests: vestsOf(state, v.seat, v.piece), king: w.king });
    }
    if (state.rules.bounty && state.bounty && move.stolen.some((x) => x.seat === state.bounty!.seat)) move.bounty = state.bounty.value;
    const box = state.boxes?.find((b) => b.square === to);
    if (box) plan.box = { owner: box.owner, square: to, pos: to, atStep, outcome: openBox?.(THIEF_BOX), saved: false, points: 0, revenge: false, king: false };
  } else if (h.kind === 'wizard') {
    // Pieces there fall under its spell, but kings.
    for (const v of here) {
      if (v.piece < HERO && !isKing(state, v.piece) && !isSafe(state, v.seat, to)) move.charmed.push(v);
    }
  } else if (h.kind === 'archer' || h.kind === 'death') {
    plan.captures = knockOutsAt(state, seat, to, taken, h.kills, atStep, (plan.heroSaves ??= []), h.kind === 'death');
    if (h.kind === 'death') {
      // Each king it takes brings one of its colour's pieces back from the centre (with kings off, any piece).
      const home = new Map<Seat, number[]>();
      for (const c of plan.captures) {
        if (c.piece >= HERO || !(c.king || !state.rules.kings)) continue;
        const back = home.get(c.seat) ?? state.pieces[c.seat].flatMap((p, j) => (p === GOAL ? [j] : []));
        home.set(c.seat, back);
        const piece = back.pop();
        if (piece === undefined) continue;
        const had = Math.max(0, state.stats[c.seat].points) - move.raised.filter((r) => r.seat === c.seat).reduce((n, r) => n + r.lost, 0);
        move.raised.push({ seat: c.seat, piece, points: POINTS.home, lost: Math.min(POINTS.home, had) });
      }
    }
  }

  if (dragonOn(state, to) && (h.kind === 'rider' || h.kind === 'archer')) {
    // The dragon rider slays it for a king's prize; the archer as a plain piece.
    const rider = h.kind === 'rider';
    plan.dragon = { at: state.dragon!.at, atStep, points: rider ? DRAGON_PRIZE.king : DRAGON_PRIZE.piece, king: false };
  }

  if (h.kind === 'frost') {
    for (const o of state.active) {
      if (o === seat) continue;
      state.pieces[o].forEach((p, j) => {
        if (isOnTrack(p) && apart(trackIndex(o, p), to) <= FROST_REACH && !taken.has(`${o}:${j}`)) move.froze.push({ seat: o, piece: j });
      });
      const oh = state.heroes?.[o];
      if (oh && oh.square >= 0 && apart(oh.square, to) <= FROST_REACH && !taken.has(`${o}:${HERO}`)) move.froze.push({ seat: o, piece: HERO });
    }
  }
  return finishHeroPlan(plan, to, state);
}

function finishHeroPlan(plan: MovePlan, to: number, state: GameState): MovePlan {
  finishPlan(plan, to, state);
  const move = plan.hero!;
  plan.points += move.stolen.reduce((n, x) => n + x.points, 0) + (move.bounty ?? 0) + move.raised.reduce((n, r) => n + r.points, 0);
  return plan;
}

/**
 * A charmed piece moving for the player who charmed it, as its own: round the track as a hero would (no jump,
 * flight, bridge, box or power square), past its own home column, its positions ABSOLUTE ones. It knocks out
 * anyone where it stops but the mover's own (its own colour's too), slays the dragon, and a bomb sends it back to
 * its own hangar.
 */
function planCharmMove(state: GameState, seat: Seat, move: number, dice: number): MovePlan | null {
  const { seat: owner, piece } = charmOf(move);
  if (!state.active.includes(owner) || charmedBy(state, owner, piece) !== seat || state.frozen?.[owner]?.[piece]) return null;
  const from = state.pieces[owner][piece];
  if (!isOnTrack(from)) return null;
  const start = trackIndex(owner, from);
  const path: PathStep[] = Array.from({ length: dice }, (_, i) => ({ pos: ABSOLUTE + ((start + i + 1) % TRACK_LEN), kind: 'step' }));
  const walls = wallsAgainst(state, seat);
  if (path.slice(0, -1).some((step) => walls.has(trackIndex(owner, step.pos)))) return null;
  const to = path[path.length - 1].pos;
  const square = to - ABSOLUTE;
  const atStep = dice - 1;
  const plan: MovePlan = { seat, piece: move, dice, from, to, path, captures: [], jumped: false, flew: false, points: 0, charm: { seat: owner, piece } };
  const taken = new Set([`${owner}:${piece}`]);
  const bomb = state.bombs.find((b) => b.square === square);
  if (bomb) {
    const saved = vestsOf(state, owner, piece) > 0;
    // Nobody scores for blowing up their own piece, or one they'd charmed.
    const scores = !saved && bomb.owner !== null && bomb.owner !== seat && bomb.owner !== owner;
    const { points, revenge } = scores ? worth(state, bomb.owner, owner, piece, to) : { points: 0, revenge: false };
    plan.bombed = { owner: bomb.owner, square, pos: to, atStep, saved, points, revenge, king: false };
    if (bomb.super) plan.bombed.blast = blastAround(state, bomb.owner, square, taken);
    if (!saved) return finishPlan(plan, HANGAR, state);
  }
  plan.captures = knockOutsAt(state, seat, square, taken, 0, atStep, (plan.heroSaves ??= []));
  if (dragonOn(state, square)) {
    const king = !state.rules.kings;
    plan.dragon = { at: state.dragon!.at, atStep, points: king ? DRAGON_PRIZE.king : DRAGON_PRIZE.piece, king };
  }
  return finishPlan(plan, to, state);
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
  // A hero moves instead of a piece (the archer either way), or comes on instead of one; so does a charmed piece.
  for (const j of [HERO, HERO_BACK]) if (planHeroMove(state, seat, dice, j === HERO_BACK)) out.push(j);
  (state.heroTeams?.[seat] ?? []).forEach((_, i) => planLaunch(state, seat, i, dice) && out.push(LAUNCH + i));
  for (const c of state.charmed ?? []) if (c.by === seat && planCharmMove(state, seat, charmMove(c.seat, c.piece), dice)) out.push(charmMove(c.seat, c.piece));
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
  if (s.rules.dragon && !s.dragon && s.turnNo >= (s.dragonAt ?? 0)) {
    const free = freeSquares(s);
    if (free.length) {
      const square = free[rand(free.length)];
      s.dragon = { at: DRAGON_PATH.findIndex((c) => 'square' in c && c.square === square), moved: 0, sixes: 0 };
    } else s.dragonAt = s.turnNo + 1;
  }
  breakCharms(s);
  updateBounty(s);
}

/**
 * Spells end after CHARM_ROUNDS, or when the piece is back in its hangar. A piece let go on the track is its
 * owner's again where it stands, counted on its own route (from its first square if it's past its turn home).
 */
function breakCharms(s: GameState): void {
  s.charmed = (s.charmed ?? []).filter((c) => {
    const pos = s.pieces[c.seat][c.piece];
    if (c.until > s.turnNo && isOnTrack(pos)) return true;
    if (pos >= ABSOLUTE) {
      const own = seatPos(c.seat, pos - ABSOLUTE);
      s.pieces[c.seat][c.piece] = own > TRACK_LAST ? TRACK_FIRST : own;
    }
    return false;
  });
}

/** Takes a piece off the board: a piece back to its hangar (and out of any spell), a hero gone for good. */
function knockOut(s: GameState, seat: Seat, piece: number): void {
  s.stats[seat].lost++;
  if (piece >= HERO) return heroGone(s, seat);
  s.pieces[seat][piece] = HANGAR;
  if (s.frozen) s.frozen[seat][piece] = 0;
  if (s.kills) s.kills[seat][piece] = 0;
  breakCharms(s);
}

/** A hero leaves the board; its player can launch one again, but this one only after it has rested. */
function heroGone(s: GameState, seat: Seat): void {
  const h = s.heroes[seat];
  if (h) (s.heroRest ??= SEATS.map(() => ({})))[seat][h.kind] = holdUntil(s, HERO_REST_ROUNDS);
  s.heroes[seat] = null;
}

/** What the dragon makes for taking a piece or hero: a hero's knock-out value, or a piece's by where it stood (a king's more). */
function dragonWorth(state: GameState, victim: Seat, piece: number, pos: number): number {
  if (piece >= HERO) return state.heroes?.[victim]?.kind === 'guardian' ? GUARDIAN_KILL : HERO_KILL;
  return Math.round(captureValue(along(victim, pos)) * (isKing(state, piece) ? KING : 1));
}

/** The dragon scores for a piece or hero it takes, worked out on `before` (the game before it was taken). */
function creditDragon(s: GameState, before: GameState, v: { seat: Seat; piece: number; from: number }): void {
  const st = (s.dragonStats ??= { points: 0, captures: 0, slain: 0 });
  st.points += dragonWorth(before, v.seat, v.piece, v.from);
  st.captures++;
}

/** Whether the dragon leaves a piece or hero alone: on its own safe square. */
function spared(s: GameState, v: { seat: Seat; piece: number; from: number }): boolean {
  if (v.piece >= HERO) return isSafe(s, v.seat, v.from);
  return isOnTrack(v.from) && isSafe(s, v.seat, trackIndex(v.seat, v.from));
}

/**
 * Of the pieces and heroes the dragon would take, those a hero of their colour saves by going in their place: the
 * dragon rider anywhere on the track, or (not from a blast) a guardian watching over them. Pieces under a spell
 * aren't theirs to save. Returns who's taken, the rider or guardian among them, and who was saved.
 */
function dragonTakes(s: GameState, victims: { seat: Seat; piece: number; from: number }[], blast: boolean) {
  const saved: HeroSave[] = [];
  const out = victims.filter((v) => !spared(s, v));
  for (const seat of new Set(out.map((v) => v.seat))) {
    const h = s.heroes?.[seat];
    if (!h || h.square < 0) continue;
    const covers = (v: { seat: Seat; piece: number; from: number }) => {
      if (v.seat !== seat || v.piece >= HERO || !isOnTrack(v.from) || charmedBy(s, v.seat, v.piece) !== null) return false;
      return h.kind === 'rider' || (h.kind === 'guardian' && !blast && apart(h.square, trackIndex(seat, v.from)) <= GUARD_REACH);
    };
    const kept = out.filter(covers);
    if (!kept.length) continue;
    for (const v of kept) {
      saved.push({ seat, piece: v.piece, square: trackIndex(seat, v.from), by: h.kind === 'rider' ? 'rider' : 'guardian' });
      out.splice(out.indexOf(v), 1);
    }
    if (!out.some((v) => v.seat === seat && v.piece >= HERO)) out.push({ seat, piece: HERO, from: h.square });
  }
  return { taken: out, saved };
}

/**
 * The dragon's lap is done: it explodes, and every piece where it is or DRAGON_BLAST_REACH squares either side
 * (home columns too) goes back to the hangar, unless on its own safe square, saved by a vest, or by its dragon rider.
 */
function dragonExplodes(s: GameState): void {
  const at = s.dragon!.at;
  const hit: BlastVictim[] = [];
  const { taken, saved } = dragonTakes(s, cellsAround(DRAGON_PATH[at], DRAGON_BLAST_REACH).flatMap((cell) => piecesOn(s, cell)), true);
  for (const v of taken) {
    // A rider going in its pieces' place doesn't hide behind a vest.
    const vest = vestsOf(s, v.seat, v.piece) > 0 && !(v.piece >= HERO && saved.some((x) => x.seat === v.seat));
    hit.push({ ...v, saved: vest });
    if (vest) useVest(s, v.seat, v.piece);
    else {
      creditDragon(s, s, v);
      knockOut(s, v.seat, v.piece);
    }
  }
  s.dragonBlast = { n: (s.dragonBlast?.n ?? 0) + 1, at, hit, ...(saved.length ? { saved } : {}) };
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
  if (kind === 'earthquake') shake(s, rand);
}

/** The earthquake: every bomb, super bomb and magic box jumps to a free square, never one another has just taken. */
function shake(s: GameState, rand: Rand): void {
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
  // Nobody's sad for a player with every piece home, waiting to launch a hero.
  if (s.pieces[seat].some((p) => p !== HANGAR && p !== GOAL) || s.heroes?.[seat] || s.ranking.includes(seat)) {
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
 * piece and hero where it stops, unless spared, or a guardian or rider goes instead. A second six in a row leaves a bomb where it stops, a third a
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
  const { taken: eaten, saved } = dragonTakes(s, piecesOn(s, DRAGON_PATH[to]), false);
  for (const v of eaten) {
    creditDragon(s, s, v);
    knockOut(s, v.seat, v.piece);
  }
  event.dragon.eaten = eaten;
  if (saved.length) event.dragon.saved = saved;
  const cell = DRAGON_PATH[to];
  d.sixes = dice === 6 ? (d.sixes ?? 0) + 1 : 0;
  // In a home column, on a cell with no piece left on it and no bomb.
  const square =
    'square' in cell
      ? freeSquares(s).includes(cell.square)
        ? cell.square
        : null
      : !s.pieces[cell.seat].includes(cell.pos) && !s.bombs.some((b) => b.square === homeCell(cell.seat, cell.pos))
        ? homeCell(cell.seat, cell.pos)
        : null;
  if (d.sixes >= 2 && square !== null) {
    const big = d.sixes >= 3;
    s.bombs.push({ square, owner: null, ...(big ? { super: true } : {}) });
    event.dragon.bomb = square;
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
        if (from === GOAL || from === HANGAR || charmedBy(s, seat, j) !== null) continue;
        s.pieces[seat][j] = HANGAR;
        if (s.frozen) s.frozen[seat][j] = 0;
        if (s.kills) s.kills[seat][j] = 0;
        event.penalized.push({ piece: j, from });
      }
      event.outcome = 'penalty';
      breakCharms(s);
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
  // A hero comes on with its whole life, keeps its square and counts its life down; a bomb that gets it takes it
  // off the board (below). A charmed piece moves along its own colour's track.
  if (plan.hero?.launch) s.heroes[seat] = { kind: plan.hero.kind, square: HERO_START, left: HERO_LIFE, kills: 0, vests: 0, frozen: 0 };
  const hero = plan.hero ? s.heroes[seat]! : null;
  // Whose piece it is that moves: the mover's, or one it has charmed.
  const [ps, pp] = plan.charm ? [plan.charm.seat, plan.charm.piece] : [seat, piece];
  if (hero) {
    if (!plan.hero!.launch) {
      if (plan.to !== HANGAR) hero.square = plan.to;
      hero.left -= plan.path.length;
      hero.kills += plan.captures.length;
    }
  } else if (plan.charm) {
    s.pieces[ps][pp] = plan.to;
  } else {
    s.pieces[seat][piece] = plan.to;
    s.kills[seat][piece] = plan.to === HANGAR ? 0 : s.kills[seat][piece] + plan.captures.length;
  }
  for (const c of plan.captures) knockOut(s, c.seat, c.piece);
  if (plan.bridge) s.bridges = s.bridges.filter((b) => b.square !== plan.bridge!.square);
  if (plan.dragon) {
    // Whoever slays it, a king too, another comes later.
    s.dragon = null;
    (s.dragonStats ??= { points: 0, captures: 0, slain: 0 }).slain++;
    s.dragonAt = s.turnNo + roundsOf(s, DRAGON_EVERY_ROUNDS);
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
    const { owner, square, points, saved } = plan.bombed;
    s.bombs = s.bombs.filter((b) => b.square !== square);
    // The dragon's bomb: what it takes scores for the dragon.
    if (owner === null) {
      if (!saved) creditDragon(s, state, { seat: ps, piece: hero ? HERO : pp, from: plan.bombed.pos });
      for (const v of plan.bombed.blast ?? []) if (!v.saved) creditDragon(s, state, v);
    }
    if (saved) {
      useVest(s, ps, pp);
    } else {
      s.stats[ps].lost++;
      if (hero) heroGone(s, seat);
      if (owner !== null && owner !== ps && owner !== seat) {
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
    const { owner, square, points, saved, outcome } = plan.box;
    s.boxes = s.boxes.filter((b) => b.square !== square);
    if (outcome === 'freeze') s.frozen[seat][piece] = FROZEN_TURNS;
    if (outcome === 'bomb' && saved) useVest(s, seat, piece);
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
  breakCharms(s);
  if (plan.to === GOAL && !hero) s.stats[seat].home++;
  if (dice === 6 && piece < HERO) s.streakMoved.push(piece);

  // Revenge settles a score; each new knock-out opens one.
  s.lastHitBy ??= SEATS.map(() => null);
  for (const c of plan.captures) {
    if (c.seat === seat) continue;
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

  // A hero's life is over: it's gone, but for the engineer, whose player puts down its super bomb first.
  if (hero && plan.hero!.ends && s.heroes[seat]) {
    if (hero.kind === 'engineer') {
      s.heroEnding = seat;
      if (!freeSquares(s).length) engineerExplodes(s);
    } else heroGone(s, seat);
  }

  const event: MoveEvent = { ...plan, type: 'move', extraRoll: false, seatFinished: false, bonus: 0, gameOver: false };

  if (piece < HERO && seatFinished(s, seat)) {
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

/**
 * What a hero's move does besides moving and knocking out: bombs taken over, points and vests stolen, pieces
 * frozen or charmed, pieces sent back from the centre.
 */
function heroDoes(s: GameState, plan: MovePlan, hero: Hero | null): void {
  const move = plan.hero!;
  for (const b of s.bombs) if (move.hijacked.includes(b.square)) b.owner = plan.seat;
  for (const x of move.stolen) {
    s.stats[x.seat].points -= x.lost;
    if (x.piece < HERO) s.vested[x.seat][x.piece] = 0;
    else if (s.heroes[x.seat]) s.heroes[x.seat]!.vests = 0;
    if (hero) hero.vests += x.vests;
  }
  if (move.bounty && s.bounty) s.bounty.value = BOUNTY.start;
  for (const f of move.froze) {
    if (f.piece < HERO) s.frozen[f.seat][f.piece] = Math.max(s.frozen[f.seat][f.piece], FROST_TURNS);
    else if (s.heroes[f.seat]) s.heroes[f.seat]!.frozen = Math.max(s.heroes[f.seat]!.frozen, FROST_TURNS);
  }
  if (move.charmed.length) {
    const until = holdUntil(s, CHARM_ROUNDS);
    s.charmed = (s.charmed ?? []).filter((c) => !move.charmed.some((v) => v.seat === c.seat && v.piece === c.piece));
    for (const v of move.charmed) {
      s.charmed.push({ seat: v.seat, piece: v.piece, by: plan.seat, until });
      s.pieces[v.seat][v.piece] = ABSOLUTE + trackIndex(v.seat, v.from);
    }
  }
  for (const r of move.raised) {
    s.pieces[r.seat][r.piece] = HANGAR;
    s.stats[r.seat].home = Math.max(0, s.stats[r.seat].home - 1);
    s.stats[r.seat].points -= r.lost;
  }
}

/**
 * The engineer's life is over: it goes off where it stands, taking opponents' pieces and heroes on its square and
 * DRAGON_BLAST_REACH squares either side (vests and safe squares save them; other engineers don't mind), each
 * scored as a knock-out for its player. Its own side is safe: its player's pieces, and those it has charmed; a
 * piece of its colour another has charmed is theirs for now.
 */
function engineerExplodes(s: GameState): void {
  const seat = s.heroEnding!;
  s.heroEnding = null;
  const h = s.heroes[seat];
  if (!h) return;
  const hit: BlastVictim[] = [];
  for (const other of s.active) {
    s.pieces[other].forEach((p, j) => {
      if ((charmedBy(s, other, j) ?? other) === seat || !isOnTrack(p)) return;
      const sq = trackIndex(other, p);
      if (apart(sq, h.square) <= DRAGON_BLAST_REACH && !isSafe(s, other, sq)) hit.push({ seat: other, piece: j, from: p, saved: false });
    });
    if (other === seat) continue;
    const theirs = s.heroes[other];
    if (theirs && theirs.square >= 0 && theirs.kind !== 'engineer' && apart(theirs.square, h.square) <= DRAGON_BLAST_REACH && !isSafe(s, other, theirs.square)) {
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

/**
 * Picks the current player's HERO_TEAM heroes for the game. Players pick in turn from the first, before the
 * magic boxes go down; then the first player hides theirs, or rolls.
 */
export function applyHero(state: GameState, kinds: readonly HeroKind[]): { state: GameState; event: HeroEvent } {
  if (state.phase !== 'hero') throw new RuleError('Not time to pick heroes');
  const team = [...new Set(kinds)];
  if (team.length !== HERO_TEAM || kinds.length !== HERO_TEAM || !team.every((k) => HERO_KINDS.includes(k))) {
    throw new RuleError(`Pick ${HERO_TEAM} different heroes`);
  }
  const s = structuredClone(state);
  s.seq++;
  const seat = s.turn;
  s.heroTeams[seat] = team;
  // In turn order from the first player, so the seat after the last one to pick is the first player again.
  s.turn = s.active[(s.active.indexOf(seat) + 1) % s.active.length];
  if (s.active.every((x) => s.heroTeams[x].length)) s.phase = s.rules.magicBoxes ? 'box' : 'roll';
  return { state: s, event: { type: 'hero', seat, kinds: team } };
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
  return state.pieces[state.turn].flatMap((p, j) => (p === GOAL || charmedBy(state, state.turn, j) !== null ? [] : [j]));
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
  return state.pieces[seat].reduce((sum, p) => sum + (p === HANGAR ? 0 : along(seat, p) + 1), 0);
}

