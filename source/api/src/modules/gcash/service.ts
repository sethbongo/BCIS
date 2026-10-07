/**
 * GCash verification policy
 *  1. Staff records the customer's proof (reference, sender, amount, image). Recording a proof
 *     never changes any balance - a screenshot is evidence to review, not proof of payment.
 *  2. The system flags every other proof or payment that carries the same reference number.
 *  3. An authorized verifier compares the proof with the actual GCash transaction history and
 *     either verifies or rejects it. Only verification posts and allocates a payment.
 *  4. A reference that already backs a posted payment is blocked outright (service check plus a
 *     unique database index), so the same GCash transaction can never be credited twice.
 */
import type { DuplicateReference, GcashSubmissionInput, ListQuery, Paged, ProofRow } from '@bcis/shared';
import { eq, sql } from 'drizzle-orm';
import { contains, iso, one, paged, rows, where, type DbOrTx } from '../../db/client';
import { paymentProofs } from '../../db/schema';
import { readAttachment, removeAttachment, saveAttachment } from '../../lib/attachments';
import { audit } from '../../lib/audit';
import { today, type Ctx } from '../../lib/context';
import { conflict, invalid, notFound } from '../../lib/errors';
import { balanceOf } from '../../lib/sqlfrag';
import { postPaymentTx } from '../payments/service';

export async function findDuplicates(db: DbOrTx, referenceNo: string, excludeProofId?: number): Promise<DuplicateReference[]> {
  return rows<DuplicateReference>(
    db,
    sql`select 'PAYMENT' as kind, p.id, p.status::text as status, s.full_name as "subscriberName", p.amount, p.payment_date::text as date, r.receipt_no as "receiptNo"
          from payments p join subscribers s on s.id = p.subscriber_id join receipts r on r.payment_id = p.id
         where p.method = 'GCASH' and upper(p.reference_no) = upper(${referenceNo})
        union all
        select 'PROOF', pp.id, pp.status::text, s.full_name, pp.amount, pp.transaction_date::text, null
          from payment_proofs pp join subscribers s on s.id = pp.subscriber_id
         where upper(pp.reference_no) = upper(${referenceNo}) and pp.payment_id is null and pp.id <> ${excludeProofId ?? 0}
         order by 1, 2`,
  );
}

const proofSelect = sql`
  select pp.id, pp.subscriber_id as "subscriberId", s.account_no as "subscriberAccountNo", s.full_name as "subscriberName", ${balanceOf()} as "subscriberBalance",
    pp.reference_no as "referenceNo", pp.sender_name as "senderName", pp.sender_number as "senderNumber", pp.amount, pp.transaction_date as "transactionDate",
    pp.status, pp.notes, pp.file_name as "fileName", pp.mime_type as "mimeType", su.full_name as "submittedByName", ${iso('pp.submitted_at')} as "submittedAt",
    ru.full_name as "reviewedByName", ${iso('pp.reviewed_at')} as "reviewedAt", pp.rejection_reason as "rejectionReason", pp.payment_id as "paymentId",
    r.receipt_no as "receiptNo"
  from payment_proofs pp
  join subscribers s on s.id = pp.subscriber_id
  left join users su on su.id = pp.submitted_by
  left join users ru on ru.id = pp.reviewed_by
  left join receipts r on r.payment_id = pp.payment_id`;

type ProofBase = Omit<ProofRow, 'duplicates'>;

export async function listProofs(db: DbOrTx, q: ListQuery): Promise<Paged<ProofRow>> {
  const term = q.q ? contains(q.q) : null;
  const base = sql`${proofSelect} ${where(
    sql`pp.method = 'GCASH'`,
    q.status && sql`pp.status = ${q.status}`,
    q.subscriberId && sql`pp.subscriber_id = ${q.subscriberId}`,
    term && sql`(pp.reference_no ilike ${term} or pp.sender_name ilike ${term} or s.full_name ilike ${term} or s.account_no ilike ${term})`,
  )}`;
  const page = await paged<ProofBase>(db, base, q, { submittedAt: '"submittedAt"', amount: 'amount' }, `case status when 'PENDING' then 0 else 1 end, id desc`);
  const withDuplicates = await Promise.all(page.rows.map(async (row) => ({ ...row, duplicates: await findDuplicates(db, row.referenceNo, row.id) })));
  return { ...page, rows: withDuplicates };
}

export async function getProof(db: DbOrTx, id: number): Promise<ProofRow> {
  const row = await one<ProofBase>(db, sql`${proofSelect} where pp.id = ${id}`);
  if (!row) throw notFound('Payment proof');
  return { ...row, duplicates: await findDuplicates(db, row.referenceNo, row.id) };
}

