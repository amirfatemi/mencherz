import { randomInt } from 'node:crypto';
import { chooseBomb, chooseBox, chooseMove, type BotLevel } from '../shared/ai.ts';
import type { Seat } from '../shared/board.ts';
import {
  peopleIn,
  type Ack,
  type ClientToServer,
  type LobbyData,
  type PublicUser,
  type RoomSettings,
  type RoomStatus,
  type RoomSummary,
  type RoomView,
  type SeatView,
  type ServerToClient,
} from '../shared/protocol.ts';
import { rollWeighted, rollWeights } from '../shared/dice.ts';
import {
  applyBomb,
  applyBox,
  applyMove,
  applyRoll,
  createGame,
  RuleError,
  type GameEvent,
  type GameState,
} from '../shared/rules.ts';
import { reactionsFor, type ShownReaction } from '../shared/reactions.ts';
import { RANKED_MIN_PEOPLE } from '../shared/scoring.ts';
import { eventDuration } from '../shared/timing.ts';
import { limiter, unref, type Auth } from './auth.ts';
import type { Hub, HubSocket } from './hub.ts';
import type { Db } from './db.ts';
import { upgradeGame } from './migrate.ts';
import {
  InputError,
  parseBotLevel,
  parseCode,
  parsePairCode,
  parseSeats,
  parseSettings,
  parseUsername,
} from './validate.ts';

export type IO = Hub<ClientToServer, ServerToClient, SocketData>;
type ClientSocket = HubSocket<ClientToServer, ServerToClient, SocketData>;

export interface SocketData {
  user: PublicUser;
  watching: Set<string>;
}

