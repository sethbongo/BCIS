// First-time setup: creates .env with random local secrets (never committed).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENV_PATH, ROOT } from './env.mjs';

const secret = (bytes) => randomBytes(bytes).toString('base64url');

if (existsSync(ENV_PATH)) {
  console.log('.env already exists - leaving it untouched.');
} else {
  const dbPassword = secret(18);
  const demoPassword = `Bcis-${secret(6)}`;
  const env = readFileSync(join(ROOT, '.env.example'), 'utf8')
    .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=postgres://bcis:${dbPassword}@127.0.0.1:5433/bcis`)
    .replace(/^TEST_DATABASE_URL=.*$/m, `TEST_DATABASE_URL=postgres://bcis:${dbPassword}@127.0.0.1:5433/bcis_test`)
    .replace(/^SEED_DEMO_PASSWORD=.*$/m, `SEED_DEMO_PASSWORD=${demoPassword}`);
  writeFileSync(ENV_PATH, env);
  console.log('Created .env with generated local database and demo passwords.');
  console.log(`Demo user password (also stored in .env as SEED_DEMO_PASSWORD): ${demoPassword}`);
}
