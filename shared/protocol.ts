import type { BotLevel } from './ai.ts';
import type { Seat } from './board.ts';
import type { ShownReaction } from './reactions.ts';
import type { GameEvent, GameState, Rules } from './rules.ts';

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

export interface PublicUser {
  id: number;
  username: string;
  gamesPlayed: number;
  wins: number;
  /** Points from every finished game. */
  points: number;
  /** Can see every account and set their passwords (see /admin). */
  isAdmin: boolean;
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
  /** Host only: stop or restart the game clock. */
  'game:pause': (req: { code: string; paused: boolean }, ack: Ack<null>) => void;
}

export interface ServerToClient {
  'room:update': (update: RoomUpdate) => void;
  'room:closed': (info: { code: string; reason: string }) => void;
  'lobby:changed': () => void;
  /** Your one-time code was used: `by` seated you in their game. */
  'account:paired': (info: { by: string; game: string; code: string }) => void;
}
