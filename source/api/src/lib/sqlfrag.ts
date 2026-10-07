/** Reusable raw SQL fragments. All are constants written by developers - never user input. */
import { sql, type SQL } from 'drizzle-orm';

/** Finalized invoice states that still carry a balance. */
export const OPEN = sql.raw(`('UNPAID','PARTIALLY_PAID','OVERDUE')`);

export const address = (alias: string): SQL => sql.raw(`(${alias}.line1 || ', ' || ${alias}.barangay || ', ' || ${alias}.city)`);

/** Sum of open invoice balances for the subscriber row aliased `s`. */
export const outstandingOf = (alias = 's'): SQL =>
  sql.raw(`(select coalesce(sum(i.balance), 0) from invoices i where i.subscriber_id = ${alias}.id and i.status in ('UNPAID','PARTIALLY_PAID','OVERDUE'))`);

/** Unapplied advance credit held on posted payments for the subscriber row aliased `s`. */
export const creditOf = (alias = 's'): SQL =>
  sql.raw(`(select coalesce(sum(p.unapplied_amount), 0) from payments p where p.subscriber_id = ${alias}.id and p.status = 'POSTED')`);

/** Net account balance = outstanding invoices - advance credit. Always equals the ledger balance. */
export const balanceOf = (alias = 's'): SQL => sql`(${outstandingOf(alias)} - ${creditOf(alias)})::bigint`;