interface Room {
  code: string;
  hostId: number;
  status: RoomStatus;
  settings: RoomSettings;
  seats: SeatView[];
  game: GameState | null;
  events: GameEvent[];
  statsRecorded: boolean;
  paused: boolean;
  createdAt: number;
  updatedAt: number;
  // Runtime only.
  watchers: Map<string, number>;
  timer: ReturnType<typeof setTimeout> | null;
  turnDeadline: number | null;
  busyUntil: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_EVENTS = 60;
const BOT_THINK_MS = { roll: 650, move: 550, bomb: 1100, box: 700 };
const OFFLINE_GRACE_MS = 6000;
const KEEP_FINISHED_MS = 6 * 3600 * 1000;
const EXPIRE_WAITING_MS = 48 * 3600 * 1000;
const MAX_WAITING_PER_HOST = 5;

const occupied = (s: SeatView) => s.kind === 'human' || s.kind === 'bot';
/** Whether this user plays the seat: it's theirs, or it's a player sitting at their device. */
const playsFor = (s: SeatView | undefined, userId: number) =>
  s?.kind === 'human' && !s.left && (s.userId === userId || s.controllerId === userId);

function parseSeat(v: unknown): Seat {
  const seat = Number(v);
  if (!Number.isInteger(seat) || seat < 0 || seat > 3) throw new InputError('Invalid seat');
  return seat as Seat;
}

export function createRooms(io: IO, db: Db, auth: Auth, opts: { timeScale: number }) {
  const rooms = new Map<string, Room>();
  const scaled = (ms: number) => Math.round(ms * opts.timeScale);
  const allowPairing = limiter(15, 10 * 60 * 1000);

  const q = {
    save: db.prepare(`
      INSERT INTO games (code, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at
    `),
    remove: db.prepare('DELETE FROM games WHERE code = ?'),
    load: db.prepare("SELECT * FROM games WHERE status != 'finished' OR updated_at > ?"),
  };

  // ---------- persistence ----------

  function save(room: Room) {
    const data = {
      hostId: room.hostId,
      settings: room.settings,
      seats: room.seats.map(({ online: _online, ...s }) => s),
      game: room.game,
      events: room.events,
      statsRecorded: room.statsRecorded,
      paused: room.paused,
    };
    q.save.run(room.code, room.status, JSON.stringify(data), room.createdAt, room.updatedAt);
  }

  function load() {
    const rows = q.load.all(Date.now() - KEEP_FINISHED_MS) as {
      code: string;
      status: RoomStatus;
      data: string;
      created_at: number;
      updated_at: number;
    }[];
    for (const row of rows) {
      try {
        const d = JSON.parse(row.data);
        const room: Room = {
          code: row.code,
          status: row.status,
          hostId: d.hostId,
          settings: parseSettings(d.settings, 'Game'),
          seats: d.seats,
          game: d.game ? upgradeGame(d.game) : null,
          events: d.events ?? [],
          statsRecorded: !!d.statsRecorded,
          paused: !!d.paused,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          watchers: new Map(),
          timer: null,
          turnDeadline: null,
          busyUntil: 0,
        };
        rooms.set(room.code, room);
        schedule(room);
      } catch (err) {
        console.error(`Skipping unreadable game ${row.code}:`, err);
      }
    }
    if (rows.length) console.log(`Restored ${rooms.size} game(s)`);
  }

  // ---------- views ----------

  const isOnline = (room: Room, userId: number | undefined) =>
    userId !== undefined && [...room.watchers.values()].includes(userId);
  /** A seat is here when its player is, or the device it's played from. */
  const seatOnline = (room: Room, s: SeatView) => isOnline(room, s.userId) || isOnline(room, s.controllerId);
  const involved = (room: Room, userId: number) => room.seats.some((s) => playsFor(s, userId));

  function view(room: Room): RoomView {
    const seatedUsers = new Set(room.seats.filter((s) => s.kind === 'human').flatMap((s) => [s.userId, s.controllerId]));
    const spectators = new Set([...room.watchers.values()].filter((id) => !seatedUsers.has(id))).size;
    return {
      code: room.code,
      hostId: room.hostId,
      status: room.status,
      settings: room.settings,
      seats: room.seats.map((s) => (s.userId !== undefined ? { ...s, online: seatOnline(room, s) } : { ...s })),
      game: room.game,
      turnDeadline: room.turnDeadline,
      serverNow: Date.now(),
      events: room.events.slice(-30),
      spectators,
      paused: room.paused,
    };
  }

  function summary(room: Room, userId: number): RoomSummary {
    const host = room.seats.find((s) => s.userId === room.hostId);
    const turnSeat = room.game ? room.seats[room.game.turn] : undefined;
    return {
      code: room.code,
      name: room.settings.name,
      hostName: host?.name ?? '—',
      status: room.status,
      players: room.seats.filter(occupied).length,
      capacity: room.seats.filter((s) => s.kind !== 'closed').length,
      isPublic: room.settings.isPublic,
      mine: involved(room, userId),
      yourTurn: room.status === 'playing' && !room.paused && playsFor(turnSeat, userId),
      paused: room.paused,
      updatedAt: room.updatedAt,
    };
  }

  function lobbyFor(userId: number): LobbyData {
    const all = [...rooms.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      open: all
        .filter((r) => r.settings.isPublic && r.status !== 'finished' && !involved(r, userId))
        .filter((r) => r.status === 'playing' || r.seats.some((s) => s.kind === 'open'))
        .slice(0, 50)
        .map((r) => summary(r, userId)),
      mine: all
        .filter((r) => involved(r, userId))
        .slice(0, 20)
        .map((r) => summary(r, userId)),
    };
  }

  let lobbyTimer: ReturnType<typeof setTimeout> | null = null;
  function lobbyChanged() {
    if (lobbyTimer) return;
    lobbyTimer = setTimeout(() => {
      lobbyTimer = null;
      io.to('lobby').emit('lobby:changed');
    }, 800);
  }

  function broadcast(room: Room, event?: GameEvent, reactions?: ShownReaction[]) {
    io.to(`room:${room.code}`).emit('room:update', { room: view(room), event, reactions });
  }

  // ---------- helpers ----------

  function seatOf(room: Room, userId: number): number {
    return room.seats.findIndex((s) => s.kind === 'human' && s.userId === userId && !s.left);
  }

  function getRoom(code: unknown): Room {
    const room = rooms.get(parseCode(code));
    if (!room) throw new InputError('Game not found');
    return room;
  }

  function requireHost(room: Room, user: PublicUser) {
    if (room.hostId !== user.id) throw new InputError('Only the host can do that');
  }

  function requireWaiting(room: Room) {
    if (room.status !== 'waiting') throw new InputError('The game has already started');
  }

  function newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < 5; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
  }

