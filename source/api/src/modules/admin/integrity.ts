import type { IntegrityCheck, IntegrityReport } from '@bcis/shared';
import { sql, type SQL } from 'drizzle-orm';
import { one, type DbOrTx } from '../../db/client';
import { OPEN } from '../../lib/sqlfrag';

interface CheckDef {
  name: string;
  description: string;
  /** Query returning one row { violations } - the number of records breaking the rule. */
  query: SQL;
}

/**
 * Independent cross-checks of the financial data. Each rule is verified from the raw tables,
 * not from the code paths that maintain them, so a bug in a service would show up here.
 * Run after every restore and on demand from Administration.
 */
const CHECKS: CheckDef[] = [
  {
    name: 'Invoice balance arithmetic',
    description: 'balance = total + adjustments - payments for every finalized invoice',
    query: sql`select count(*) as violations from invoices where status not in ('DRAFT','VOID') and balance <> total + adjustments_total - amount_paid`,
  },
  {
    name: 'Invoice payments match allocations',
    description: 'amount paid on each invoice equals its non-reversed payment allocations',
    query: sql`select count(*) as violations from invoices i
                where i.status not in ('DRAFT','VOID')
                  and i.amount_paid <> (select coalesce(sum(pa.amount), 0) from payment_allocations pa where pa.invoice_id = i.id and not pa.is_reversed)`,
  },
  {
    name: 'Invoice adjustments match adjustment records',
    description: 'net adjustments on each invoice equal its posted debit and credit adjustments',
    query: sql`select count(*) as violations from invoices i
                where i.status <> 'DRAFT'
                  and i.adjustments_total <> (select coalesce(sum(case when a.type = 'DEBIT' then a.amount else -a.amount end), 0) from adjustments a where a.invoice_id = i.id)`,
  },
  {
    name: 'No payment value lost',
    description: 'for every posted payment: allocations + unapplied credit = amount received',
    query: sql`select count(*) as violations from payments p
                where (p.status = 'POSTED' and p.amount <> p.unapplied_amount + (select coalesce(sum(pa.amount), 0) from payment_allocations pa where pa.payment_id = p.id and not pa.is_reversed))
                   or (p.status = 'REVERSED' and exists (select 1 from payment_allocations pa where pa.payment_id = p.id and not pa.is_reversed))`,
  },
  {
    name: 'Ledger reconciles to invoices and credits',
    description: 'each subscriber ledger balance = open invoice balances - unapplied advance credit',
    query: sql`select count(*) as violations from subscribers s
                where (select coalesce(sum(l.debit - l.credit), 0) from ledger_entries l where l.subscriber_id = s.id)
                   <> (select coalesce(sum(i.balance), 0) from invoices i where i.subscriber_id = s.id and i.status in ${OPEN})
                    - (select coalesce(sum(p.unapplied_amount), 0) from payments p where p.subscriber_id = s.id and p.status = 'POSTED')`,
  },
  {
    name: 'Every invoice and payment is in the ledger once',
    description: 'one ledger debit per finalized invoice and one ledger credit per payment, for the same amount',
    query: sql`select (
                 (select count(*) from invoices i where i.status <> 'DRAFT' and i.total > 0
                    and (select count(*) from ledger_entries l where l.source_type = 'INVOICE' and l.source_id = i.id and l.debit = i.total) <> 1)
               + (select count(*) from payments p
                   where (select count(*) from ledger_entries l where l.source_type = 'PAYMENT' and l.source_id = p.id and l.credit = p.amount) <> 1)
               + (select count(*) from payment_reversals pr
                   where (select count(*) from ledger_entries l where l.source_type = 'PAYMENT_REVERSAL' and l.source_id = pr.payment_id and l.debit = pr.amount) <> 1)
               ) as violations`,
  },
  {
    name: 'Receipts match payments',
    description: 'every payment has exactly one receipt; reversed payments have a VOID receipt and a reversal record',
    query: sql`select count(*) as violations from payments p
                left join receipts r on r.payment_id = p.id
                where r.id is null
                   or (p.status = 'POSTED' and r.status <> 'ISSUED')
                   or (p.status = 'REVERSED' and (r.status <> 'VOID' or not exists (select 1 from payment_reversals pr where pr.payment_id = p.id)))`,
  },
  {
    name: 'No duplicate billing',
    description: 'at most one live invoice per service account and billing period',
    query: sql`select count(*) as violations from (
                 select 1 from invoices where billing_period is not null and status <> 'VOID' group by service_account_id, billing_period having count(*) > 1) d`,
  },
  {
    name: 'Document numbers are unique',
    description: 'no repeated invoice or receipt numbers',
    query: sql`select ((select count(*) - count(distinct receipt_no) from receipts) + (select count(invoice_no) - count(distinct invoice_no) from invoices)) as violations`,
  },
  {
    name: 'Closed batches carry an explicit variance',
    description: 'reconciled and closed batches record difference = remitted - collected, with a reason when not balanced',
    query: sql`select count(*) as violations from collection_batches
                where status in ('RECONCILED','CLOSED')
                  and (variance_type is null or difference <> cash_remitted - cash_collected or (difference <> 0 and variance_reason is null))`,
  },
];

export async function runIntegrityCheck(db: DbOrTx): Promise<IntegrityReport> {
  const checks: IntegrityCheck[] = [];
  for (const check of CHECKS) {
    const row = await one<{ violations: number }>(db, check.query);
    const violations = Number(row?.violations ?? 0);
    checks.push({ name: check.name, description: check.description, ok: violations === 0, violations, detail: violations === 0 ? 'Passed' : `${violations} record(s) violate this rule` });
  }
  return { ok: checks.every((c) => c.ok), checkedAt: new Date().toISOString(), checks };
}
