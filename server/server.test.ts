import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import WebSocket from 'ws';
import { chooseBomb, chooseBox, chooseMove } from '../shared/ai.ts';
import type { LeaderRow, PublicUser, RoomUpdate, RoomView } from '../shared/protocol.ts';
import { REACTION_BY_ID } from '../shared/reactions.ts';
import { GameSocket, type WsLike } from '../shared/socket-client.ts';
import { WS_PATH } from '../shared/wire.ts';
import { startServer } from './app.ts';

type Client = GameSocket;

const dir = mkdtempSync(join(tmpdir(), 'mencherz-'));
const dbPath = join(dir, 'test.db');
let server: Awaited<ReturnType<typeof startServer>>;
let base = '';

async function boot() {
  server = await startServer({
    port: 0,
    host: '127.0.0.1',
    dbPath,
    secureCookies: false,
    trustProxy: false,
    clientDir: null,
    timeScale: 0.01,
  });
  base = `http://127.0.0.1:${server.port}`;
}

async function signUp(username: string, password = 'secret123') {
  const res = await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  return res.headers.get('set-cookie')!.split(';')[0];
}

/** A game socket signed in with this cookie, as the browser client uses it. */
async function socketFor(cookie: string, origin?: string): Promise<Client> {
  const url = `${base.replace(/^http/, 'ws')}${WS_PATH}`;
  const headers = origin ? { cookie, origin } : { cookie };
  const s = new GameSocket(() => new WebSocket(url, { headers }) as unknown as WsLike, { reconnect: false });
  await new Promise<void>((resolve, reject) => {
    s.once('connect', resolve);
    s.once('connect_error', reject);
  });
  return s;
}

function call<T>(s: Client, event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const cb = (res: { ok: boolean; data?: T; error?: string }) =>
      res.ok ? resolve(res.data as T) : reject(new Error(res.error));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyS = s as any;
    if (payload === undefined) anyS.emit(event, cb);
    else anyS.emit(event, payload, cb);
  });
}

/** Plays the human seats on these sockets until the game ends or `stopAfter` actions. */
function autoplay(players: { socket: Client; userId: number }[], code: string, stopAfter = Infinity) {
  let actions = 0;
  let last: RoomView | null = null;
  return new Promise<RoomView>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const g = last?.game;
      reject(new Error(`game took too long; last: turn=${g?.turn} phase=${g?.phase} dice=${g?.dice} movable=${g?.movable} seats=${JSON.stringify(last?.seats)}`));
    }, 60_000);
    for (const { socket, userId } of players) {
      socket.on('room:update', ({ room }: RoomUpdate) => {
        if (room.code !== code || room.status === 'waiting') return;
        last = room;
        if (room.status !== 'playing' || actions >= stopAfter) {
          clearTimeout(timeout);
          resolve(room);
          return;
        }
        const g = room.game!;
        const seat = room.seats[g.turn];
        if (seat.kind !== 'human' || (seat.userId !== userId && seat.controllerId !== userId)) return;
        actions++;
        const act =
          g.phase === 'roll'
            ? call(socket, 'game:roll', { code })
            : g.phase === 'bomb'
              ? call(socket, 'game:bomb', { code, square: chooseBomb(g, 'normal') })
              : g.phase === 'box'
                ? call(socket, 'game:box', { code, square: chooseBox(g, 'normal') })
                : call(socket, 'game:move', { code, piece: chooseMove(g, 'normal') });
        // Races with the single-move autoplay are expected; anything else is a bug.
        act.catch((err) => {
          if (!/not time|not your turn|cannot move/i.test(err.message)) reject(err);
        });
      });
    }
  });
}