export async function readProofFile(db: DbOrTx, id: number): Promise<{ data: Buffer; mimeType: string; fileName: string }> {
  const [proof] = await db.select().from(paymentProofs).where(eq(paymentProofs.id, id));
  if (!proof) throw notFound('Payment proof');
  return { data: await readAttachment(proof.storedName), mimeType: proof.mimeType, fileName: proof.fileName };
}

/** Step 2: record the proof for review. No payment is posted and no balance changes. */
export async function submitProof({ db, actor }: Ctx, input: GcashSubmissionInput): Promise<ProofRow> {
  const subscriber = await one(db, sql`select 1 from subscribers where id = ${input.subscriberId}`);
  if (!subscriber) throw notFound('Subscriber');
  if (input.transactionDate > today()) throw invalid('The transaction date cannot be in the future.', { transactionDate: 'Cannot be in the future' });
  const stored = await saveAttachment(input.file);
  try {
    const id = await db.transaction(async (tx) => {
      const [proof] = await tx
        .insert(paymentProofs)
        .values({
          ...stored,
          subscriberId: input.subscriberId,
          method: 'GCASH',
          referenceNo: input.referenceNo,
          senderName: input.senderName,
          senderNumber: input.senderNumber,
          amount: input.amount,
          transactionDate: input.transactionDate,
          notes: input.notes || null,
          submittedBy: actor.id,
        })
        .returning({ id: paymentProofs.id });
      const duplicates = await findDuplicates(tx, input.referenceNo, proof.id);
      await audit(tx, actor, {
        action: 'gcash.submit',
        entityType: 'payment_proof',
        entityId: proof.id,
        subscriberId: input.subscriberId,
        newValues: { referenceNo: input.referenceNo, amount: input.amount, senderName: input.senderName, possibleDuplicates: duplicates.length },
      });
      return proof.id;
    });
    return await getProof(db, id);
  } catch (err) {
    await removeAttachment(stored.storedName);
    throw err;
  }
}

/** Step 4/5: verification posts the payment and allocates it, atomically with the proof status. */
export async function verifyProof({ db, actor }: Ctx, id: number, notes?: string): Promise<ProofRow> {
  await db.transaction(async (tx) => {
    const [proof] = await tx.select().from(paymentProofs).where(eq(paymentProofs.id, id)).for('update');
    if (!proof) throw notFound('Payment proof');
    if (proof.status !== 'PENDING') throw conflict('ALREADY_REVIEWED', `This proof was already ${proof.status.toLowerCase()}.`);
    // postPaymentTx blocks a reference that already backs a posted payment (DUPLICATE_GCASH_REFERENCE).
    const paymentId = await postPaymentTx(tx, actor, {
      subscriberId: proof.subscriberId,
      amount: proof.amount,
      method: 'GCASH',
      referenceNo: proof.referenceNo,
      paymentDate: proof.transactionDate,
      notes: `GCash from ${proof.senderName} (${proof.senderNumber})${notes ? ` - ${notes}` : ''}`,
    });
    await tx.update(paymentProofs).set({ status: 'VERIFIED', paymentId, reviewedBy: actor.id, reviewedAt: new Date() }).where(eq(paymentProofs.id, id));
    await audit(tx, actor, {
      action: 'gcash.verify',
      entityType: 'payment_proof',
      entityId: id,
      subscriberId: proof.subscriberId,
      reason: notes || null,
      oldValues: { status: 'PENDING' },
      newValues: { status: 'VERIFIED', paymentId, referenceNo: proof.referenceNo, amount: proof.amount },
    });
  });
  return getProof(db, id);
}

export async function rejectProof({ db, actor }: Ctx, id: number, reason: string): Promise<ProofRow> {
  await db.transaction(async (tx) => {
    const [proof] = await tx.select().from(paymentProofs).where(eq(paymentProofs.id, id)).for('update');
    if (!proof) throw notFound('Payment proof');
    if (proof.status !== 'PENDING') throw conflict('ALREADY_REVIEWED', `This proof was already ${proof.status.toLowerCase()}.`);
    await tx.update(paymentProofs).set({ status: 'REJECTED', rejectionReason: reason, reviewedBy: actor.id, reviewedAt: new Date() }).where(eq(paymentProofs.id, id));
    await audit(tx, actor, {
      action: 'gcash.reject',
      entityType: 'payment_proof',
      entityId: id,
      subscriberId: proof.subscriberId,
      reason,
      oldValues: { status: 'PENDING' },
      newValues: { status: 'REJECTED', referenceNo: proof.referenceNo },
    });
  });
  return getProof(db, id);
}
