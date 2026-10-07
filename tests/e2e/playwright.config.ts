import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));

/**
 * End-to-end tests drive the real Electron client against the real API and the demo database.
 * Prerequisites: `npm run db:start`, `npm run db:reset -- --yes`, `npm run build -w @bcis/desktop`.
 */
export default defineConfig({
  testDir: here,
  outputDir: resolve(root, 'test-results'),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: resolve(root, 'tests/.tmp/e2e-results.json') }]],
  webServer: {
    command: 'npx tsx source/api/src/server.ts',
    cwd: root,
    url: `http://127.0.0.1:${process.env.API_PORT ?? 4000}/api/health`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