  function touch(room: Room) {
    room.updatedAt = Date.now();
    save(room);
    broadcast(room);
    lobbyChanged();
  }

  function closeRoom(room: Room, reason: string) {
    if (room.timer) clearTimeout(room.timer);
    rooms.delete(room.code);
    q.remove.run(room.code);
    io.to(`room:${room.code}`).emit('room:closed', { code: room.code, reason });
    io.in(`room:${room.code}`).socketsLeave(`room:${room.code}`);
    lobbyChanged();
  }

  // ---------- game flow ----------

  function startGame(room: Room) {
    const active = room.seats.flatMap((s, i) => (occupied(s) ? [i as Seat] : []));
    if (active.length < 2) throw new InputError('At least two players are needed to start');
    room.seats = room.seats.map((s) => (s.kind === 'open' ? { kind: 'closed' } : s));
    room.game = createGame(active, room.settings.rules, active[randomInt(active.length)]);
    room.status = 'playing';
    room.events = [];
    room.busyUntil = Date.now() + scaled(600);
    room.updatedAt = Date.now();
    save(room);
    schedule(room);
    broadcast(room);
    lobbyChanged();
  }

  function commit(room: Room, result: { state: GameState; event: GameEvent }) {
    const prevTurn = room.game?.turn;
    room.game = result.state;
    room.events.push(result.event);
    if (room.events.length > MAX_EVENTS) room.events.splice(0, room.events.length - MAX_EVENTS);
    room.busyUntil = Date.now() + scaled(eventDuration(result.event));
    room.updatedAt = Date.now();
    if (result.state.phase === 'over') finish(room);
    save(room);
    schedule(room);
    broadcast(room, result.event, reactionsOf(room, result.event));
    if (room.status !== 'playing' || prevTurn !== result.state.turn) lobbyChanged();
  }

  function reactionsOf(room: Room, event: GameEvent): ShownReaction[] | undefined {
    if (!room.settings.gifs) return undefined;
    const list = reactionsFor(event, (n) => randomInt(n));
    return list.length ? list : undefined;
  }

  function finish(room: Room) {
    room.status = 'finished';
    if (room.statsRecorded || !room.game) return;
    room.statsRecorded = true;
    if (peopleIn(room.seats) < RANKED_MIN_PEOPLE) return;
    const winner = room.game.standings[0] ?? room.game.ranking[0];
    room.seats.forEach((s, i) => {
      if (s.kind === 'human' && s.userId !== undefined && !s.left) {
        auth.recordGame(s.userId, i === winner, room.game!.stats[i]?.points ?? 0);
      }
    });
  }

  function roll(room: Room) {
    const g = room.game!;
    commit(room, applyRoll(g, rollWeighted(rollWeights(g), (n) => randomInt(n))));
  }

  function move(room: Room, piece: number) {
    commit(room, applyMove(room.game!, piece, (n) => randomInt(n)));
  }

  function autoAct(room: Room, level: BotLevel) {
    const g = room.game;
    if (!g || room.status !== 'playing') return;
    try {
      if (g.phase === 'roll') roll(room);
      else if (g.phase === 'move') move(room, chooseMove(g, level));
      else if (g.phase === 'bomb') commit(room, applyBomb(g, chooseBomb(g, level)));
      else if (g.phase === 'box') commit(room, applyBox(g, chooseBox(g, level)));
    } catch (err) {
      console.error(`Auto move failed in ${room.code}:`, err);
    }
  }

