import {
  computeRemittanceVariance,
  formatMoney,
  type BatchAccountRow,
  type BatchCollectInput,
  type BatchCreateInput,
  type BatchDetail,
  type BatchRow,
  type BatchStatus,
  type ListQuery,
  type Paged,
  type RemittanceInput,
  type RemittanceRow,
  type RouteSheet,
  type RouteSheetRow,
} from '@bcis/shared';
import { eq, sql } from 'drizzle-orm';
import { contains, iso, one, paged, rows, where, type DbOrTx } from '../../db/client';
import { batchAccounts, collectionBatches, collectorRemittances } from '../../db/schema';
import { audit } from '../../lib/audit';
import { today, type Ctx } from '../../lib/context';
import { AppError, conflict, invalid, notFound } from '../../lib/errors';
import { nextNumber } from '../../lib/sequences';
import { address, OPEN } from '../../lib/sqlfrag';
import { addBatchCollection, postPaymentTx } from '../payments/service';

/**
 * Accounts a collector should visit: active subscribers of the area assigned to the collector
 * that have something to pay. "Arrears" are invoices already past due on the collection date;
 * the "current bill" is everything else that is open.
 */
async function routeRows(db: DbOrTx, areaId: number, collectorId: number, asOf: string): Promise<RouteSheetRow[]> {
  return rows<RouteSheetRow>(
    db,
    sql`select s.id as "subscriberId", s.account_no as "accountNo", s.full_name as "fullName", coalesce(${address('a')}, '') as address, s.phone,
          coalesce((select string_agg(p.name, ', ' order by p.name) from service_accounts sa join service_plans p on p.id = sa.plan_id
                     where sa.subscriber_id = s.id and sa.status in ('ACTIVE','SUSPENDED')), '') as services,
          d.current_bill as "currentBill", d.arrears, (d.current_bill + d.arrears) as "totalDue"
        from subscribers s
        left join subscriber_addresses a on a.subscriber_id = s.id and a.is_primary
        join lateral (
          select coalesce(sum(i.balance) filter (where i.due_date >= ${asOf}), 0)::bigint as current_bill,
                 coalesce(sum(i.balance) filter (where i.due_date < ${asOf}), 0)::bigint as arrears
            from invoices i where i.subscriber_id = s.id and i.status in ${OPEN}
        ) d on true
       where s.collection_area_id = ${areaId} and s.collector_id = ${collectorId} and s.status = 'ACTIVE' and (d.current_bill + d.arrears) > 0
       order by s.route_sequence nulls last, s.full_name`,
  );
}

export async function getRouteSheet(db: DbOrTx, areaId: number, collectorId: number, asOf = today()): Promise<RouteSheet> {
  const names = await one<{ areaName: string; collectorName: string }>(
    db,
    sql`select (select name from collection_areas where id = ${areaId}) as "areaName", (select full_name from collectors where id = ${collectorId}) as "collectorName"`,
  );
  if (!names?.areaName || !names.collectorName) throw notFound('Collection area or collector');
  const sheet = await routeRows(db, areaId, collectorId, asOf);
  return {
    ...names,
    asOf,
    rows: sheet,
    totals: {
      currentBill: sheet.reduce((sum, r) => sum + r.currentBill, 0),
      arrears: sheet.reduce((sum, r) => sum + r.arrears, 0),
      totalDue: sheet.reduce((sum, r) => sum + r.totalDue, 0),
    },
  };
}

