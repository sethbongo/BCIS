/**
 * Seed runner.
 *   npm run db:seed          migrations + base reference data (roles, permissions, sequences)
 *   npm run db:seed:demo     base + synthetic demo dataset (only into an empty database)
 *   npm run db:reset -- --yes   DROPS ALL DATA, then migrations + base + demo
 */
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { config } from '../../source/api/src/config';
import { createDatabase, one } from '../../source/api/src/db/client';
import { runMigrations } from '../../source/api/src/db/migrate';
import { runIntegrityCheck } from '../../source/api/src/modules/admin/integrity';
import { seedBase } from './base';
import { seedDemo } from './demo';

const command = process.argv[2] ?? 'base';
const { db, pool } = createDatabase(config.databaseUrl, 4);

async function demo(): Promise<void> {
  const existing = await one<{ n: number }>(db, sql`select count(*) as n from users`);
  if (existing && existing.n > 0) {
    throw new Error('This database already contains data. Use `npm run db:reset -- --yes` to rebuild the demo database from scratch.');
  }
  const password = config.seedDemoPassword ?? `Bcis-${randomBytes(6).toString('base64url')}1a`;
  await seedDemo(db, password);
  const integrity = await runIntegrityCheck(db);
  console.log(`Integrity check: ${integrity.ok ? 'PASSED' : 'FAILED'}`);
  for (const check of integrity.checks.filter((c) => !c.ok)) console.log(`  FAILED ${check.name}: ${check.detail}`);
  console.log('\nDemo users: owner, admin, cashier, supervisor, auditor, tech, viewer');
  console.log(config.seedDemoPassword ? 'Password: the SEED_DEMO_PASSWORD value in your .env file' : `Password (generated, shown once): ${password}`);
  if (!integrity.ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  if (command === 'reset') {
    if (!process.argv.includes('--yes')) throw new Error('db:reset deletes ALL data in the database. Re-run as: npm run db:reset -- --yes');
    if (config.isProduction) throw new Error('db:reset is disabled when NODE_ENV=production.');
    console.log(`Resetting ${new URL(config.databaseUrl).pathname.slice(1)} ...`);
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema public cascade`);
    await db.execute(sql`create schema public`);
  } else if (command !== 'base' && command !== 'demo') {
    throw new Error(`Unknown seed command "${command}". Use base, demo or reset.`);
  }
  await runMigrations(db);
  await seedBase(db);
  console.log('Migrations applied and base reference data seeded.');
  if (command !== 'base') await demo();
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    if (process.env.DEBUG) console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