  /** Arms the timer for whoever acts next: bots, absent players and the turn clock. */
  function schedule(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.turnDeadline = null;
    const g = room.game;
    if (room.status !== 'playing' || !g || g.phase === 'over' || room.paused) return;

    // Nobody here: the game stays saved and waits instead of playing itself out.
    if (!room.seats.some((s) => s.kind === 'human' && !s.left && seatOnline(room, s))) return;

    const seat = room.seats[g.turn];
    const now = Date.now();
    const wait = Math.max(0, room.busyUntil - now) / (opts.timeScale || 1);
    const later = (ms: number, level: BotLevel) => {
      room.timer = setTimeout(() => {
        room.timer = null;
        autoAct(room, level);
      }, scaled(ms));
    };

    if (seat.kind === 'bot') return later(wait + BOT_THINK_MS[g.phase], seat.botLevel ?? 'normal');
    // People make every move themselves, even when only one is possible.

    let limit = room.settings.turnSeconds * 1000;
    if (!seatOnline(room, seat)) limit = limit ? Math.min(limit, OFFLINE_GRACE_MS) : OFFLINE_GRACE_MS;
    if (!limit) return;
    room.turnDeadline = now + scaled(wait + limit);
    later(wait + limit, 'normal');
  }

  function requireTurn(room: Room, user: PublicUser) {
    if (room.status !== 'playing' || !room.game) throw new InputError('The game is not running');
    if (room.paused) throw new InputError('The game is paused');
    if (!playsFor(room.seats[room.game.turn], user.id)) throw new InputError("It's not your turn");
  }

  // ---------- leaving ----------

  function leave(room: Room, user: PublicUser) {
    const idx = seatOf(room, user.id);
    // Players sitting at this user's device can't play on without it.
    const local = room.seats.flatMap((s, i) => (i !== idx && playsFor(s, user.id) ? [i] : []));
    const gone = idx === -1 ? local : [idx, ...local];
    if (!gone.length) return;

    if (room.status === 'waiting') {
      for (const i of gone) room.seats[i] = { kind: 'open' };
      if (room.hostId === user.id) {
        const humans = room.seats.filter((s) => s.kind === 'human' && s.userId !== undefined);
        const next = humans.find((s) => s.controllerId === undefined) ?? humans[0];
        if (!next) return closeRoom(room, 'The host left');
        room.hostId = next.userId!;
      }
      return touch(room);
    }

    if (room.status === 'playing') {
      for (const i of gone) room.seats[i] = { ...room.seats[i], kind: 'bot', botLevel: 'normal', left: true };
      // Nobody else can resume a game the host paused.
      if (room.hostId === user.id) room.paused = false;
      const humansLeft = room.seats.some((s) => s.kind === 'human' && !s.left);
      if (!humansLeft) {
        room.status = 'finished';
        if (room.game) room.game = { ...room.game, phase: 'over' };
      }
      schedule(room);
      touch(room);
    }
  }

  // ---------- sockets ----------

  /** Wraps a socket handler so thrown input/rule errors go back through the ack. Payloads are untrusted. */
  function handler<R, T>(fn: (req: Partial<R> | undefined) => T) {
    return (req: R, ack: Ack<T>) => {
      const reply: Ack<T> = typeof ack === 'function' ? ack : () => {};
      try {
        reply({ ok: true, data: fn(req as Partial<R> | undefined) });
      } catch (err) {
        if (err instanceof InputError || err instanceof RuleError) {
          reply({ ok: false, error: err.message });
        } else {
          console.error(err);
          reply({ ok: false, error: 'Something went wrong' });
        }
      }
    };
  }

  function watch(socket: ClientSocket, room: Room) {
    const wasOnline = isOnline(room, socket.data.user.id);
    room.watchers.set(socket.id, socket.data.user.id);
    socket.data.watching.add(room.code);
    socket.join(`room:${room.code}`);
    if (!wasOnline) schedule(room);
  }

