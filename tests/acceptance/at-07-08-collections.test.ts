/** Mandatory acceptance tests AT-07 and AT-08: collector remittance and reconciliation. */
import type { BatchDetail } from '@bcis/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bill, createSubscriberWithService, invoicesOf, startHarness, today, type Fixture, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

let seq = 0;
/** A new area + collector with four subscribers who each owe 5,000.00 (20,000.00 expected in total). */
async function route(): Promise<{ areaId: number; collectorId: number; fixtures: Fixture[] }> {
  const tag = `${Date.now().toString(36).slice(-4)}${++seq}`.toUpperCase();
  const area = await h.call('COLLECTION_SUPERVISOR', 'POST', '/areas', { code: `A-${tag}`, name: `Route ${tag}`, isActive: true });
  const collector = await h.call('COLLECTION_SUPERVISOR', 'POST', '/collectors', { code: `C-${tag}`, fullName: `Collector ${tag}`, isActive: true, areaIds: [area.body.id] });
  expect([area.status, collector.status]).toEqual([200, 200]);
  const fixtures: Fixture[] = [];
  for (let i = 0; i < 4; i++) {
    const f = await createSubscriberWithService(h, 500000, { areaId: area.body.id, collectorId: collector.body.id });
    await bill(h, f, '2025-09');
    fixtures.push(f);
  }
  return { areaId: area.body.id, collectorId: collector.body.id, fixtures };
}

async function collectedBatch(): Promise<{ batch: BatchDetail; fixtures: Fixture[] }> {
  const r = await route();
  const sheet = await h.call('COLLECTION_SUPERVISOR', 'GET', `/collections/route-sheet?areaId=${r.areaId}&collectorId=${r.collectorId}`);
  expect(sheet.body.rows).toHaveLength(4);
  expect(sheet.body.totals).toEqual({ currentBill: 0, arrears: 2000000, totalDue: 2000000 });

  const created = await h.call<BatchDetail>('COLLECTION_SUPERVISOR', 'POST', '/batches', { collectorId: r.collectorId, areaId: r.areaId, collectionDate: today() });
  expect(created.body).toMatchObject({ status: 'OPEN', expectedTotal: 2000000, accountCount: 4 });
  for (const f of r.fixtures) {
    const res = await h.call('COLLECTION_SUPERVISOR', 'POST', `/batches/${created.body.id}/collections`, { subscriberId: f.subscriber.id, amount: 500000, method: 'CASH' });
    expect(res.status).toBe(200);
  }
  const submitted = await h.call<BatchDetail>('COLLECTION_SUPERVISOR', 'POST', `/batches/${created.body.id}/submit`);
  expect(submitted.body).toMatchObject({ status: 'SUBMITTED', cashCollected: 2000000, nonCashCollected: 0, collectedCount: 4, uncollected: 0 });
  return { batch: submitted.body, fixtures: r.fixtures };
}

describe('AT-07 Collector balanced remittance', () => {
  it('cash collected 20,000.00, remitted 20,000.00 -> difference 0.00; batch reconciles and closes', async () => {
    const { batch, fixtures } = await collectedBatch();

    // Collections are real payments: receipts issued, invoices paid, tagged with the batch.
    for (const f of fixtures) expect((await invoicesOf(h, f))[0]).toMatchObject({ status: 'PAID', balance: 0 });
    expect(batch.accounts.every((a) => a.outcome === 'COLLECTED' && a.payments.length === 1 && /^RCPT-/.test(a.payments[0].receiptNo))).toBe(true);

    const remitted = await h.call<BatchDetail>('COLLECTION_SUPERVISOR', 'POST', `/batches/${batch.id}/remittances`, { amount: 2000000 });
    expect(remitted.body).toMatchObject({ status: 'REMITTED', cashRemitted: 2000000, difference: 0 });
    expect(remitted.body.remittances[0].remittanceNo).toMatch(/^REM-/);

    const reconciled = await h.call<BatchDetail>('COLLECTION_SUPERVISOR', 'POST', `/batches/${batch.id}/reconcile`, {});
    expect(reconciled.body).toMatchObject({ status: 'RECONCILED', difference: 0, varianceType: 'BALANCED' });

    // Closing needs separate authorization: the supervisor who reconciled cannot close.
    expect((await h.call('COLLECTION_SUPERVISOR', 'POST', `/batches/${batch.id}/close`, { confirm: true })).status).toBe(403);
    expect((await h.call('ADMIN', 'POST', `/batches/${batch.id}/close`, {})).status).toBe(400);
    const closed = await h.call<BatchDetail>('ADMIN', 'POST', `/batches/${batch.id}/close`, { confirm: true });
    expect(closed.body).toMatchObject({ status: 'CLOSED', varianceType: 'BALANCED', difference: 0, closedByName: 'Test Administrator' });

    // A closed batch accepts nothing further.
    expect((await h.call('COLLECTION_SUPERVISOR', 'POST', `/batches/${batch.id}/remittances`, { amount: 100 })).status).toBe(409);
  });
});

