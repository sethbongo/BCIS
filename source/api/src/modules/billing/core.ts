/**
 * Low-level invoice/ledger primitives shared by billing, payments and adjustments.
 * Every function here must be called inside a database transaction.
 *
 * Lock order (prevents deadlocks between office PCs): subscriber row -> invoice rows -> number sequence.
 */
import { deriveInvoiceStatus, invoiceBalance, type AllocationType, type LedgerSource, type OpenInvoice } from '@bcis/shared';
import { eq, sql } from 'drizzle-orm';
import { one, rows, type DbOrTx } from '../../db/client';
import { invoices, ledgerEntries, paymentAllocations } from '../../db/schema';
import { today } from '../../lib/context';
import { notFound } from '../../lib/errors';
import { OPEN } from '../../lib/sqlfrag';

export interface LockedInvoice extends OpenInvoice {
  serviceAccountId: number;
  total: number;
  adjustmentsTotal: number;
  amountPaid: number;
}

/** Serializes all financial activity of one subscriber across concurrent sessions. */
export async function lockSubscriber(tx: DbOrTx, subscriberId: number): Promise<{ id: number; accountNo: string; fullName: string; status: string }> {
  const row = await one<{ id: number; accountNo: string; fullName: string; status: string }>(
    tx,
    sql`select id, account_no as "accountNo", full_name as "fullName", status from subscribers where id = ${subscriberId} for update`,
  );
  if (!row) throw notFound('Subscriber');
  return row;
}

const INVOICE_LOCK_COLUMNS = sql`
  id, invoice_no as "invoiceNo", invoice_date as "invoiceDate", due_date as "dueDate", service_account_id as "serviceAccountId",
  total, adjustments_total as "adjustmentsTotal", amount_paid as "amountPaid", balance`;

/** Open invoices of a subscriber, oldest first, locked for the rest of the transaction. */
export async function lockOpenInvoices(tx: DbOrTx, subscriberId: number): Promise<LockedInvoice[]> {
  return rows<LockedInvoice>(
    tx,
    sql`select ${INVOICE_LOCK_COLUMNS} from invoices
         where subscriber_id = ${subscriberId} and status in ${OPEN} and balance > 0
         order by due_date, invoice_date, id for update`,
  );
}

export async function lockInvoice(tx: DbOrTx, invoiceId: number): Promise<LockedInvoice & { status: string; subscriberId: number }> {
  const row = await one<LockedInvoice & { status: string; subscriberId: number }>(
    tx,
    sql`select ${INVOICE_LOCK_COLUMNS}, status, subscriber_id as "subscriberId" from invoices where id = ${invoiceId} for update`,
  );
  if (!row) throw notFound('Invoice');
  return row;
}

/** Applies a change to an invoice's running amounts and re-derives its status from the single state machine. */
export async function updateInvoiceAmounts(tx: DbOrTx, inv: LockedInvoice, change: { paidDelta?: number; adjustmentDelta?: number }): Promise<void> {
  inv.amountPaid += change.paidDelta ?? 0;
  inv.adjustmentsTotal += change.adjustmentDelta ?? 0;
  inv.balance = invoiceBalance(inv);
  const status = deriveInvoiceStatus({ ...inv, finalized: true, voided: false }, today());
  await tx.update(invoices).set({ amountPaid: inv.amountPaid, adjustmentsTotal: inv.adjustmentsTotal, balance: inv.balance, status }).where(eq(invoices.id, inv.id));
}

export async function insertAllocation(
  tx: DbOrTx,
  args: { paymentId: number; invoice: LockedInvoice; amount: number; type: AllocationType; actorId: number },
): Promise<void> {
  await tx.insert(paymentAllocations).values({ paymentId: args.paymentId, invoiceId: args.invoice.id, amount: args.amount, type: args.type, createdBy: args.actorId });
  await updateInvoiceAmounts(tx, args.invoice, { paidDelta: args.amount });
}

export interface LedgerPost {
  subscriberId: number;
  serviceAccountId?: number | null;
  entryDate: string;
  sourceType: LedgerSource;
  sourceId: number;
  referenceNo: string;
  description: string;
  debit?: number;
  credit?: number;
  actorId: number;
}

/** Appends one debit or credit line to the subscriber ledger. Ledger rows are never updated or deleted. */
export async function postLedger(tx: DbOrTx, entry: LedgerPost): Promise<void> {
  await tx.insert(ledgerEntries).values({
    subscriberId: entry.subscriberId,
    serviceAccountId: entry.serviceAccountId ?? null,
    entryDate: entry.entryDate,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    referenceNo: entry.referenceNo,
    description: entry.description.slice(0, 200),
    debit: entry.debit ?? 0,
    credit: entry.credit ?? 0,
    createdBy: entry.actorId,
  });
}

/** Marks unpaid invoices whose due date has passed as OVERDUE. Safe to run at any time. */
export async function refreshOverdue(db: DbOrTx): Promise<number> {
  const updated = await rows(db, sql`update invoices set status = 'OVERDUE' where status = 'UNPAID' and due_date < ${today()} returning id`);
  return updated.length;
}
