import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import type { LeaderRow, PairCode, PublicUser } from '../shared/protocol.ts';
import type { Db } from './db.ts';
import { InputError } from './validate.ts';

const COOKIE = 'mz_session';
const SESSION_DAYS = 30;
const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const PAIR_CODE_MS = 10 * 60 * 1000;
const PAIR_CODE_TRIES = 5;

function scryptKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, 64, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptKey(password, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scryptKey(password, Buffer.from(salt, 'base64'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function readCookie(header: string | undefined, name = COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  games_played: number;
  wins: number;
  total_points: number;
}

const toPublic = (u: UserRow): PublicUser => ({
  id: u.id,
  username: u.username,
  gamesPlayed: u.games_played,
  wins: u.wins,
  points: u.total_points,
});


/** Fixed-window limiter: allows `max` hits per key per window. */
export function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return true;
    }
    h.n++;
    return h.n <= max;
  };
}

export function createAuth(db: Db, opts: { secureCookies: boolean }) {
  const q = {
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    sessionUser: db.prepare(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    recordGame: db.prepare(
      'UPDATE users SET games_played = games_played + 1, wins = wins + ?, total_points = total_points + ? WHERE id = ?',
    ),
    leaderboard: db.prepare(`
      SELECT username, total_points, games_played, wins FROM users WHERE games_played > 0
      ORDER BY total_points DESC, wins DESC, games_played ASC, username LIMIT 50
    `),
    savePairCode: db.prepare(`
      INSERT INTO pair_codes (user_id, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)
      ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0
    `),
    pairCode: db.prepare('SELECT code_hash, expires_at, attempts FROM pair_codes WHERE user_id = ?'),
    pairCodeMiss: db.prepare('UPDATE pair_codes SET attempts = attempts + 1 WHERE user_id = ?'),
    deletePairCode: db.prepare('DELETE FROM pair_codes WHERE user_id = ?'),
    purgePairCodes: db.prepare('DELETE FROM pair_codes WHERE expires_at <= ?'),
  };

  const allow = limiter(20, 10 * 60 * 1000);
  const allowPairCode = limiter(10, 10 * 60 * 1000);
  const pairHash = (userId: number, code: string) => sha256(`${userId}:${code}`);

  function startSession(res: Response, userId: number) {
    const token = randomBytes(32).toString('hex');
    const expires = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
    q.insertSession.run(sha256(token), userId, expires);
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.secureCookies,
      maxAge: SESSION_DAYS * 24 * 3600 * 1000,
      path: '/',
    });
  }

  function userFromToken(token: string | null): PublicUser | null {
    if (!token) return null;
    const row = q.sessionUser.get(sha256(token), Date.now()) as UserRow | undefined;
    return row ? toPublic(row) : null;
  }

  function credentials(req: Request): { username: string; password: string } | string {
    const { username, password } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof username !== 'string' || !USERNAME_RE.test(username.trim())) {
      return 'Username must be 3–20 letters, numbers, _ or -';
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      return 'Password must be 6–128 characters';
    }
    return { username: username.trim(), password };
  }

  const router = express.Router();

  router.post('/register', async (req, res) => {
    if (!allow(req.ip ?? '')) return void res.status(429).json({ error: 'Too many attempts, try again later' });
    const c = credentials(req);
    if (typeof c === 'string') return void res.status(400).json({ error: c });
    if (q.userByName.get(c.username)) return void res.status(409).json({ error: 'That username is taken' });
    const hash = await hashPassword(c.password);
    let id: number;
    try {
      id = Number(q.insertUser.run(c.username, hash, Date.now()).lastInsertRowid);
    } catch {
      return void res.status(409).json({ error: 'That username is taken' });
    }
    startSession(res, id);
    res.status(201).json(toPublic(q.userById.get(id) as unknown as UserRow));
  });

  router.post('/login', async (req, res) => {
    if (!allow(req.ip ?? '')) return void res.status(429).json({ error: 'Too many attempts, try again later' });
    const c = credentials(req);
    const row = typeof c === 'string' ? undefined : (q.userByName.get(c.username) as UserRow | undefined);
    if (typeof c === 'string' || !row || !(await verifyPassword(c.password, row.password_hash))) {
      return void res.status(401).json({ error: 'Wrong username or password' });
    }
    startSession(res, row.id);
    res.json(toPublic(row));
  });

  router.post('/logout', (req, res) => {
    const token = readCookie(req.headers.cookie);
    if (token) q.deleteSession.run(sha256(token));
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  /** The signed-in user, or answers 401 and returns null. */
  function signedIn(req: Request, res: Response): PublicUser | null {
    const user = userFromToken(readCookie(req.headers.cookie));
    if (!user) res.status(401).json({ error: 'Not signed in' });
    return user;
  }

  router.get('/me', (req, res) => {
    const user = signedIn(req, res);
    if (user) res.json(user);
  });

  router.get('/leaderboard', (req, res) => {
    if (!signedIn(req, res)) return;
    const rows = q.leaderboard.all() as unknown as Pick<UserRow, 'username' | 'total_points' | 'games_played' | 'wins'>[];
    res.json(rows.map((r): LeaderRow => ({ username: r.username, points: r.total_points, gamesPlayed: r.games_played, wins: r.wins })));
  });

  // A code the player reads out so someone can seat them at their device. One active code per player.
  router.post('/pair-code', (req, res) => {
    const user = signedIn(req, res);
    if (!user) return;
    if (!allowPairCode(String(user.id))) return void res.status(429).json({ error: 'Too many codes, try again in a few minutes' });
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = Date.now() + PAIR_CODE_MS;
    q.savePairCode.run(user.id, pairHash(user.id, code), expiresAt);
    res.json({ code, expiresAt } satisfies PairCode);
  });

  setInterval(() => {
    q.purgeSessions.run(Date.now());
    q.purgePairCodes.run(Date.now());
  }, 3600 * 1000).unref();

  return {
    router,
    userFromCookieHeader: (header: string | undefined) => userFromToken(readCookie(header)),
    recordGame(userId: number, won: boolean, points: number) {
      q.recordGame.run(won ? 1 : 0, Math.max(0, Math.round(points)), userId);
    },
    /** Checks a player's one-time code and uses it up. Too many wrong guesses burn the code. */
    consumePairCode(username: string, code: string): PublicUser {
      const row = q.userByName.get(username.trim()) as UserRow | undefined;
      const pc = row && (q.pairCode.get(row.id) as { code_hash: string; expires_at: number; attempts: number } | undefined);
      if (!row) throw new InputError(`There is no player called "${username.trim()}"`);
      if (!pc || pc.expires_at <= Date.now()) {
        throw new InputError(`${row.username} has no active code. Ask them to open Settings and get one.`);
      }
      if (pairHash(row.id, code.replace(/\D/g, '')) !== pc.code_hash) {
        if (pc.attempts + 1 >= PAIR_CODE_TRIES) {
          q.deletePairCode.run(row.id);
          throw new InputError('Wrong code. Too many tries, so that code no longer works — ask for a new one.');
        }
        q.pairCodeMiss.run(row.id);
        throw new InputError('Wrong code');
      }
      q.deletePairCode.run(row.id);
      return toPublic(row);
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
