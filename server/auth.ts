import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import type { AdminUserRow, Captcha, LeaderRow, PairCode, PublicUser } from '../shared/protocol.ts';
import type { Db } from './db.ts';
import { InputError } from './validate.ts';

const COOKIE = 'mz_session';
const SESSION_DAYS = 30;
const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const PAIR_CODE_MS = 10 * 60 * 1000;
const PAIR_CODE_TRIES = 5;
const CAPTCHA_MS = 10 * 60 * 1000;

// Standard encodings that behave the same on Node and on Workers (and match Buffer's output).
const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function scryptKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, 64, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptKey(password, salt);
  return `scrypt$${toBase64(salt)}$${toBase64(key)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = fromBase64(key);
  const actual = await scryptKey(password, fromBase64(salt));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function readCookie(header: string | null | undefined, name = COOKIE): string | null {
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
  created_at: number;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

/** Lets a timer not hold a Node process open; Workers timers have no such notion. */
export function unref(timer: unknown) {
  (timer as { unref?: () => void }).unref?.();
}



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

export function createAuth(db: Db, opts: { secureCookies: boolean; admins?: string[] }) {
  // Admins are named in config (ADMINS), so the account is an admin as soon as it's created.
  const admins = new Set((opts.admins ?? []).map((name) => name.toLowerCase()));
  const isAdmin = (username: string) => admins.has(username.toLowerCase());
  const toPublic = (u: UserRow): PublicUser => ({
    id: u.id,
    username: u.username,
    gamesPlayed: u.games_played,
    wins: u.wins,
    points: u.total_points,
    isAdmin: isAdmin(u.username),
  });

  const q = {
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?) RETURNING id'),
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
    allUsers: db.prepare('SELECT * FROM users ORDER BY created_at'),
    setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    deleteSessionsOf: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  };

  // One-time sums for the sign-in and sign-up forms, kept in memory: a restart just asks for a new one.
  const captchas = new Map<string, { answer: number; expires: number }>();
  function newCaptcha(): Captcha {
    const now = Date.now();
    if (captchas.size > 5000) for (const [k, v] of captchas) if (v.expires < now) captchas.delete(k);
    const a = randomInt(1, 10);
    const b = randomInt(1, 10);
    const id = toHex(randomBytes(12));
    captchas.set(id, { answer: a + b, expires: now + CAPTCHA_MS });
    return { id, question: `${a} + ${b}` };
  }
  /** Checks an answer and uses the sum up either way. */
  function solved(body: unknown): boolean {
    const { captchaId, captchaAnswer } = (body ?? {}) as Record<string, unknown>;
    if (typeof captchaId !== 'string') return false;
    const c = captchas.get(captchaId);
    captchas.delete(captchaId);
    return !!c && c.expires > Date.now() && Number(String(captchaAnswer).trim()) === c.answer;
  }
  const CAPTCHA_WRONG = { error: "That sum isn't right — try the new one", captcha: true };

  const allow = limiter(20, 10 * 60 * 1000);
  const allowPairCode = limiter(10, 10 * 60 * 1000);
  const pairHash = (userId: number, code: string) => sha256(`${userId}:${code}`);

  /** Opens a session and returns the Set-Cookie header for it. */
  function startSession(userId: number): string {
    const token = toHex(randomBytes(32));
    const maxAge = SESSION_DAYS * 24 * 3600;
    q.insertSession.run(sha256(token), userId, Date.now() + maxAge * 1000);
    return `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${opts.secureCookies ? '; Secure' : ''}`;
  }

  function userFromToken(token: string | null): PublicUser | null {
    if (!token) return null;
    const row = q.sessionUser.get(sha256(token), Date.now()) as UserRow | undefined;
    return row ? toPublic(row) : null;
  }

  function credentials(body: unknown): { username: string; password: string } | string {
    const { username, password } = (body ?? {}) as Record<string, unknown>;
    if (typeof username !== 'string' || !USERNAME_RE.test(username.trim())) {
      return 'Username must be 3–20 letters, numbers, _ or -';
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      return 'Password must be 6–128 characters';
    }
    return { username: username.trim(), password };
  }

  async function readJson(req: Request): Promise<unknown> {
    const text = await req.text();
    if (text.length > 32 * 1024) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function register(req: Request, ip: string): Promise<Response> {
    if (!allow(ip)) return json({ error: 'Too many attempts, try again later' }, 429);
    const body = await readJson(req);
    if (!solved(body)) return json(CAPTCHA_WRONG, 400);
    const c = credentials(body);
    if (typeof c === 'string') return json({ error: c }, 400);
    if (q.userByName.get(c.username)) return json({ error: 'That username is taken' }, 409);
    const hash = await hashPassword(c.password);
    let id: number;
    try {
      id = Number((q.insertUser.get(c.username, hash, Date.now()) as { id: number }).id);
    } catch {
      return json({ error: 'That username is taken' }, 409);
    }
    return json(toPublic(q.userById.get(id) as UserRow), 201, { 'set-cookie': startSession(id) });
  }

  async function login(req: Request, ip: string): Promise<Response> {
    if (!allow(ip)) return json({ error: 'Too many attempts, try again later' }, 429);
    const body = await readJson(req);
    if (!solved(body)) return json(CAPTCHA_WRONG, 400);
    const c = credentials(body);
    const row = typeof c === 'string' ? undefined : (q.userByName.get(c.username) as UserRow | undefined);
    if (typeof c === 'string' || !row || !(await verifyPassword(c.password, row.password_hash))) {
      return json({ error: 'Wrong username or password' }, 401);
    }
    return json(toPublic(row), 200, { 'set-cookie': startSession(row.id) });
  }

  function logout(req: Request): Response {
    const token = readCookie(req.headers.get('cookie'));
    if (token) q.deleteSession.run(sha256(token));
    return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` });
  }

  function leaderboard(): Response {
    const rows = q.leaderboard.all() as Pick<UserRow, 'username' | 'total_points' | 'games_played' | 'wins'>[];
    return json(rows.map((r): LeaderRow => ({ username: r.username, points: r.total_points, gamesPlayed: r.games_played, wins: r.wins })));
  }

  // A code the player reads out so someone can seat them at their device. One active code per player.
  function pairCode(user: PublicUser): Response {
    if (!allowPairCode(String(user.id))) return json({ error: 'Too many codes, try again in a few minutes' }, 429);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = Date.now() + PAIR_CODE_MS;
    q.savePairCode.run(user.id, pairHash(user.id, code), expiresAt);
    return json({ code, expiresAt } satisfies PairCode);
  }

  function adminUsers(): Response {
    const rows = q.allUsers.all() as UserRow[];
    return json(
      rows.map((u): AdminUserRow => ({
        id: u.id,
        username: u.username,
        createdAt: u.created_at,
        gamesPlayed: u.games_played,
        wins: u.wins,
        points: u.total_points,
        isAdmin: isAdmin(u.username),
      })),
    );
  }

  /** Sets a player's password and signs them out everywhere. */
  async function adminSetPassword(req: Request): Promise<Response> {
    const { userId, password } = ((await readJson(req)) ?? {}) as Record<string, unknown>;
    const row = typeof userId === 'number' ? (q.userById.get(userId) as UserRow | undefined) : undefined;
    if (!row) return json({ error: 'No such player' }, 404);
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      return json({ error: 'Password must be 6–128 characters' }, 400);
    }
    q.setPassword.run(await hashPassword(password), row.id);
    q.deleteSessionsOf.run(row.id);
    q.deletePairCode.run(row.id);
    return json({ ok: true });
  }

  /** Answers the account endpoints under /api, or returns null for any other path. */
  async function handle(req: Request, ip: string): Promise<Response | null> {
    const path = new URL(req.url).pathname.replace(/^\/api/, '');
    const route = `${req.method} ${path}`;
    if (route === 'GET /captcha') return json(newCaptcha());
    if (route === 'POST /register') return register(req, ip);
    if (route === 'POST /login') return login(req, ip);
    if (route === 'POST /logout') return logout(req);
    const signedInRoutes = ['GET /me', 'GET /leaderboard', 'POST /pair-code', 'GET /admin/users', 'POST /admin/password'];
    if (!signedInRoutes.includes(route)) return null;
    const user = userFromToken(readCookie(req.headers.get('cookie')));
    if (!user) return json({ error: 'Not signed in' }, 401);
    if (route === 'GET /me') return json(user);
    if (route === 'GET /leaderboard') return leaderboard();
    if (route === 'POST /pair-code') return pairCode(user);
    if (!user.isAdmin) return json({ error: 'Admins only' }, 403);
    if (route === 'GET /admin/users') return adminUsers();
    return adminSetPassword(req);
  }

  const purge = setInterval(() => {
    q.purgeSessions.run(Date.now());
    q.purgePairCodes.run(Date.now());
  }, 3600 * 1000);
  unref(purge);

  return {
    handle,
    json,
    stop: () => clearInterval(purge),
    userFromCookieHeader: (header: string | null | undefined) => userFromToken(readCookie(header)),
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
