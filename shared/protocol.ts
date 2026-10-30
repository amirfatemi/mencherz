import type { BotLevel } from './ai.ts';
import type { Award } from './awards.ts';
import type { Seat } from './board.ts';
import type { ShownReaction } from './reactions.ts';
import type { GameEvent, GameState, HeroKind, PowerChoice, Rules } from './rules.ts';

export type SeatKind = 'open' | 'closed' | 'human' | 'bot';

export interface SeatView {
  kind: SeatKind;
  userId?: number;
  name?: string;
  botLevel?: BotLevel;
  online?: boolean;
  /** A human who left mid-game; a bot plays for them. */
  left?: boolean;
  /** Set for a player sitting at someone else's device: that user plays this seat for them. */
  controllerId?: number;
  controllerName?: string;
}

/** People who sat down to play: seats with an account, including any who left mid-game. */
export function peopleIn(seats: SeatView[]): number {
  return seats.filter((s) => s.userId !== undefined).length;
}

export interface RoomSettings {
  name: string;
  isPublic: boolean;
  /** Seconds a human has to act before the move is made for them. 0 = no limit. */
  turnSeconds: number;
  /** Show players' reaction GIFs over their hangar after big moments. */
  gifs: boolean;
  /** Cinematic moments: a shaking board for a super bomb, slow motion and a banner for the big knock-outs. */
  cinematic: boolean;
  rules: Rules;
}

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface RoomView {
  code: string;
  hostId: number;
  status: RoomStatus;
  settings: RoomSettings;
  seats: SeatView[];
  game: GameState | null;
  /** Epoch ms when the current human turn times out, if a timer applies. */
  turnDeadline: number | null;
  serverNow: number;
  events: GameEvent[];
  spectators: number;
  /** The host has paused the game: no turns, no timers. */
  paused: boolean;
  /** Time played so far, pauses left out, as of serverNow. */
  playedMs: number;
  /** Whether playedMs is still counting up. */
  clockRunning: boolean;
}

export interface RoomUpdate {
  room: RoomView;
  event?: GameEvent;
  /** Reaction GIFs the event sets off. */
  reactions?: ShownReaction[];
}

export interface RoomSummary {
  code: string;
  name: string;
  hostName: string;
  status: RoomStatus;
  players: number;
  capacity: number;
  isPublic: boolean;
  mine: boolean;
  yourTurn: boolean;
  paused: boolean;
  updatedAt: number;
}

export interface LobbyData {
  open: RoomSummary[];
  mine: RoomSummary[];
}

export type SeatSetup = { kind: 'open' | 'closed' } | { kind: 'bot'; botLevel: BotLevel } | { kind: 'host' };

export interface CreateRoomRequest {
  settings: RoomSettings;
  seats: SeatSetup[];
  startNow?: boolean;
}

export type SeatAction =
  | { action: 'take' }
  | { action: 'open' }
  | { action: 'close' }
  | { action: 'bot'; botLevel: BotLevel };

/**
 * A new account waits for an admin to approve it before it can create or join games; an admin can also
 * disable an account, which then can't either.
 */
export type AccountStatus = 'pending' | 'active' | 'disabled';

export interface PublicUser {
  id: number;
  username: string;
  status: AccountStatus;
  gamesPlayed: number;
  wins: number;
  /** Points from every finished game. */
  points: number;
  /** Can see every account and set their passwords (see /admin). */
  isAdmin: boolean;
  /** Medal id → times won, over the games that count. */
  medals: Record<string, number>;
}

/** A "what is a + b?" check on the sign-in and sign-up forms. */
export interface Captcha {
  id: string;
  question: string;
}

/** An account as the admin page lists it. */
export interface AdminUserRow {
  id: number;
  username: string;
  status: AccountStatus;
  createdAt: number;
  gamesPlayed: number;
  wins: number;
  points: number;
  isAdmin: boolean;
}

export interface LeaderRow {
  username: string;
  points: number;
  gamesPlayed: number;
  wins: number;
  /** Opponent pieces knocked out, over all counted games. */
  captures: number;
  /** Own pieces knocked out, over all counted games. */
  lost: number;
  /** Minutes played, over all counted games. */
  minutes: number;
  /** Medal id → times won. */
  medals: Record<string, number>;
}

