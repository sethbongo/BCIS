/**
 * Runs once before the acceptance suite: rebuilds the TEST database from the migrations,
 * seeds the base reference data and creates one user per role.
 */
import { existsSync, rmSync } from 'node:fs';

export const TEST_PASSWORD = 'Acceptance-Test-1';

export default async function setup(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('TEST_DATABASE_URL is not set. Run `npm run setup` and `npm run db:start` first.');
  if (testUrl === process.env.DATABASE_URL && !process.env.NODE_ENV) throw new Error('TEST_DATABASE_URL must not point at the main database.');
  process.env.DATABASE_URL = testUrl;
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = 'tests/.tmp/data';
  // Only the test data folder is cleared; other files in tests/.tmp (e2e results) are kept.
  rmSync('tests/.tmp/data', { recursive: true, force: true });

  const { sql } = await import('drizzle-orm');
  const { ROLES } = await import('@bcis/shared');
  const { createDatabase } = await import('../../source/api/src/db/client');
  const { runMigrations } = await import('../../source/api/src/db/migrate');
  const { hashPassword } = await import('../../source/api/src/lib/passwords');
  const { users } = await import('../../source/api/src/db/schema');
  const { seedBase } = await import('../../database/seeds/base');

  const { db, pool } = createDatabase(testUrl, 2);
  try {
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema public cascade`);
    await db.execute(sql`create schema public`);
    await runMigrations(db);
    await seedBase(db);
    const passwordHash = await hashPassword(TEST_PASSWORD);
    for (const role of ROLES) {
      const [user] = await db.insert(users).values({ username: role.code.toLowerCase(), fullName: `Test ${role.name}`, passwordHash }).returning({ id: users.id });
      await db.execute(sql`insert into user_roles (user_id, role_id) select ${user.id}, id from roles where code = ${role.code}`);
    }
  } finally {
    await pool.end();
  }
}
