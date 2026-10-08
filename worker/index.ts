import { DurableObject } from 'cloudflare:workers';
import { createGameServer, type GameServer } from '../server/core.ts';
import { WS_PATH } from '../shared/wire.ts';
import { durableDb } from './durable-db.ts';

// Mencherz on Cloudflare. The built client is served as static assets; /api/* and the /ws socket go
// to a single Durable Object, MencherzHub, which runs the same game server as Node (server/core.ts)
// with the Durable Object's SQLite storage. One object holds every game, which is plenty for this scale
// and keeps lobby, rooms and accounts in one place.

interface Env {
  HUB: DurableObjectNamespace<MencherzHub>;
  ASSETS: Fetcher;
  /** Comma-separated extra origins allowed to open a socket (optional). */
  ALLOWED_ORIGINS?: string;
  /** Comma-separated usernames that are admins. */
  ADMINS?: string;
  /** Which deployed version this code is (wrangler.toml [version_metadata]). */
  CF_VERSION_METADATA?: { id: string };
}

const VERSION_HEADER = 'x-mencherz-version';

const list = (v: string | undefined) => v?.split(',').map((s) => s.trim()).filter(Boolean);

export class MencherzHub extends DurableObject<Env> {
  private game: GameServer;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.game = createGameServer({
      db: durableDb(ctx.storage.sql),
      secureCookies: true,
      allowedOrigins: list(env.ALLOWED_ORIGINS),
      admins: list(env.ADMINS),
      version: env.CF_VERSION_METADATA?.id,
    });
  }

  async fetch(request: Request): Promise<Response> {
    // A running object keeps its code across deploys while players are connected. When a request
    // comes from a newer Worker, restart: games are saved on every change, and sockets reconnect.
    const wanted = request.headers.get(VERSION_HEADER);
    const mine = this.env.CF_VERSION_METADATA?.id;
    if (wanted && mine && wanted !== mine) this.ctx.abort('a newer version was deployed');

    const url = new URL(request.url);
    if (url.pathname !== WS_PATH) return this.game.api(request, request.headers.get('CF-Connecting-IP') ?? '');

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    const callbacks = this.game.connect(
      {
        send: (text) => server.send(text),
        // Sockets are only closed from here when turned away, and the client closes those itself
        // on the 'x' frame; closing first from a Durable Object is reported as a lost connection.
        close: (code, reason) =>
          setTimeout(() => {
            try {
              server.close(code, reason);
            } catch {
              /* the client closed it */
            }
          }, 10_000),
      },
      { cookie: request.headers.get('Cookie'), origin: request.headers.get('Origin'), host: url.host },
    );
    // Listen even on sockets turned away: an unheard error event is reported as an uncaught exception.
    server.addEventListener('message', (e) => {
      if (typeof e.data === 'string') callbacks?.message(e.data);
    });
    server.addEventListener('close', () => callbacks?.close());
    server.addEventListener('error', () => callbacks?.close());
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/') || pathname === WS_PATH) {
      const headers = new Headers(request.headers);
      if (env.CF_VERSION_METADATA) headers.set(VERSION_HEADER, env.CF_VERSION_METADATA.id);
      // Read the body once, so the request can be sent again (bodies are small JSON).
      const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer();
      const forward = () => new Request(request.url, { method: request.method, headers, body });
      const hub = () => env.HUB.get(env.HUB.idFromName('mencherz'));
      try {
        return await hub().fetch(forward());
      } catch {
        // The object restarted to pick up this version; the next instance runs it.
        return hub().fetch(forward());
      }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