export const batchSelect = sql`
  select b.id, b.batch_no as "batchNo", b.collector_id as "collectorId", c.full_name as "collectorName", b.area_id as "areaId", a.name as "areaName",
    b.collection_date as "collectionDate", b.status,
    (select count(*) from batch_accounts ba where ba.batch_id = b.id) as "accountCount",
    (select count(*) from batch_accounts ba where ba.batch_id = b.id and ba.collected_amount > 0) as "collectedCount",
    b.expected_total as "expectedTotal", t.cash as "cashCollected", t.non_cash as "nonCashCollected", b.cash_remitted as "cashRemitted",
    case when b.status in ('RECONCILED','CLOSED') then b.difference else b.cash_remitted - t.cash end as difference, b.variance_type as "varianceType"
  from collection_batches b
  join collectors c on c.id = b.collector_id
  join collection_areas a on a.id = b.area_id
  join lateral (
    -- Until reconciliation the collected totals are live figures from posted payments;
    -- afterwards the reconciled snapshot stored on the batch is authoritative.
    select case when b.status in ('RECONCILED','CLOSED') then b.cash_collected
                else coalesce((select sum(p.amount) from payments p where p.collection_batch_id = b.id and p.status = 'POSTED' and p.method = 'CASH'), 0)::bigint end as cash,
           case when b.status in ('RECONCILED','CLOSED') then b.non_cash_collected
                else coalesce((select sum(p.amount) from payments p where p.collection_batch_id = b.id and p.status = 'POSTED' and p.method <> 'CASH'), 0)::bigint end as non_cash
  ) t on true`;

export async function listBatches(db: DbOrTx, q: ListQuery): Promise<Paged<BatchRow>> {
  const term = q.q ? contains(q.q) : null;
  const base = sql`${batchSelect} ${where(
    term && sql`(b.batch_no ilike ${term} or c.full_name ilike ${term} or a.name ilike ${term})`,
    q.status === 'ACTIVE' ? sql`b.status <> 'CLOSED'` : q.status === 'FOR_REMITTANCE' ? sql`b.status in ('SUBMITTED','REMITTED','RECONCILED')` : q.status && sql`b.status = ${q.status}`,
    q.collectorId && sql`b.collector_id = ${q.collectorId}`,
    q.areaId && sql`b.area_id = ${q.areaId}`,
    q.from && sql`b.collection_date >= ${q.from}`,
    q.to && sql`b.collection_date <= ${q.to}`,
  )}`;
  return paged<BatchRow>(db, base, q, { batchNo: '"batchNo"', collectionDate: '"collectionDate"', collectorName: '"collectorName"', status: 'status', expectedTotal: '"expectedTotal"' }, '"collectionDate" desc, id desc');
}

export async function getBatch(db: DbOrTx, id: number): Promise<BatchDetail> {
  const head = await one<BatchRow & Pick<BatchDetail, 'notes' | 'varianceReason' | 'createdByName' | 'createdAt' | 'submittedAt' | 'reconciledByName' | 'reconciledAt' | 'closedByName' | 'closedAt'>>(
    db,
    sql`select t.*, x.notes, x.variance_reason as "varianceReason", cu.full_name as "createdByName", ${iso('x.created_at')} as "createdAt",
          ${iso('x.submitted_at')} as "submittedAt", ru.full_name as "reconciledByName", ${iso('x.reconciled_at')} as "reconciledAt",
          clu.full_name as "closedByName", ${iso('x.closed_at')} as "closedAt"
        from (${batchSelect} where b.id = ${id}) t
        join collection_batches x on x.id = t.id
        left join users cu on cu.id = x.created_by
        left join users ru on ru.id = x.reconciled_by
        left join users clu on clu.id = x.closed_by`,
  );
  if (!head) throw notFound('Collection batch');
  const [accounts, remittances] = await Promise.all([
    rows<BatchAccountRow>(
      db,
      sql`select ba.id, ba.subscriber_id as "subscriberId", s.account_no as "accountNo", s.full_name as "fullName", coalesce(${address('a')}, '') as address, s.phone,
            coalesce((select string_agg(p.name, ', ' order by p.name) from service_accounts sa join service_plans p on p.id = sa.plan_id
                       where sa.subscriber_id = s.id and sa.status in ('ACTIVE','SUSPENDED')), '') as services,
            ba.sequence, ba.current_bill as "currentBill", ba.arrears, ba.total_due as "totalDue", ba.collected_amount as "collectedAmount", ba.outcome, ba.notes,
            coalesce((select json_agg(json_build_object('paymentId', p.id, 'receiptNo', r.receipt_no, 'method', p.method, 'amount', p.amount, 'status', p.status) order by p.id)
                        from payments p join receipts r on r.payment_id = p.id
                       where p.collection_batch_id = ba.batch_id and p.subscriber_id = ba.subscriber_id), '[]'::json) as payments
          from batch_accounts ba
          join subscribers s on s.id = ba.subscriber_id
          left join subscriber_addresses a on a.subscriber_id = s.id and a.is_primary
         where ba.batch_id = ${id} order by ba.sequence, ba.id`,
    ),
    rows<RemittanceRow>(
      db,
      sql`select cr.id, cr.remittance_no as "remittanceNo", cr.amount, ${iso('cr.remitted_at')} as "remittedAt", u.full_name as "receivedByName", cr.notes
            from collector_remittances cr left join users u on u.id = cr.received_by where cr.batch_id = ${id} order by cr.id`,
    ),
  ]);
  const exceptions: BatchDetail['exceptions'] = [];
  for (const account of accounts) {
    const who = { subscriberName: account.fullName, accountNo: account.accountNo };
    for (const p of account.payments.filter((x) => x.status === 'REVERSED')) exceptions.push({ ...who, detail: `Receipt ${p.receiptNo} for ${formatMoney(p.amount)} was reversed` });
    if (account.outcome === 'NOT_HOME') exceptions.push({ ...who, detail: `Not at home${account.notes ? ` - ${account.notes}` : ''}` });
    if (account.outcome === 'PROMISED') exceptions.push({ ...who, detail: `Promised to pay${account.notes ? ` - ${account.notes}` : ''}` });
    if (account.outcome === 'REFUSED') exceptions.push({ ...who, detail: `Refused to pay${account.notes ? ` - ${account.notes}` : ''}` });
    if (account.outcome === 'PARTIAL') exceptions.push({ ...who, detail: `Partial collection: ${formatMoney(account.collectedAmount)} of ${formatMoney(account.totalDue)}` });
  }
  return { ...head, accounts, remittances, exceptions, uncollected: Math.max(head.expectedTotal - head.cashCollected - head.nonCashCollected, 0) };
}

