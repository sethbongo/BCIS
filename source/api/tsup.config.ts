import { defineConfig } from 'tsup';

// Production bundle of the API server. Third-party packages stay external (installed with
// `npm ci --omit=dev`); the shared workspace package is compiled in.
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@bcis/shared'],
});
