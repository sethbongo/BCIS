import {
  allocateManually,
  allocateOldestFirst,
  PAYMENT_METHOD_LABELS,
  type AllocationPreview,
  type AllocationResult,
  type ListQuery,
  type Paged,
  type PaymentAllocationRow,
  type PaymentDetail,
  type PaymentInput,
  type PaymentPreviewInput,
  type PaymentRow,
} from '@bcis/shared';
import { eq, sql } from 'drizzle-orm';
import { contains, iso, one, paged, rows, where, type DbOrTx } from '../../db/client';
import { batchAccounts, paymentAllocations, paymentProofs, paymentReversals, payments, receipts } from '../../db/schema';
import { removeAttachment, saveAttachment, type StoredAttachment } from '../../lib/attachments';
import { audit } from '../../lib/audit';
import { can, today, type Actor, type Ctx } from '../../lib/context';
import { conflict, forbidden, invalid, notFound } from '../../lib/errors';
import { nextNumber } from '../../lib/sequences';
import { getSettings } from '../../lib/settings';
import { address, OPEN } from '../../lib/sqlfrag';
import { insertAllocation, lockOpenInvoices, lockSubscriber, postLedger, updateInvoiceAmounts, type LockedInvoice } from '../billing/core';

function allocate(open: LockedInvoice[], input: Pick<PaymentPreviewInput, 'amount' | 'allocations'>): AllocationResult {
  return input.allocations ? allocateManually(open, input.amount, input.allocations) : allocateOldestFirst(open, input.amount);
}

/** Shows the cashier exactly where the money will go before anything is posted. */
export async function previewAllocation({ db, actor }: Ctx, input: PaymentPreviewInput): Promise<AllocationPreview> {
  if (input.allocations && !can(actor, 'payment.allocate_manual')) throw forbidden('Manual allocation requires additional authorization.');
  const open = await rows<LockedInvoice>(
    db,
    sql`select id, invoice_no as "invoiceNo", invoice_date as "invoiceDate", due_date as "dueDate", service_account_id as "serviceAccountId",
          total, adjustments_total as "adjustmentsTotal", amount_paid as "amountPaid", balance
        from invoices where subscriber_id = ${input.subscriberId} and status in ${OPEN} and balance > 0 order by due_date, invoice_date, id`,
  );
  const result = allocate(open, input);
  const outstandingBefore = open.reduce((sum, inv) => sum + inv.balance, 0);
  return { subscriberId: input.subscriberId, amount: input.amount, outstandingBefore, outstandingAfter: outstandingBefore - result.totalApplied, ...result };
}

export interface PostingOptions {
  collectionBatchId?: number;
  collectorId?: number;
}

/**
 * Posts a payment inside the caller's transaction:
 *   lock subscriber -> lock open invoices -> allocate -> payment + allocations ->
 *   invoice balances/status -> receipt number -> ledger credit -> audit.
 * If any step fails the whole transaction rolls back, so a payment can never exist
 * without its allocations, receipt and ledger entry (or vice versa).
 */