before(boot);
after(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('auth', () => {
  test('rejects bad credentials and unauthenticated sockets', async () => {
    const cookie = await signUp('carol');
    const me = await fetch(`${base}/api/me`, { headers: { cookie } });
    assert.equal(((await me.json()) as { username: string }).username, 'carol');

    const dup = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'CAROL', password: 'whatever1' }),
    });
    assert.equal(dup.status, 409);

    const bad = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'carol', password: 'nope-nope' }),
    });
    assert.equal(bad.status, 401);

    const good = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'carol', password: 'secret123' }),
    });
    assert.equal(good.status, 200);

    await assert.rejects(socketFor('mz_session=forged'), /unauthorized/);
  });
});

describe('online game', () => {
  test('two players and a bot play to the end, surviving a restart', async () => {
    const aliceCookie = await signUp('alice');
    const bobCookie = await signUp('bob');
    let alice = await socketFor(aliceCookie);
    let bob = await socketFor(bobCookie);

    const { code } = await call<{ code: string }>(alice, 'room:create', {
      settings: { name: 'Test table', isPublic: true, turnSeconds: 0 },
      seats: [{ kind: 'host' }, { kind: 'open' }, { kind: 'bot', botLevel: 'hard' }, { kind: 'closed' }],
    });
    const aliceView = await call<RoomView>(alice, 'room:join', { code });
    const aliceId = aliceView.seats[0].userId!;

    const lobby = await call<{ open: { code: string }[] }>(bob, 'lobby:list');
    assert.ok(lobby.open.some((r) => r.code === code), 'room listed in lobby');

    const bobView = await call<RoomView>(bob, 'room:join', { code });
    assert.equal(bobView.seats[1].name, 'bob');
    const bobId = bobView.seats[1].userId!;

    await assert.rejects(call(bob, 'room:start', { code }), /Only the host/);

    // Play a while, then restart the server mid-game. Listen before starting so the first turn isn't missed.
    const playing = autoplay(
      [
        { socket: alice, userId: aliceId },
        { socket: bob, userId: bobId },
      ],
      code,
      40,
    );
    await call(alice, 'room:start', { code });
    const mid = await playing;
    assert.equal(mid.status, 'playing');
    const seqBefore = mid.game!.seq;
    alice.disconnect();
    bob.disconnect();
    await server.close();
    await boot();

    alice = await socketFor(aliceCookie);
    bob = await socketFor(bobCookie);
    const restored = await call<RoomView>(alice, 'room:join', { code });
    assert.equal(restored.status, 'playing');
    assert.ok(restored.game!.seq >= seqBefore, 'game state restored');
    await call(bob, 'room:join', { code });

    const done = autoplay(
      [
        { socket: alice, userId: aliceId },
        { socket: bob, userId: bobId },
      ],
      code,
    );
    // Kick the loop off in case it is already a human's turn.
    const g = restored.game!;
    const turnUser = restored.seats[g.turn].userId;
    const starter = turnUser === aliceId ? alice : turnUser === bobId ? bob : null;
    if (starter) {
      await (g.phase === 'roll'
        ? call(starter, 'game:roll', { code })
        : g.phase === 'bomb'
          ? call(starter, 'game:bomb', { code, square: chooseBomb(g, 'normal') })
          : g.phase === 'box'
            ? call(starter, 'game:box', { code, square: chooseBox(g, 'normal') })
            : call(starter, 'game:move', { code, piece: chooseMove(g, 'normal') }));
    }
    const final = await done;
    assert.equal(final.status, 'finished');
    assert.equal(final.game!.phase, 'over');

    const me = (await (await fetch(`${base}/api/me`, { headers: { cookie: aliceCookie } })).json()) as { gamesPlayed: number };
    assert.equal(me.gamesPlayed, 1);

    alice.disconnect();
    bob.disconnect();
  });

  test('a solo game against bots pauses when the player leaves', async () => {
    const cookie = await signUp('dave');
    const dave = await socketFor(cookie);
    const { code } = await call<{ code: string }>(dave, 'room:create', {
      settings: { name: 'Solo', isPublic: false, turnSeconds: 0 },
      seats: [{ kind: 'host' }, { kind: 'bot', botLevel: 'easy' }, { kind: 'bot', botLevel: 'normal' }, { kind: 'bot', botLevel: 'hard' }],
      startNow: true,
    });
    const view = await call<RoomView>(dave, 'room:join', { code });
    assert.equal(view.status, 'playing');
    const lobby = await call<{ open: { code: string }[]; mine: { code: string }[] }>(dave, 'lobby:list');
    assert.ok(!lobby.open.some((r) => r.code === code), 'private game is not listed');
    assert.ok(lobby.mine.some((r) => r.code === code), 'but shows under my games');

    dave.emit('room:unwatch', { code });
    await new Promise((r) => setTimeout(r, 300));
    const other = await socketFor(await signUp('erin'));
    const a = await call<RoomView>(other, 'room:join', { code });
    await new Promise((r) => setTimeout(r, 300));
    const b = await call<RoomView>(other, 'room:join', { code });
    assert.equal(a.game!.seq, b.game!.seq, 'nothing moves while the only player is away');
    other.disconnect();
    dave.disconnect();
  });
});

