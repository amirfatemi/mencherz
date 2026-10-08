import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './app.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

const server = await startServer({
  port: Number(env.PORT ?? 3000),
  host: env.HOST ?? '0.0.0.0',
  dbPath: env.DB_PATH ?? join(root, 'data', 'mencherz.db'),
  secureCookies: env.COOKIE_SECURE === 'true',
  trustProxy: env.TRUST_PROXY === 'true',
  allowedOrigins: env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean),
  admins: env.ADMINS?.split(',').map((s) => s.trim()).filter(Boolean),
  clientDir: join(root, 'dist', 'client'),
});
console.log(`Mencherz listening on http://localhost:${server.port}`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(0), 3000).unref();
  await server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
