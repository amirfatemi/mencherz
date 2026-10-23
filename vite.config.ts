import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// Shown in the app, so it's always clear which build is running: the package version, the build date and
// the commit (Cloudflare's build passes it in WORKERS_CI_COMMIT_SHA).
function commit(): string {
  if (process.env.WORKERS_CI_COMMIT_SHA) return process.env.WORKERS_CI_COMMIT_SHA;
  try {
    return execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
  } catch {
    return 'dev';
  }
}
const { version } = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as { version: string };
const appVersion = `${version} · ${new Date().toISOString().slice(0, 10)} · ${commit().slice(0, 7)}`;
const api = `http://localhost:${process.env.PORT ?? 3000}`;

export default defineConfig({
  root: 'client',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: {
    port: 5173,
    fs: { allow: [root] },
    proxy: {
      '/api': api,
      '/ws': { target: api, ws: true },
    },
  },
});