async function getJson<T>(path: string, cookie: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(res.ok, `${path}: ${res.status} ${await res.clone().text()}`);
  return (await res.json()) as T;
}

describe('local players', () => {
  test('a player seated with their one-time code plays at the host device and gets the points', async () => {
    const hostCookie = await signUp('tablet');
    const kidCookie = await signUp('kid');
    const host = await socketFor(hostCookie);
    const kid = await socketFor(kidCookie);
    const { code: pairCode } = await getJson<{ code: string }>('/pair-code', kidCookie, {});
    assert.match(pairCode, /^\d{6}$/);

    const { code } = await call<{ code: string }>(host, 'room:create', {
      settings: { name: 'Family table', isPublic: false, turnSeconds: 0, gifs: true },
      seats: [{ kind: 'host' }, { kind: 'open' }, { kind: 'bot', botLevel: 'easy' }, { kind: 'closed' }],
    });
    const hostId = (await call<RoomView>(host, 'room:join', { code })).seats[0].userId!;

    const wrong = String((Number(pairCode) + 1) % 1_000_000).padStart(6, '0');
    await assert.rejects(call(host, 'room:addLocal', { code, seat: 1, username: 'kid', pairCode: wrong }), /Wrong code/);
    await assert.rejects(call(host, 'room:addLocal', { code, seat: 1, username: 'nobody', pairCode }), /no player/);

    const paired = new Promise<{ by: string; code: string }>((resolve) => kid.once('account:paired', resolve));
    await call(host, 'room:addLocal', { code, seat: 1, username: 'kid', pairCode });
    assert.deepEqual(await paired, { by: 'tablet', game: 'Family table', code });

    const seated = await call<RoomView>(host, 'room:join', { code });
    assert.equal(seated.seats[1].name, 'kid');
    assert.equal(seated.seats[1].controllerId, hostId);
    assert.equal(seated.seats[1].online, true, 'here because the host device is');
    await assert.rejects(call(host, 'room:addLocal', { code, seat: 3, username: 'kid', pairCode }), /already in this game/);

    // The code was used up.
    const { code: other } = await call<{ code: string }>(host, 'room:create', {
      settings: { name: 'Second', isPublic: false, turnSeconds: 0 },
      seats: [{ kind: 'host' }, { kind: 'open' }, { kind: 'closed' }, { kind: 'closed' }],
    });
    await call(host, 'room:join', { code: other });
    await assert.rejects(call(host, 'room:addLocal', { code: other, seat: 1, username: 'kid', pairCode }), /no active code/);
    await call(host, 'room:leave', { code: other });

    const reactions: RoomUpdate['reactions'] = [];
    host.on('room:update', (u: RoomUpdate) => {
      if (u.room.code === code) reactions.push(...(u.reactions ?? []));
    });
    const done = autoplay([{ socket: host, userId: hostId }], code);
    await call(host, 'room:start', { code });
    const final = await done;
    assert.equal(final.status, 'finished');

    assert.ok(reactions.some((r) => REACTION_BY_ID.get(r.id)?.group === 'happy'), 'pieces reaching home set off reactions');
    assert.ok(reactions.every((r) => REACTION_BY_ID.has(r.id)));

    const g = final.game!;
    const kidMe = await getJson<PublicUser>('/me', kidCookie);
    assert.equal(kidMe.gamesPlayed, 1);
    assert.equal(kidMe.points, g.stats[1].points);
    assert.equal(kidMe.wins, g.standings[0] === 1 ? 1 : 0);

    const board = await getJson<LeaderRow[]>('/leaderboard', kidCookie);
    assert.equal(board.find((r) => r.username === 'kid')?.points, g.stats[1].points);
    assert.equal(board.find((r) => r.username === 'tablet')?.points, g.stats[0].points);
    assert.ok(board.every((r, i) => i === 0 || board[i - 1].points >= r.points), 'sorted by points');

    host.disconnect();
    kid.disconnect();
  });
});

