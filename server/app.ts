import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { WS_PATH } from '../shared/wire.ts';
import { createGameServer } from './core.ts';
import { openSqlite } from './sqlite.ts';

// Runs the game server on Node: Express for the built client, the `ws` package for sockets and a
// SQLite file for storage. The same server runs on Cloudflare via worker/index.ts.

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  secureCookies: boolean;
  trustProxy: boolean;
  /** Built client to serve; skipped if missing. */
  clientDir: string | null;
  /** Extra origins allowed to open a socket, besides the server's own host. */
  allowedOrigins?: string[];
  /** Multiplies bot/turn delays. Tests use a small value. */
  timeScale?: number;
}

/** Turns a Node request into a fetch Request for the shared API handler. */
async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, {
    method: req.method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });
}

export async function startServer(config: ServerConfig) {
  const db = openSqlite(config.dbPath);
  const game = createGameServer({
    db,
    secureCookies: config.secureCookies,
    allowedOrigins: config.allowedOrigins,
    timeScale: config.timeScale,
  });

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use('/api', async (req, res) => {
    const response = await game.api(await toRequest(req), req.ip ?? '');
    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (key !== 'set-cookie') res.setHeader(key, value);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader('set-cookie', cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  });

  const clientDir = config.clientDir;
  if (clientDir && existsSync(clientDir)) {
    app.use('/assets', express.static(join(clientDir, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(clientDir, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(join(clientDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => void res.type('text').send('Client not built. Run `npm run dev` or `npm run build`.'));
  }

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  httpServer.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== WS_PATH) return void socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      const callbacks = game.connect(
        { send: (text) => ws.send(text), close: (code, reason) => ws.close(code, reason) },
        { cookie: req.headers.cookie, origin: req.headers.origin, host: req.headers.host },
      );
      if (!callbacks) return;
      ws.on('message', (data, isBinary) => {
        if (!isBinary) callbacks.message(data.toString());
      });
      ws.on('close', callbacks.close);
      ws.on('error', callbacks.close);
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(config.port, config.host, resolve));
  const port = (httpServer.address() as AddressInfo).port;

  async function close() {
    game.shutdown();
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    db.close();
  }

  return { port, close };
}
