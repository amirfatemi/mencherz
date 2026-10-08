import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const api = `http://localhost:${process.env.PORT ?? 3000}`;

export default defineConfig({
  root: 'client',
  plugins: [react()],
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
