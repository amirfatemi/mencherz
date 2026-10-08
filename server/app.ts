import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServer, ServerToClient } from '../shared/protocol.ts';
import { createAuth } from './auth.ts';
import { openDb } from './db.ts';
import { createRooms, type SocketData } from './rooms.ts';

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

export async function startServer(config: ServerConfig) {
  const db = openDb(config.dbPath);
  const auth = createAuth(db, { secureCookies: config.secureCookies });

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health', (_req, res) => void res.json({ ok: true }));
  app.use('/api', auth.router);
  app.use('/api', (_req, res) => void res.status(404).json({ error: 'Not found' }));

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
  const io = new Server<ClientToServer, ServerToClient, Record<string, never>, SocketData>(httpServer, {
    serveClient: false,
    pingInterval: 20000,
    pingTimeout: 20000,
    // Browsers attach the session cookie to cross-site WebSocket handshakes too; only accept our own pages.
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      if (!origin) return cb(null, true);
      try {
        cb(null, new URL(origin).host === req.headers.host || !!config.allowedOrigins?.includes(origin));
      } catch {
        cb(null, false);
      }
    },
  });

  io.use((socket, next) => {
    const user = auth.userFromCookieHeader(socket.handshake.headers.cookie);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  const rooms = createRooms(io, db, auth, { timeScale: config.timeScale ?? 1 });
  io.on('connection', (socket) => rooms.connect(socket));

  await new Promise<void>((resolve) => httpServer.listen(config.port, config.host, resolve));
  const port = (httpServer.address() as AddressInfo).port;

  async function close() {
    rooms.shutdown();
    await io.close();
    db.close();
  }

  return { port, close };
}
