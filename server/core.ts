import type { AccountStatus, ClientToServer, ServerToClient } from '../shared/protocol.ts';
import { FORBIDDEN, UNAUTHORIZED, type ServerFrame } from '../shared/wire.ts';
import { createAuth, unref } from './auth.ts';
import { backUp, fetchBackup, importData, listBackups, type BackupConfig } from './backup.ts';
import { initSchema, type Db } from './db.ts';
import { createHistory } from './history.ts';
import { Hub, type Conn } from './hub.ts';
import { createRooms, type SocketData } from './rooms.ts';

export interface CoreConfig {
  db: Db;
  secureCookies: boolean;
  /** Extra origins allowed to open a socket, besides the server's own host. */
  allowedOrigins?: string[];
  /** Multiplies bot/turn delays. Tests use a small value. */
  timeScale?: number;
  /** Usernames that are admins. */
  admins?: string[];
  /** Sign-in and sign-up tries allowed per address every 10 minutes (20 by default). */
  signInTries?: number;
  /** The deployed version, reported by /api/health. */
  version?: string;
  /** Where backups go (a GitHub repository's draft release); without it there are none. */
  backup?: BackupConfig;
  /** Runs a function as one database transaction (the Durable Object's own way, or BEGIN/COMMIT on Node). */
  transaction?: <T>(fn: () => T) => T;
  /** Starts the server over on what's in the database, after a backup was restored into it. */
  restart?: () => void;
  /** For tests: how backups reach GitHub. */
  fetcher?: typeof fetch;
}

/** What the runtime knows about a WebSocket upgrade request. */
export interface UpgradeInfo {
  cookie: string | null | undefined;
  origin: string | null | undefined;
  host: string | null | undefined;
}

/**
 * The whole game server, independent of where it runs: answers /api requests and takes WebSocket
 * connections. server/app.ts runs it on Node; worker/index.ts runs it in a Cloudflare Durable Object.
 */
export function createGameServer(config: CoreConfig) {
  const { db } = config;
  initSchema(db);
  const hub = new Hub<ClientToServer, ServerToClient, SocketData>();
  // A player's own pages hear at once when an admin approves or disables their account.
  const onStatus = (userId: number, status: AccountStatus) => hub.to(`user:${userId}`).emit('account:status', { status });
  const auth = createAuth(db, { secureCookies: config.secureCookies, admins: config.admins, onStatus, signInTries: config.signInTries });
  const rooms = createRooms(hub, db, auth, { timeScale: config.timeScale ?? 1 });
  const history = createHistory(db);
  const sweep = setInterval(() => hub.sweep(), 15_000);
  unref(sweep);

  // Browsers attach the session cookie to cross-site WebSocket handshakes too; only accept our own pages.
  function originAllowed({ origin, host }: UpgradeInfo): boolean {
    if (!origin) return true;
    try {
      return new URL(origin).host === host || !!config.allowedOrigins?.includes(origin);
    } catch {
      return false;
    }
  }

  /**
   * The admin's backups: GET /admin/backups lists them, POST /admin/backup takes one now, and POST /admin/restore
   * { name } puts one back (after taking a backup of what's there), then starts over on it.
   */
  async function backups(request: Request, path: string): Promise<Response> {
    const user = auth.userFromCookieHeader(request.headers.get('cookie'));
    if (!user) return auth.json({ error: 'Not signed in' }, 401);
    if (!user.isAdmin) return auth.json({ error: 'Admins only' }, 403);
    const cfg = config.backup;
    if (!cfg) return auth.json({ error: "Backups aren't set up: the server needs a GITHUB_TOKEN" }, 400);
    try {
      if (path === '/admin/backups' && request.method === 'GET') return auth.json(await listBackups(cfg, config.fetcher));
      if (path === '/admin/backup' && request.method === 'POST') return auth.json(await backUp(db, cfg, config.fetcher, 'manual'));
      if (path === '/admin/restore' && request.method === 'POST') {
        const { name } = (await request.json().catch(() => ({}))) as { name?: unknown };
        if (typeof name !== 'string' || !name) return auth.json({ error: 'Which backup?' }, 400);
        const data = await fetchBackup(cfg, name, config.fetcher);
        const before = await backUp(db, cfg, config.fetcher, 'before-restore');
        importData(db, data, config.transaction);
        console.log(`Restored backup ${name} (taken ${new Date(data.at).toISOString()}); what was there is ${before.name}`);
        setTimeout(() => config.restart?.(), 200);
        return auth.json({ restored: name, at: data.at, before: before.name });
      }
      return auth.json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error('Backup:', err);
      return auth.json({ error: (err as Error).message }, 502);
    }
  }

  return {
    async api(request: Request, ip: string): Promise<Response> {
      // Node mounts this under /api and passes the rest of the path; the Worker passes all of it.
      const path = new URL(request.url).pathname.replace(/^\/api/, '');
      if (path === '/health') return auth.json({ ok: true, version: config.version ?? null });
      try {
        if (path === '/history' && request.method === 'GET') {
          if (!auth.userFromCookieHeader(request.headers.get('cookie'))) return auth.json({ error: 'Not signed in' }, 401);
          return auth.json(history.handle(request));
        }
        if (path.startsWith('/admin/backup') || path === '/admin/restore') return await backups(request, path);
        return (await auth.handle(request, ip)) ?? auth.json({ error: 'Not found' }, 404);
      } catch (err) {
        console.error(err);
        return auth.json({ error: 'Something went wrong' }, 500);
      }
    },

    /** Takes a backup now (the monthly one, from the Worker's schedule); null when backups aren't set up. */
    async backUp(label = 'monthly') {
      return config.backup ? backUp(db, config.backup, config.fetcher, label) : null;
    },

    /** Takes a WebSocket at /ws. Returns the message/close callbacks, or null if it was turned away (and closed). */
    connect(conn: Conn, info: UpgradeInfo) {
      // The client closes a socket it's told is turned away; the close here is the fallback.
      const reject = (m: 'unauthorized' | 'forbidden') => {
        conn.send(JSON.stringify({ t: 'x', m } satisfies ServerFrame));
        conn.close(m === 'unauthorized' ? UNAUTHORIZED : FORBIDDEN, m);
        return null;
      };
      if (!originAllowed(info)) return reject('forbidden');
      const user = auth.userFromCookieHeader(info.cookie);
      if (!user) return reject('unauthorized');
      return hub.attach(conn, { user, watching: new Set() }, rooms.connect);
    },

    shutdown() {
      clearInterval(sweep);
      rooms.shutdown();
      auth.stop();
      hub.closeAll();
    },
  };
}

export type GameServer = ReturnType<typeof createGameServer>;
