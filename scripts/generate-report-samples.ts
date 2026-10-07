/**
 * Writes sample PDF and XLSX reports from the demo database into reports-samples/.
 * Usage: npm run reports:samples   (after `npm run db:reset -- --yes`)
 */
import { sql } from 'drizzle-orm';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../source/api/src/config';
import { createDatabase, one } from '../source/api/src/db/client';
import type { Actor, Ctx } from '../source/api/src/lib/context';
import { today } from '../source/api/src/lib/context';
import { loadAuthUser } from '../source/api/src/modules/auth/service';
import { ReportQuery } from '../source/api/src/modules/reports/definitions';
import { exportReport } from '../source/api/src/modules/reports/service';

const outDir = join(config.rootDir, 'reports-samples');
const { db, pool } = createDatabase(config.databaseUrl, 4);

async function main(): Promise<void> {
  const owner = await one<{ id: number }>(db, sql`select u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where r.code = 'OWNER' order by u.id limit 1`);
  if (!owner) throw new Error('No owner user found. Seed the demo data first: npm run db:reset -- --yes');
  const actor: Actor = { ...(await loadAuthUser(db, owner.id))!, ip: null };
  const ctx: Ctx = { db, actor };
  // A subscriber with a varied history (several invoices and payments) makes the best sample statement.
  const subscriber = await one<{ id: number }>(
    db,
    sql`select s.id from subscribers s order by (select count(*) from ledger_entries l where l.subscriber_id = s.id) desc, s.id limit 1`,
  );
  const year = today().slice(0, 4);
  const yearStart = `${year}-01-01`;

  const samples: { file: string; key: string; params: Record<string, string | number> }[] = [
    { file: 'monthly-collection-report', key: 'collections', params: { from: yearStart, to: today(), groupBy: 'month' } },
    { file: 'daily-collection-report', key: 'collections', params: { groupBy: 'day' } },
    { file: 'payment-method-summary', key: 'payment-methods', params: { from: yearStart, to: today() } },
    { file: 'billing-vs-collection', key: 'billing-vs-collection', params: { year } },
    { file: 'revenue-by-plan', key: 'revenue', params: { from: yearStart, to: today(), dimension: 'plan' } },
    { file: 'ar-aging', key: 'ar-aging', params: {} },
    { file: 'overdue-accounts', key: 'overdue', params: {} },
    { file: 'subscriber-master-list', key: 'subscriber-master', params: {} },
    { file: 'subscriber-statement-of-account', key: 'subscriber-soa', params: { subscriberId: subscriber!.id, from: yearStart, to: today() } },
    { file: 'collector-performance', key: 'collector-performance', params: { from: yearStart, to: today() } },
    { file: 'collector-remittance-shortage-overage', key: 'collector-remittance', params: { from: yearStart, to: today() } },
    { file: 'payment-reversals-voided-receipts', key: 'reversals', params: { from: yearStart, to: today() } },
    { file: 'invoice-adjustments', key: 'adjustments', params: { from: yearStart, to: today() } },
    { file: 'user-activity', key: 'user-activity', params: { from: yearStart, to: today() } },
  ];

  await mkdir(outDir, { recursive: true });
  for (const sample of samples) {
    for (const format of ['pdf', 'xlsx'] as const) {
      const file = await exportReport(ctx, sample.key, ReportQuery.parse({ ...sample.params, format }));
      await writeFile(join(outDir, `${sample.file}.${format}`), file.data);
    }
    console.log(`  ${sample.file}.pdf / .xlsx`);
  }
  console.log(`\n${samples.length * 2} sample files written to reports-samples/`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