export async function postPaymentTx(tx: DbOrTx, actor: Actor, input: PaymentInput, options: PostingOptions = {}): Promise<number> {
  const paymentDate = input.paymentDate ?? today();
  if (paymentDate > today()) throw invalid('The payment date cannot be in the future.', { paymentDate: 'Cannot be in the future' });
  if (input.allocations && !can(actor, 'payment.allocate_manual')) throw forbidden('Manual allocation requires additional authorization.');
  const referenceNo = input.referenceNo?.trim() || null;

  const subscriber = await lockSubscriber(tx, input.subscriberId);
  if (subscriber.status === 'ARCHIVED') throw invalid('This subscriber is archived and cannot receive payments.');

  if (input.method === 'GCASH' && referenceNo) {
    const used = await one<{ receiptNo: string }>(
      tx,
      sql`select r.receipt_no as "receiptNo" from payments p join receipts r on r.payment_id = p.id
           where p.method = 'GCASH' and p.status = 'POSTED' and upper(p.reference_no) = upper(${referenceNo})`,
    );
    if (used) throw conflict('DUPLICATE_GCASH_REFERENCE', `GCash reference ${referenceNo} was already posted under receipt ${used.receiptNo}. The payment was not posted.`);
  }

  const open = await lockOpenInvoices(tx, input.subscriberId);
  const result = allocate(open, input);

  const [payment] = await tx
    .insert(payments)
    .values({
      subscriberId: input.subscriberId,
      paymentDate,
      amount: input.amount,
      method: input.method,
      referenceNo,
      notes: input.notes || null,
      unappliedAmount: result.unapplied,
      receivedBy: actor.id,
      collectorId: options.collectorId ?? null,
      collectionBatchId: options.collectionBatchId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    })
    .returning({ id: payments.id });

  for (const line of result.lines) {
    await insertAllocation(tx, {
      paymentId: payment.id,
      invoice: open.find((inv) => inv.id === line.invoiceId)!,
      amount: line.applied,
      type: input.allocations ? 'MANUAL' : 'AUTO',
      actorId: actor.id,
    });
  }

  // The receipt number is taken last so the sequence row lock is held as briefly as possible.
  const receiptNo = await nextNumber(tx, 'RECEIPT');
  await tx.insert(receipts).values({ receiptNo, paymentId: payment.id, issuedBy: actor.id });
  await postLedger(tx, {
    subscriberId: input.subscriberId,
    entryDate: paymentDate,
    sourceType: 'PAYMENT',
    sourceId: payment.id,
    referenceNo: receiptNo,
    description: `${PAYMENT_METHOD_LABELS[input.method]} Payment${referenceNo ? ` (Ref ${referenceNo})` : ''}`,
    credit: input.amount,
    actorId: actor.id,
  });
  await audit(tx, actor, {
    action: 'payment.post',
    entityType: 'payment',
    entityId: payment.id,
    subscriberId: input.subscriberId,
    newValues: {
      receiptNo,
      amount: input.amount,
      method: input.method,
      referenceNo,
      paymentDate,
      allocation: input.allocations ? 'MANUAL' : 'OLDEST_FIRST',
      allocations: result.lines.map((l) => ({ invoiceNo: l.invoiceNo, applied: l.applied })),
      unapplied: result.unapplied,
      batchId: options.collectionBatchId ?? null,
    },
  });
  return payment.id;
}

/** Receive Payment screen. GCash sent as a screenshot must go through the verification queue instead. */
export async function postPayment(ctx: Ctx, input: PaymentInput): Promise<PaymentDetail> {
  const { db, actor } = ctx;
  if (input.method === 'GCASH' && !can(actor, 'gcash.verify')) {
    throw forbidden('GCash payments must be recorded in GCash Verification and approved by an authorized verifier before posting.');
  }
  if (input.idempotencyKey) {
    const existing = await one<{ id: number }>(db, sql`select id from payments where idempotency_key = ${input.idempotencyKey}`);
    if (existing) return getPayment(db, existing.id);
  }
  let stored: StoredAttachment | null = null;
  if (input.proof) stored = await saveAttachment(input.proof);
  try {
    const paymentId = await db.transaction(async (tx) => {
      const id = await postPaymentTx(tx, actor, input);
      if (stored) {
        const subscriber = await one<{ fullName: string; phone: string }>(tx, sql`select full_name as "fullName", phone from subscribers where id = ${input.subscriberId}`);
        await tx.insert(paymentProofs).values({
          ...stored,
          subscriberId: input.subscriberId,
          paymentId: id,
          method: input.method,
          referenceNo: input.referenceNo || 'N/A',
          senderName: subscriber!.fullName,
          senderNumber: subscriber!.phone,
          amount: input.amount,
          transactionDate: input.paymentDate ?? today(),
          status: 'VERIFIED',
          submittedBy: actor.id,
          reviewedBy: actor.id,
          reviewedAt: new Date(),
        });
      }
      return id;
    });
    return await getPayment(db, paymentId);
  } catch (err) {
    if (stored) await removeAttachment(stored.storedName);
    throw err;
  }
}

/**
 * Corrects a wrongly posted payment without destroying history. The original payment,
 * its allocations and receipt stay in the database (marked REVERSED / VOID); a linked
 * reversal record and an offsetting ledger debit restore the balances.
 */
