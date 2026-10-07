/**
 * Creates and verifies a backup from the command line, for Windows Task Scheduler.
 *   npm run backup:create
 * The backup is recorded under the first active Owner account, exactly like a backup made in the app.
 */
import { sql } from 'drizzle-orm';
import { config } from '../source/api/src/config';
import { createDatabase, one } from '../source/api/src/db/client';
import type { Actor } from '../source/api/src/lib/context';
import { createBackup, verifyBackup } from '../source/api/src/modules/admin/backup';
import { loadAuthUser } from '../source/api/src/modules/auth/service';

const { db, pool } = createDatabase(config.databaseUrl, 2);

async function main(): Promise<void> {
  const owner = await one<{ id: number }>(db, sql`select u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where r.code = 'OWNER' and u.is_active order by u.id limit 1`);
  if (!owner) throw new Error('No active Owner account exists. Create one with `npm run owner:create`.');
  const actor: Actor = { ...(await loadAuthUser(db, owner.id))!, ip: null };
  const backup = await createBackup({ db, actor }, 'Scheduled backup (command line)');
  const verified = await verifyBackup({ db, actor }, backup.id);
  console.log(`${verified.name}: ${verified.status} - ${verified.verificationResult}`);
  console.log(`Folder: ${config.backupsDir}`);
  if (verified.status !== 'VERIFIED') process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
