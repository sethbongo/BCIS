import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { config } from '../config';
import { createDatabase, type Db } from './client';

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: config.migrationsDir });
}

// CLI: `npm run db:migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { db, pool } = createDatabase(config.databaseUrl, 2);
  runMigrations(db)
    .then(() => console.log('Migrations are up to date.'))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