describe('leaderboard', () => {
  test('a game against computers alone does not count', async () => {
    const cookie = await signUp('loner');
    const s = await socketFor(cookie);
    const { code } = await call<{ code: string }>(s, 'room:create', {
      settings: { name: 'Practice', isPublic: false, turnSeconds: 0 },
      seats: [{ kind: 'host' }, { kind: 'bot', botLevel: 'easy' }, { kind: 'closed' }, { kind: 'closed' }],
    });
    const userId = (await call<RoomView>(s, 'room:join', { code })).seats[0].userId!;
    const done = autoplay([{ socket: s, userId }], code);
    await call(s, 'room:start', { code });
    assert.equal((await done).status, 'finished');

    const me = await getJson<PublicUser>('/me', cookie);
    assert.deepEqual([me.gamesPlayed, me.wins, me.points], [0, 0, 0]);
    const board = await getJson<LeaderRow[]>('/leaderboard', cookie);
    assert.ok(!board.some((r) => r.username === 'loner'));
    s.disconnect();
  });
});

describe('pause', () => {
  test('the host can pause and resume; nobody plays while paused', async () => {
    const hostCookie = await signUp('pauser');
    const host = await socketFor(hostCookie);
    const guest = await socketFor(await signUp('guesty'));
    const { code } = await call<{ code: string }>(host, 'room:create', {
      settings: { name: 'Pausable', isPublic: false, turnSeconds: 10 },
      seats: [{ kind: 'host' }, { kind: 'bot', botLevel: 'easy' }, { kind: 'closed' }, { kind: 'closed' }],
      startNow: true,
    });
    await call<RoomView>(host, 'room:join', { code });
    await call(host, 'game:pause', { code, paused: true });
    const paused = await call<RoomView>(guest, 'room:join', { code });
    assert.equal(paused.paused, true);
    assert.equal(paused.turnDeadline, null, 'no clock while paused');
    await assert.rejects(call(guest, 'game:pause', { code, paused: false }), /Only the host/);
    await assert.rejects(call(host, 'game:roll', { code }), /paused/);
    await new Promise((r) => setTimeout(r, 200));
    const still = await call<RoomView>(guest, 'room:join', { code });
    assert.equal(still.game!.seq, paused.game!.seq, 'bots wait too');

    await call(host, 'game:pause', { code, paused: false });
    const resumed = await call<RoomView>(guest, 'room:join', { code });
    assert.equal(resumed.paused, false);
    host.disconnect();
    guest.disconnect();
  });
});

describe('sockets', () => {
  test('rejects sockets opened from another site', async () => {
    const cookie = await signUp('mallory');
    await assert.rejects(socketFor(cookie, 'https://evil.example'), /forbidden/);
  });
});
