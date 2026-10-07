import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

if (existsSync('.env')) process.loadEnvFile('.env');

// The acceptance suite runs against its own database (TEST_DATABASE_URL) and data folder,
// so it can never touch the development or production data.
const acceptanceEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
  DATA_DIR: 'tests/.tmp/data',
  LOG_LEVEL: 'silent',
};

export default defineConfig({
  test: {
    fileParallelism: false,
    projects: [
      {
        test: { name: 'unit', environment: 'node', include: ['source/**/*.test.ts'] },
      },
      {
        test: {
          name: 'acceptance',
          environment: 'node',
          include: ['tests/acceptance/**/*.test.ts'],
          globalSetup: ['tests/acceptance/global-setup.ts'],
          env: acceptanceEnv,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