export async function createBatch({ db, actor }: Ctx, input: BatchCreateInput): Promise<BatchDetail> {
  const id = await db.transaction(async (tx) => {
    const duplicate = await one<{ batchNo: string }>(
      tx,
      sql`select batch_no as "batchNo" from collection_batches where collector_id = ${input.collectorId} and area_id = ${input.areaId}
            and collection_date = ${input.collectionDate} and status <> 'CLOSED'`,
    );
    if (duplicate) throw conflict('BATCH_EXISTS', `Batch ${duplicate.batchNo} is already open for this collector, area and date.`);
    const accounts = await routeRows(tx, input.areaId, input.collectorId, input.collectionDate);
    if (!accounts.length) throw invalid('No subscribers with an amount due are assigned to this collector in the selected area.');
    const batchNo = await nextNumber(tx, 'BATCH');
    const [batch] = await tx
      .insert(collectionBatches)
      .values({
        batchNo,
        collectorId: input.collectorId,
        areaId: input.areaId,
        collectionDate: input.collectionDate,
        expectedTotal: accounts.reduce((sum, a) => sum + a.totalDue, 0),
        notes: input.notes || null,
        createdBy: actor.id,
      })
      .returning({ id: collectionBatches.id });
    await tx.insert(batchAccounts).values(
      accounts.map((a, index) => ({ batchId: batch.id, subscriberId: a.subscriberId, sequence: index + 1, currentBill: a.currentBill, arrears: a.arrears, totalDue: a.totalDue })),
    );
    await audit(tx, actor, { action: 'collection.batch_create', entityType: 'collection_batch', entityId: batch.id, newValues: { batchNo, ...input, accounts: accounts.length } });
    return batch.id;
  });
  return getBatch(db, id);
}

async function lockBatch(tx: DbOrTx, id: number, allowed: BatchStatus[], action: string) {
  const [batch] = await tx.select().from(collectionBatches).where(eq(collectionBatches.id, id)).for('update');
  if (!batch) throw notFound('Collection batch');
  if (!allowed.includes(batch.status)) {
    throw conflict('INVALID_BATCH_STATE', `A batch that is ${batch.status.replace('_', ' ').toLowerCase()} cannot be ${action}.`);
  }
  return batch;
}

