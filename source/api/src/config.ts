import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Walks up from this file until the repository root (the folder that holds database/migrations). */
function findRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'database', 'migrations'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export const ROOT_DIR = process.env.BCIS_ROOT ? resolve(process.env.BCIS_ROOT) : findRoot();

const envFile = join(ROOT_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const Env = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required. Run `npm run setup` or create .env from .env.example.'),
  TEST_DATABASE_URL: z.string().optional(),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_TIMEZONE: z.string().default('Asia/Manila'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  DATA_DIR: z.string().default('./data'),
  PG_BIN_DIR: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  NODE_ENV: z.string().default('development'),
  SEED_DEMO_PASSWORD: z.string().optional(),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}
const env = parsed.data;
const dataDir = isAbsolute(env.DATA_DIR) ? env.DATA_DIR : join(ROOT_DIR, env.DATA_DIR);

export const config = {
  rootDir: ROOT_DIR,
  databaseUrl: env.DATABASE_URL,
  testDatabaseUrl: env.TEST_DATABASE_URL,
  host: env.API_HOST,
  port: env.API_PORT,
  timeZone: env.APP_TIMEZONE,
  sessionTtlHours: env.SESSION_TTL_HOURS,
  sessionIdleMinutes: env.SESSION_IDLE_MINUTES,
  dataDir,
  attachmentsDir: join(dataDir, 'attachments'),
  backupsDir: join(dataDir, 'backups'),
  logsDir: join(dataDir, 'logs'),
  migrationsDir: join(ROOT_DIR, 'database', 'migrations'),
  pgBinDir: env.PG_BIN_DIR,
  logLevel: env.LOG_LEVEL,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  seedDemoPassword: env.SEED_DEMO_PASSWORD,
  version: '1.0.0',
};

export type AppConfig = typeof config;
