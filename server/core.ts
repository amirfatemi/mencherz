import type { ClientToServer, ServerToClient } from '../shared/protocol.ts';
import { FORBIDDEN, UNAUTHORIZED, type ServerFrame } from '../shared/wire.ts';
import { createAuth, unref } from './auth.ts';
import { initSchema, type Db } from './db.ts';
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
  const auth = createAuth(db, { secureCookies: config.secureCookies, admins: config.admins });
  const hub = new Hub<ClientToServer, ServerToClient, SocketData>();
  const rooms = createRooms(hub, db, auth, { timeScale: config.timeScale ?? 1 });
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
      const path = new URL(request.url).pathname;
      if (path === '/api/health') return auth.json({ ok: true });
      try {
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