/** Cash and non-cash totals from payments that are still posted (reversed collections do not count). */
async function collectedTotals(tx: DbOrTx, batchId: number): Promise<{ cash: number; nonCash: number }> {
  const row = await one<{ cash: number; nonCash: number }>(
    tx,
    sql`select coalesce(sum(amount) filter (where method = 'CASH'), 0)::bigint as cash, coalesce(sum(amount) filter (where method <> 'CASH'), 0)::bigint as "nonCash"
          from payments where collection_batch_id = ${batchId} and status = 'POSTED'`,
  );
  return row ?? { cash: 0, nonCash: 0 };
}

export async function startBatch({ db, actor }: Ctx, id: number): Promise<BatchDetail> {
  await db.transaction(async (tx) => {
    await lockBatch(tx, id, ['OPEN'], 'started');
    await tx.update(collectionBatches).set({ status: 'IN_PROGRESS', startedAt: new Date() }).where(eq(collectionBatches.id, id));
    await audit(tx, actor, { action: 'collection.batch_start', entityType: 'collection_batch', entityId: id, oldValues: { status: 'OPEN' }, newValues: { status: 'IN_PROGRESS' } });
  });
  return getBatch(db, id);
}

/** Records one house-to-house collection: a normal posted payment, tagged with the batch and collector. */
export async function recordCollection({ db, actor }: Ctx, id: number, input: BatchCollectInput): Promise<BatchDetail> {
  if (input.idempotencyKey) {
    const existing = await one(db, sql`select 1 from payments where idempotency_key = ${input.idempotencyKey}`);
    if (existing) return getBatch(db, id);
  }
  await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, id, ['OPEN', 'IN_PROGRESS'], 'collected against');
    if (batch.status === 'OPEN') await tx.update(collectionBatches).set({ status: 'IN_PROGRESS', startedAt: new Date() }).where(eq(collectionBatches.id, id));
    await postPaymentTx(
      tx,
      actor,
      { subscriberId: input.subscriberId, amount: input.amount, method: input.method, referenceNo: input.referenceNo, notes: input.notes, idempotencyKey: input.idempotencyKey, paymentDate: batch.collectionDate > today() ? today() : batch.collectionDate },
      { collectionBatchId: id, collectorId: batch.collectorId },
    );
    await addBatchCollection(tx, id, input.subscriberId, input.amount);
  });
  return getBatch(db, id);
}

export async function recordOutcome({ db, actor }: Ctx, id: number, input: { subscriberId: number; outcome: 'NOT_HOME' | 'PROMISED' | 'REFUSED'; notes?: string }): Promise<BatchDetail> {
  await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, id, ['OPEN', 'IN_PROGRESS'], 'updated');
    if (batch.status === 'OPEN') await tx.update(collectionBatches).set({ status: 'IN_PROGRESS', startedAt: new Date() }).where(eq(collectionBatches.id, id));
    const updated = await rows(
      tx,
      sql`update batch_accounts set outcome = ${input.outcome}, notes = ${input.notes || null}
           where batch_id = ${id} and subscriber_id = ${input.subscriberId} and collected_amount = 0 returning id`,
    );
    if (!updated.length) throw invalid('The account is not in this batch or already has a collection recorded.');
    await audit(tx, actor, { action: 'collection.outcome', entityType: 'collection_batch', entityId: id, subscriberId: input.subscriberId, newValues: input });
  });
  return getBatch(db, id);
}

export async function submitBatch({ db, actor }: Ctx, id: number): Promise<BatchDetail> {
  await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, id, ['OPEN', 'IN_PROGRESS'], 'submitted');
    const totals = await collectedTotals(tx, id);
    await tx.update(collectionBatches).set({ status: 'SUBMITTED', submittedAt: new Date(), cashCollected: totals.cash, nonCashCollected: totals.nonCash }).where(eq(collectionBatches.id, id));
    await audit(tx, actor, { action: 'collection.batch_submit', entityType: 'collection_batch', entityId: id, oldValues: { status: batch.status }, newValues: { status: 'SUBMITTED', ...totals } });
  });
  return getBatch(db, id);
}