  function unwatch(socket: ClientSocket, code: string) {
    const room = rooms.get(code);
    socket.data.watching.delete(code);
    socket.leave(`room:${code}`);
    if (!room || !room.watchers.delete(socket.id)) return;
    if (!isOnline(room, socket.data.user.id)) {
      schedule(room);
      broadcast(room);
    }
  }

  function connect(socket: ClientSocket) {
    const user = socket.data.user;
    socket.data.watching = new Set();
    socket.join('lobby');
    socket.join(`user:${user.id}`);

    socket.on('lobby:list', (ack) => {
      if (typeof ack === 'function') ack({ ok: true, data: lobbyFor(user.id) });
    });

    socket.on(
      'room:create',
      handler((req) => {
        const hosting = [...rooms.values()].filter((r) => r.hostId === user.id && r.status === 'waiting').length;
        if (hosting >= MAX_WAITING_PER_HOST) {
          throw new InputError(`You already have ${hosting} games waiting for players. Start or leave one first.`);
        }
        const settings = parseSettings(req?.settings, `${user.username}'s game`);
        const seats: SeatView[] = parseSeats(req?.seats).map((s) =>
          s.kind === 'host'
            ? { kind: 'human', userId: user.id, name: user.username }
            : s.kind === 'bot'
              ? { kind: 'bot', botLevel: s.botLevel }
              : { kind: s.kind },
        );
        const now = Date.now();
        const room: Room = {
          code: newCode(),
          hostId: user.id,
          status: 'waiting',
          settings,
          seats,
          game: null,
          events: [],
          statsRecorded: false,
          paused: false,
          createdAt: now,
          updatedAt: now,
          watchers: new Map(),
          timer: null,
          turnDeadline: null,
          busyUntil: 0,
        };
        rooms.set(room.code, room);
        if (req?.startNow) startGame(room);
        else touch(room);
        return { code: room.code };
      }),
    );

    socket.on(
      'room:join',
      handler((req) => {
        const room = getRoom(req?.code);
        if (room.status === 'waiting' && seatOf(room, user.id) === -1) {
          const open = room.seats.findIndex((s) => s.kind === 'open');
          if (open !== -1) {
            room.seats[open] = { kind: 'human', userId: user.id, name: user.username };
            room.updatedAt = Date.now();
            save(room);
            lobbyChanged();
          }
        }
        watch(socket, room);
        broadcast(room);
        return view(room);
      }),
    );

    socket.on('room:unwatch', (req) => {
      if (typeof req?.code === 'string') unwatch(socket, req.code.toUpperCase());
    });

    socket.on(
      'room:leave',
      handler((req) => {
        const room = getRoom(req?.code);
        leave(room, user);
        unwatch(socket, room.code);
        return null;
      }),
    );

    socket.on(
      'room:seat',
      handler((req) => {
        const room = getRoom(req?.code);
        requireWaiting(room);
        const seat = parseSeat(req?.seat);
        const target = room.seats[seat];

        if (req?.action === 'take') {
          if (target.kind !== 'open') throw new InputError('That seat is not free');
          const mine = seatOf(room, user.id);
          if (mine !== -1) room.seats[mine] = { kind: 'open' };
          room.seats[seat] = { kind: 'human', userId: user.id, name: user.username };
          touch(room);
          return null;
        }

        // Whoever seated a player at their device may also take them off again.
        if (!(req?.action === 'open' && target.kind === 'human' && target.controllerId === user.id)) requireHost(room, user);
        if (target.kind === 'human' && target.userId === user.id) throw new InputError("That's your seat");
        if (req?.action === 'open') room.seats[seat] = { kind: 'open' };
        else if (req?.action === 'close') room.seats[seat] = { kind: 'closed' };
        else if (req?.action === 'bot') room.seats[seat] = { kind: 'bot', botLevel: parseBotLevel(req.botLevel) };
        else throw new InputError('Unknown seat action');
        touch(room);
        return null;
      }),
    );

    socket.on(
      'room:addLocal',
      handler((req) => {
        const room = getRoom(req?.code);
        requireWaiting(room);
        const seat = parseSeat(req?.seat);
        if (seatOf(room, user.id) === -1) throw new InputError('Take a seat yourself first');
        const target = room.seats[seat];
        if (target.kind === 'human') throw new InputError('That seat is taken');
        if (target.kind !== 'open') requireHost(room, user);
        const username = parseUsername(req?.username);
        const pairCode = parsePairCode(req?.pairCode);
        if (username.toLowerCase() === user.username.toLowerCase()) throw new InputError("That's you — you already have a seat");
        // Checked before the code is used up, so a slip doesn't cost them a new code.
        if (room.seats.some((s) => s.kind === 'human' && s.name?.toLowerCase() === username.toLowerCase())) {
          throw new InputError(`${username} is already in this game`);
        }
        if (!allowPairing(String(user.id))) throw new InputError('Too many tries. Wait a few minutes and try again.');
        const player = auth.consumePairCode(username, pairCode);
        room.seats[seat] = {
          kind: 'human',
          userId: player.id,
          name: player.username,
          controllerId: user.id,
          controllerName: user.username,
        };
        touch(room);
        io.to(`user:${player.id}`).emit('account:paired', { by: user.username, game: room.settings.name, code: room.code });
        return null;
      }),
    );

    socket.on(
      'room:settings',
      handler((req) => {
        const room = getRoom(req?.code);
        requireHost(room, user);
        requireWaiting(room);
        room.settings = parseSettings(req?.settings, room.settings.name);
        touch(room);
        return null;
      }),
    );

    socket.on(
      'room:start',
      handler((req) => {
        const room = getRoom(req?.code);
        requireHost(room, user);
        requireWaiting(room);
        startGame(room);
        return null;
      }),
    );

    socket.on(
      'game:roll',
      handler((req) => {
        const room = getRoom(req?.code);
        requireTurn(room, user);
        roll(room);
        return null;
      }),
    );

    socket.on(
      'game:move',
      handler((req) => {
        const room = getRoom(req?.code);
        requireTurn(room, user);
        const piece = Number(req?.piece);
        if (!Number.isInteger(piece)) throw new InputError('Invalid plane');
        move(room, piece);
        return null;
      }),
    );

    socket.on(
      'game:bomb',
      handler((req) => {
        const room = getRoom(req?.code);
        requireTurn(room, user);
        const square = Number(req?.square);
        if (!Number.isInteger(square)) throw new InputError('Invalid square');
        commit(room, applyBomb(room.game!, square));
        return null;
      }),
    );

    socket.on(
      'game:box',
      handler((req) => {
        const room = getRoom(req?.code);
        requireTurn(room, user);
        const square = Number(req?.square);
        if (!Number.isInteger(square)) throw new InputError('Invalid square');
        commit(room, applyBox(room.game!, square));
        return null;
      }),
    );

    socket.on(
      'game:pause',
      handler((req) => {
        const room = getRoom(req?.code);
        requireHost(room, user);
        if (room.status !== 'playing') throw new InputError('The game is not running');
        room.paused = !!req?.paused;
        // Resuming starts the turn clock afresh.
        room.busyUntil = Date.now();
        schedule(room);
        touch(room);
        return null;
      }),
    );

    socket.on('disconnect', () => {
      for (const code of [...socket.data.watching]) unwatch(socket, code);
    });
  }

  // ---------- housekeeping ----------

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.watchers.size) continue;
      if (room.status === 'finished' && now - room.updatedAt > KEEP_FINISHED_MS) rooms.delete(room.code);
      else if (room.status === 'waiting' && now - room.updatedAt > EXPIRE_WAITING_MS) closeRoom(room, 'Expired');
    }
  }, 10 * 60 * 1000);
  unref(sweep);

  function shutdown() {
    clearInterval(sweep);
    for (const room of rooms.values()) {
      if (room.timer) clearTimeout(room.timer);
      save(room);
    }
  }

  load();
  return { connect, shutdown };
}