export async function reversePayment({ db, actor }: Ctx, paymentId: number, reason: string): Promise<PaymentDetail> {
  await db.transaction(async (tx) => {
    const head = await one<{ subscriberId: number }>(tx, sql`select subscriber_id as "subscriberId" from payments where id = ${paymentId}`);
    if (!head) throw notFound('Payment');
    await lockSubscriber(tx, head.subscriberId);
    const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
    if (payment.status !== 'POSTED') throw conflict('ALREADY_REVERSED', 'This payment has already been reversed.');
    const [receipt] = await tx.select().from(receipts).where(eq(receipts.paymentId, paymentId)).for('update');

    const active = await rows<{ id: number; invoiceId: number; amount: number }>(
      tx,
      sql`select id, invoice_id as "invoiceId", amount from payment_allocations where payment_id = ${paymentId} and not is_reversed order by id`,
    );
    const restored: { invoiceNo: string; restored: number; balance: number }[] = [];
    for (const allocation of active) {
      const inv = await one<LockedInvoice & { status: string }>(
        tx,
        sql`select id, invoice_no as "invoiceNo", invoice_date as "invoiceDate", due_date as "dueDate", service_account_id as "serviceAccountId",
              total, adjustments_total as "adjustmentsTotal", amount_paid as "amountPaid", balance, status
            from invoices where id = ${allocation.invoiceId} for update`,
      );
      if (!inv) throw notFound('Invoice');
      if (inv.status !== 'VOID') await updateInvoiceAmounts(tx, inv, { paidDelta: -allocation.amount });
      await tx.update(paymentAllocations).set({ isReversed: true, reversedAt: new Date() }).where(eq(paymentAllocations.id, allocation.id));
      restored.push({ invoiceNo: inv.invoiceNo, restored: allocation.amount, balance: inv.balance });
    }

    const reversalNo = await nextNumber(tx, 'REVERSAL');
    await tx.insert(paymentReversals).values({ reversalNo, paymentId, amount: payment.amount, reason, reversedBy: actor.id });
    await tx.update(payments).set({ status: 'REVERSED', unappliedAmount: 0 }).where(eq(payments.id, paymentId));
    // The receipt is voided but keeps its number forever; the number is never issued again.
    await tx.update(receipts).set({ status: 'VOID', voidedBy: actor.id, voidedAt: new Date(), voidReason: reason }).where(eq(receipts.id, receipt.id));
    await postLedger(tx, {
      subscriberId: payment.subscriberId,
      entryDate: today(),
      sourceType: 'PAYMENT_REVERSAL',
      sourceId: paymentId,
      referenceNo: reversalNo,
      description: `Reversal of ${receipt.receiptNo}: ${reason}`,
      debit: payment.amount,
      actorId: actor.id,
    });

    // An open collection batch stops counting the reversed collection.
    if (payment.collectionBatchId) {
      await tx.execute(sql`
        update batch_accounts ba set collected_amount = greatest(ba.collected_amount - ${payment.amount}, 0),
               outcome = case when ba.collected_amount - ${payment.amount} <= 0 then 'PENDING'::batch_outcome else 'PARTIAL'::batch_outcome end
          from collection_batches b
         where b.id = ba.batch_id and ba.batch_id = ${payment.collectionBatchId} and ba.subscriber_id = ${payment.subscriberId}
           and b.status in ('OPEN','IN_PROGRESS')`);
    }

    await audit(tx, actor, {
      action: 'payment.reverse',
      entityType: 'payment',
      entityId: paymentId,
      subscriberId: payment.subscriberId,
      reason,
      oldValues: { status: 'POSTED', receiptNo: receipt.receiptNo, receiptStatus: 'ISSUED', amount: payment.amount, unappliedAmount: payment.unappliedAmount },
      newValues: { status: 'REVERSED', receiptStatus: 'VOID', reversalNo, restoredInvoices: restored },
    });
  });
  return getPayment(db, paymentId);
}

// ===================================================================
// Queries
// ===================================================================
const paymentSelect = sql`
  select p.id, r.receipt_no as "receiptNo", r.status as "receiptStatus", p.subscriber_id as "subscriberId", s.account_no as "subscriberAccountNo",
    s.full_name as "subscriberName", p.payment_date as "paymentDate", ${iso('p.paid_at')} as "paidAt", p.amount, p.method, p.reference_no as "referenceNo",
    p.status, p.unapplied_amount as "unappliedAmount", u.full_name as "receivedByName", c.full_name as "collectorName", b.batch_no as "batchNo"
  from payments p
  join receipts r on r.payment_id = p.id
  join subscribers s on s.id = p.subscriber_id
  left join users u on u.id = p.received_by
  left join collectors c on c.id = p.collector_id
  left join collection_batches b on b.id = p.collection_batch_id`;