describe('AT-08 Collector shortage', () => {
  it('cash collected 20,000.00, remitted 19,500.00 -> 500.00 shortage shown; cannot be closed as balanced', async () => {
    const { batch } = await collectedBatch();
    const remitted = await h.call<BatchDetail>('COLLECTION_SUPERVISOR', 'POST', `/batches/${batch.id}/remittances`, { amount: 1950000 });
    // The shortage is visible as soon as the cash is counted.
    expect(remitted.body).toMatchObject({ status: 'REMITTED', cashCollected: 2000000, cashRemitted: 1950000, difference: -50000, varianceType: null });

    // It cannot be closed before reconciliation...
    expect((await h.call('ADMIN', 'POST', `/batches/${batch.id}/close`, { confirm: true })).status).toBe(409);
    // ...and cannot be reconciled without explicitly recording the variance.
    const silent = await h.call('COLLECTION_SUPERVISOR', 'POST', `/batches/${batch.id}/reconcile`, {});
    expect(silent.status).toBe(422);
    expect(silent.body.error.code).toBe('VARIANCE_REASON_REQUIRED');
    expect(silent.body.error.message).toContain('shortage of ₱500.00');
    expect((await h.call<BatchDetail>('ADMIN', 'GET', `/batches/${batch.id}`)).body.status).toBe('REMITTED');

    const reason = 'Collector short by 500.00; acknowledged, for salary deduction';
    const reconciled = await h.call<BatchDetail>('COLLECTION_SUPERVISOR', 'POST', `/batches/${batch.id}/reconcile`, { varianceReason: reason });
    expect(reconciled.body).toMatchObject({ status: 'RECONCILED', varianceType: 'SHORTAGE', difference: -50000, varianceReason: reason });

    const closed = await h.call<BatchDetail>('ADMIN', 'POST', `/batches/${batch.id}/close`, { confirm: true, notes: 'Shortage acknowledged' });
    expect(closed.body).toMatchObject({ status: 'CLOSED', varianceType: 'SHORTAGE', difference: -50000 });

    // The database refuses to store a "balanced" result for unequal amounts, even by direct SQL.
    await expect(h.sql(sql`update collection_batches set variance_type = 'BALANCED' where id = ${batch.id}`)).rejects.toThrow();
    await expect(h.sql(sql`update collection_batches set difference = 0 where id = ${batch.id}`)).rejects.toThrow();

    const report = await h.call('COLLECTION_SUPERVISOR', 'GET', `/reports/collector-remittance?from=${today()}&to=${today()}&collectorId=${batch.collectorId}`);
    expect(report.body.rows).toEqual([expect.objectContaining({ batchNo: batch.batchNo, difference: -50000, variance: 'Shortage', reason })]);
    const audit = await h.call('ACCOUNTING', 'GET', `/audit-logs?action=collection.reconcile&q=${batch.id}`);
    expect(audit.body.rows.some((r: any) => r.entityId === String(batch.id) && r.newValues.varianceType === 'SHORTAGE' && r.reason === reason)).toBe(true);
  });

  it('overage is recorded the same way, and non-cash collections are not expected in the cash remittance', async () => {
    const r = await route();
    const created = await h.call<BatchDetail>('COLLECTION_SUPERVISOR', 'POST', '/batches', { collectorId: r.collectorId, areaId: r.areaId, collectionDate: today() });
    const id = created.body.id;
    await h.call('COLLECTION_SUPERVISOR', 'POST', `/batches/${id}/collections`, { subscriberId: r.fixtures[0].subscriber.id, amount: 500000, method: 'CASH' });
    await h.call('COLLECTION_SUPERVISOR', 'POST', `/batches/${id}/collections`, { subscriberId: r.fixtures[1].subscriber.id, amount: 200000, method: 'CASH' });
    const noRef = await h.call('COLLECTION_SUPERVISOR', 'POST', `/batches/${id}/collections`, { subscriberId: r.fixtures[2].subscriber.id, amount: 500000, method: 'GCASH' });
    expect(noRef.status).toBe(400);
    await h.call('COLLECTION_SUPERVISOR', 'POST', `/batches/${id}/collections`, { subscriberId: r.fixtures[2].subscriber.id, amount: 500000, method: 'GCASH', referenceNo: `88${Date.now()}` });
    await h.call('COLLECTION_SUPERVISOR', 'POST', `/batches/${id}/outcomes`, { subscriberId: r.fixtures[3].subscriber.id, outcome: 'NOT_HOME', notes: 'Closed gate' });

    const submitted = await h.call<BatchDetail>('COLLECTION_SUPERVISOR', 'POST', `/batches/${id}/submit`);
    expect(submitted.body).toMatchObject({ expectedTotal: 2000000, cashCollected: 700000, nonCashCollected: 500000, uncollected: 800000, collectedCount: 3 });
    expect(submitted.body.exceptions.map((e) => e.detail)).toEqual(expect.arrayContaining([expect.stringContaining('Partial collection'), expect.stringContaining('Not at home')]));

    await h.call('COLLECTION_SUPERVISOR', 'POST', `/batches/${id}/remittances`, { amount: 700000 });
    await h.call('COLLECTION_SUPERVISOR', 'POST', `/batches/${id}/remittances`, { amount: 2500 });
    expect((await h.call('COLLECTION_SUPERVISOR', 'POST', `/batches/${id}/reconcile`, {})).status).toBe(422);
    const reconciled = await h.call<BatchDetail>('COLLECTION_SUPERVISOR', 'POST', `/batches/${id}/reconcile`, { varianceReason: 'Extra 25.00 handed in, payer unknown' });
    expect(reconciled.body).toMatchObject({ varianceType: 'OVERAGE', difference: 2500, cashRemitted: 702500 });
  });
});
