import type { AccountStatus, ClientToServer, ServerToClient } from '../shared/protocol.ts';
import { FORBIDDEN, UNAUTHORIZED, type ServerFrame } from '../shared/wire.ts';
import { createAuth, unref } from './auth.ts';
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
        return (await auth.handle(request, ip)) ?? auth.json({ error: 'Not found' }, 404);
      } catch (err) {
        console.error(err);
        return auth.json({ error: 'Something went wrong' }, 500);
      }
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