/** What the leaderboard can be ordered by. */
export const LEADER_SORTS = ['points', 'average', 'wins', 'games', 'captures', 'lost', 'minutes'] as const;
export type LeaderSort = (typeof LEADER_SORTS)[number];

/** A player in a finished game, for the game history. */
export interface GameRecordPlayer {
  seat: Seat;
  name: string;
  kind: 'human' | 'bot';
  botLevel?: BotLevel;
  /** Left during the game: a computer played on for them. */
  left: boolean;
  /** Final place, from 1; null when the game was stopped because everyone left. */
  place: number | null;
  points: number;
  home: number;
  captures: number;
  lost: number;
  /** Medal ids won this game (games that count only). */
  medals: string[];
}

/** A finished game, as the game history shows it: everything its end-of-game report had. */
export interface GameRecord {
  code: string;
  name: string;
  hostName: string;
  startedAt: number;
  finishedAt: number;
  /** Time played, pauses left out. */
  playedMs: number;
  /** Counted on the leaderboard: two people or more. */
  ranked: boolean;
  /** Everyone left before the end, so there are no places. */
  stopped: boolean;
  winBy: 'points' | 'race';
  /** In final order. */
  players: GameRecordPlayer[];
  awards: Award[];
}

/** A page of the game history, newest first; `next` asks for the page after it. */
export interface HistoryPage {
  games: GameRecord[];
  next: number | null;
}

export interface PairCode {
  code: string;
  expiresAt: number;
}

export type Ack<T = unknown> = (res: { ok: true; data: T } | { ok: false; error: string }) => void;

export interface ClientToServer {
  'lobby:list': (ack: Ack<LobbyData>) => void;
  'room:create': (req: CreateRoomRequest, ack: Ack<{ code: string }>) => void;
  'room:join': (req: { code: string }, ack: Ack<RoomView>) => void;
  'room:unwatch': (req: { code: string }) => void;
  'room:leave': (req: { code: string }, ack: Ack<null>) => void;
  'room:seat': (req: { code: string; seat: Seat } & SeatAction, ack: Ack<null>) => void;
  'room:settings': (req: { code: string; settings: RoomSettings }, ack: Ack<null>) => void;
  'room:start': (req: { code: string }, ack: Ack<null>) => void;
  /** Seats a registered player at the caller's device, proven by the one-time code from their settings. */
  'room:addLocal': (req: { code: string; seat: Seat; username: string; pairCode: string }, ack: Ack<null>) => void;
  'game:roll': (req: { code: string }, ack: Ack<null>) => void;
  'game:move': (req: { code: string; piece: number }, ack: Ack<null>) => void;
  /** After three sixes: drop a bomb on this absolute track square. */
  'game:bomb': (req: { code: string; square: number }, ack: Ack<null>) => void;
  /** Before the first roll: hide your magic box on this absolute track square. */
  'game:box': (req: { code: string; square: number }, ack: Ack<null>) => void;
  /** On a power square: pick a power. An ambush names whose home column it opens (`over`). */
  'game:power': (req: { code: string; choice: PowerChoice; over?: Seat }, ack: Ack<null>) => void;
  /** Pick a hero, when the turn starts with one to pick. */
  'game:hero': (req: { code: string; kind: HeroKind }, ack: Ack<null>) => void;
  /** Put the vest from a magic box on this piece. */
  'game:vest': (req: { code: string; piece: number }, ack: Ack<null>) => void;
  /** Put the bridge, box or safe square picked on a power square on this absolute track square. */
  'game:place': (req: { code: string; square: number }, ack: Ack<null>) => void;
  /** Host only: stop or restart the game clock. */
  'game:pause': (req: { code: string; paused: boolean }, ack: Ack<null>) => void;
}

export interface ServerToClient {
  'room:update': (update: RoomUpdate) => void;
  'room:closed': (info: { code: string; reason: string }) => void;
  'lobby:changed': () => void;
  /** Your one-time code was used: `by` seated you in their game. */
  'account:paired': (info: { by: string; game: string; code: string }) => void;
  /** An admin approved or disabled your account. */
  'account:status': (info: { status: AccountStatus }) => void;
}