export async function addRemittance({ db, actor }: Ctx, id: number, input: RemittanceInput): Promise<BatchDetail> {
  await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, id, ['SUBMITTED', 'REMITTED'], 'remitted');
    const remittanceNo = await nextNumber(tx, 'REMITTANCE');
    await tx.insert(collectorRemittances).values({ remittanceNo, batchId: id, collectorId: batch.collectorId, amount: input.amount, notes: input.notes || null, receivedBy: actor.id });
    const cashRemitted = batch.cashRemitted + input.amount;
    await tx.update(collectionBatches).set({ status: 'REMITTED', cashRemitted }).where(eq(collectionBatches.id, id));
    await audit(tx, actor, {
      action: 'collection.remittance',
      entityType: 'collection_batch',
      entityId: id,
      oldValues: { status: batch.status, cashRemitted: batch.cashRemitted },
      newValues: { status: 'REMITTED', remittanceNo, amount: input.amount, cashRemitted },
    });
  });
  return getBatch(db, id);
}

/**
 * Reconciliation compares cash remitted with cash collected. A difference is never absorbed:
 * the batch is classified SHORTAGE or OVERAGE with the exact amount, and it cannot be
 * reconciled until the supervisor records an explanation.
 */
export async function reconcileBatch({ db, actor }: Ctx, id: number, varianceReason?: string): Promise<BatchDetail> {
  await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, id, ['REMITTED'], 'reconciled');
    const totals = await collectedTotals(tx, id);
    const variance = computeRemittanceVariance(totals.cash, batch.cashRemitted);
    const reason = varianceReason?.trim() || null;
    if (variance.type !== 'BALANCED' && !reason) {
      throw new AppError(
        422,
        'VARIANCE_REASON_REQUIRED',
        `Remitted cash differs from collected cash: ${variance.type === 'SHORTAGE' ? 'shortage' : 'overage'} of ${formatMoney(variance.amount, { symbol: true })}. Record the reason to reconcile this batch.`,
        { varianceReason: 'Explain the shortage or overage' },
      );
    }
    await tx
      .update(collectionBatches)
      .set({
        status: 'RECONCILED',
        cashCollected: totals.cash,
        nonCashCollected: totals.nonCash,
        difference: variance.difference,
        varianceType: variance.type,
        varianceReason: variance.type === 'BALANCED' ? null : reason,
        reconciledBy: actor.id,
        reconciledAt: new Date(),
      })
      .where(eq(collectionBatches.id, id));
    await audit(tx, actor, {
      action: 'collection.reconcile',
      entityType: 'collection_batch',
      entityId: id,
      reason,
      oldValues: { status: 'REMITTED' },
      newValues: { status: 'RECONCILED', cashCollected: totals.cash, cashRemitted: batch.cashRemitted, difference: variance.difference, varianceType: variance.type },
    });
  });
  return getBatch(db, id);
}

/** Closing needs a separate, explicit confirmation by a user holding collection.close. */
export async function closeBatch({ db, actor }: Ctx, id: number, notes?: string): Promise<BatchDetail> {
  await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, id, ['RECONCILED'], 'closed');
    await tx.update(collectionBatches).set({ status: 'CLOSED', closedBy: actor.id, closedAt: new Date() }).where(eq(collectionBatches.id, id));
    await audit(tx, actor, {
      action: 'collection.batch_close',
      entityType: 'collection_batch',
      entityId: id,
      reason: notes || null,
      oldValues: { status: 'RECONCILED' },
      newValues: { status: 'CLOSED', varianceType: batch.varianceType, difference: batch.difference },
    });
  });
  return getBatch(db, id);
}

/** Collection tab of the subscriber profile: every batch visit and what was collected. */
export async function listSubscriberCollections(db: DbOrTx, subscriberId: number) {
  return rows<{ batchId: number; batchNo: string; collectionDate: string; collectorName: string; areaName: string; status: BatchStatus; totalDue: number; collectedAmount: number; outcome: string; notes: string | null }>(
    db,
    sql`select b.id as "batchId", b.batch_no as "batchNo", b.collection_date as "collectionDate", c.full_name as "collectorName", a.name as "areaName", b.status,
          ba.total_due as "totalDue", ba.collected_amount as "collectedAmount", ba.outcome, ba.notes
        from batch_accounts ba
        join collection_batches b on b.id = ba.batch_id
        join collectors c on c.id = b.collector_id
        join collection_areas a on a.id = b.area_id
       where ba.subscriber_id = ${subscriberId} order by b.collection_date desc, b.id desc limit 200`,
  );
}