export async function listPayments(db: DbOrTx, q: ListQuery): Promise<Paged<PaymentRow>> {
  const term = q.q ? contains(q.q) : null;
  const base = sql`${paymentSelect} ${where(
    term && sql`(r.receipt_no ilike ${term} or p.reference_no ilike ${term} or s.full_name ilike ${term} or s.account_no ilike ${term})`,
    q.status && sql`p.status = ${q.status}`,
    q.method && sql`p.method = ${q.method}`,
    q.subscriberId && sql`p.subscriber_id = ${q.subscriberId}`,
    q.collectorId && sql`p.collector_id = ${q.collectorId}`,
    q.from && sql`p.payment_date >= ${q.from}`,
    q.to && sql`p.payment_date <= ${q.to}`,
  )}`;
  return paged<PaymentRow>(
    db,
    base,
    q,
    { receiptNo: '"receiptNo"', subscriberName: '"subscriberName"', paymentDate: '"paymentDate"', amount: 'amount', method: 'method', status: 'status' },
    '"paymentDate" desc, id desc',
  );
}

export async function getPayment(db: DbOrTx, id: number): Promise<PaymentDetail> {
  const head = await one<PaymentRow & { notes: string | null; address: string }>(
    db,
    sql`select t.*, x.notes, coalesce(${address('a')}, '') as address
          from (${paymentSelect} where p.id = ${id}) t
          join payments x on x.id = t.id
          left join subscriber_addresses a on a.subscriber_id = x.subscriber_id and a.is_primary`,
  );
  if (!head) throw notFound('Payment');
  const [allocations, reversal, proof, balance, settings] = await Promise.all([
    rows<PaymentAllocationRow>(
      db,
      sql`select pa.id, pa.invoice_id as "invoiceId", i.invoice_no as "invoiceNo", i.billing_period as "billingPeriod",
            coalesce((select ii.description from invoice_items ii where ii.invoice_id = i.id order by ii.id limit 1), '') as description,
            pa.amount, pa.type, pa.is_reversed as "isReversed"
          from payment_allocations pa join invoices i on i.id = pa.invoice_id where pa.payment_id = ${id} order by pa.id`,
    ),
    one<NonNullable<PaymentDetail['reversal']>>(
      db,
      sql`select pr.reversal_no as "reversalNo", pr.reason, u.full_name as "reversedByName", ${iso('pr.reversed_at')} as "reversedAt"
            from payment_reversals pr left join users u on u.id = pr.reversed_by where pr.payment_id = ${id}`,
    ),
    one<{ id: number }>(db, sql`select id from payment_proofs where payment_id = ${id} order by id limit 1`),
    one<{ balance: number }>(
      db,
      sql`select coalesce(sum(l.debit - l.credit), 0)::bigint as balance from ledger_entries l
           where l.subscriber_id = ${head.subscriberId}
             and (l.entry_date, l.id) <= (select e.entry_date, e.id from ledger_entries e where e.source_type = 'PAYMENT' and e.source_id = ${id})`,
    ),
    getSettings(db),
  ]);
  return {
    ...head,
    allocations,
    reversal: reversal ?? null,
    proofId: proof?.id ?? null,
    balanceAfter: balance?.balance ?? 0,
    company: { name: String(settings['company.name']), address: String(settings['company.address']), phone: String(settings['company.phone']) },
  };
}

export async function markReceiptPrinted({ db, actor }: Ctx, paymentId: number): Promise<void> {
  const updated = await rows<{ receiptNo: string; printCount: number }>(
    db,
    sql`update receipts set print_count = print_count + 1 where payment_id = ${paymentId} returning receipt_no as "receiptNo", print_count as "printCount"`,
  );
  if (!updated.length) throw notFound('Receipt');
  await audit(db, actor, { action: 'receipt.print', entityType: 'payment', entityId: paymentId, newValues: updated[0] });
}

/** Adds the collected amount to the subscriber's line in a collection batch. */
export async function addBatchCollection(tx: DbOrTx, batchId: number, subscriberId: number, amount: number): Promise<void> {
  const [line] = await tx
    .select()
    .from(batchAccounts)
    .where(sql`${batchAccounts.batchId} = ${batchId} and ${batchAccounts.subscriberId} = ${subscriberId}`)
    .for('update');
  if (!line) throw invalid('This subscriber is not part of the collection batch.');
  const collected = line.collectedAmount + amount;
  await tx
    .update(batchAccounts)
    .set({ collectedAmount: collected, outcome: collected >= line.totalDue ? 'COLLECTED' : 'PARTIAL' })
    .where(eq(batchAccounts.id, line.id));
}

