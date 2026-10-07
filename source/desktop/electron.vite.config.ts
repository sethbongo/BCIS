import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

// Production builds get a strict Content-Security-Policy: scripts and styles only from the
// application bundle, no remote content, and no network access from the renderer at all
// (all API traffic goes through the main process). The dev server needs inline scripts
// and a websocket for hot reload, so the policy is applied to builds only.
function contentSecurityPolicy(): Plugin {
  const policy = ["default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ');
  return {
    name: 'bcis-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<!-- csp -->', `<meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

export default defineConfig({
  main: {
    build: { rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') } },
  },
  preload: {
    build: { rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  },
});
