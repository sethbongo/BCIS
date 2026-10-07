/** Additional integration tests for the supporting workflows around the mandatory scenarios. */
import { addMonths, type AgingReport, type InvoiceDetail, type ReceivableSummary, type ReportData, type SearchResult } from '@bcis/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bill, createSubscriberWithService, invoicesOf, ledgerOf, pay, startHarness, today, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

describe('billing rules', () => {
  it('plan price changes affect future billing only; historical invoices keep the billed rate', async () => {
    const f = await createSubscriberWithService(h, 99900);
    const september = await bill(h, f, '2025-09');
    const changed = await h.call('ADMIN', 'PATCH', `/plans/${f.planId}`, { monthlyPrice: 119900 });
    expect(changed.body.monthlyPrice).toBe(119900);

    const october = await bill(h, f, '2025-10');
    expect(october.total).toBe(119900);
    const old = await h.call<InvoiceDetail>('ADMIN', 'GET', `/invoices/${september.id}`);
    expect(old.body.total).toBe(99900);
    expect(old.body.items).toEqual([expect.objectContaining({ itemType: 'SUBSCRIPTION', unitAmount: 99900, amount: 99900 })]);
    const events = await h.call('ADMIN', 'GET', `/service-accounts/${f.account.id}/events`);
    expect(events.body.map((e: any) => e.eventType)).toContain('RATE_CHANGED');
  });

  it('adjustments change a finalized invoice only through an audited, ledger-posted record', async () => {
    const f = await createSubscriberWithService(h, 99900);
    const invoice = await bill(h, f, '2025-09');
    expect((await h.call('CASHIER', 'POST', '/adjustments', { invoiceId: invoice.id, type: 'CREDIT', amount: 20000, reason: 'Service interruption rebate' })).status).toBe(403);
    expect((await h.call('ADMIN', 'POST', '/adjustments', { invoiceId: invoice.id, type: 'CREDIT', amount: 100000, reason: 'More than the balance' })).status).toBe(422);

    const credited = await h.call<InvoiceDetail>('ADMIN', 'POST', '/adjustments', { invoiceId: invoice.id, type: 'CREDIT', amount: 20000, reason: 'Service interruption rebate' });
    expect(credited.body).toMatchObject({ total: 99900, adjustmentsTotal: -20000, balance: 79900, status: 'PARTIALLY_PAID' });
    expect(credited.body.adjustments[0].adjustmentNo).toMatch(/^ADJ-/);
    const debited = await h.call<InvoiceDetail>('ADMIN', 'POST', '/adjustments', { invoiceId: invoice.id, type: 'DEBIT', amount: 5000, reason: 'Returned cheque charge' });
    expect(debited.body).toMatchObject({ adjustmentsTotal: -15000, balance: 84900 });
    expect((await ledgerOf(h, f)).closingBalance).toBe(84900);

    await pay(h, f, 84900);
    expect((await invoicesOf(h, f))[0]).toMatchObject({ status: 'PAID', balance: 0 });
    // A full credit with no payment yields CREDITED.
    const g = await createSubscriberWithService(h, 45000);
    const inv = await bill(h, g, '2025-09');
    const full = await h.call<InvoiceDetail>('ADMIN', 'POST', '/adjustments', { invoiceId: inv.id, type: 'CREDIT', amount: 45000, reason: 'Billed during a full-month outage' });
    expect(full.body.status).toBe('CREDITED');
    expect((await ledgerOf(h, g)).closingBalance).toBe(0);
  });

  it('validation errors name the offending fields', async () => {
    const res = await h.call('ADMIN', 'POST', '/subscribers', { firstName: '', lastName: 'X', phone: 'abc', dueDay: 31, address: {} });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['firstName', 'phone', 'dueDay', 'address.line1']));
    expect((await pay(h, await createSubscriberWithService(h, 99900), 10.5)).status).toBe(400);
    expect((await h.call('CASHIER', 'POST', '/payments', { subscriberId: 1, amount: -5, method: 'CASH' })).status).toBe(400);
    const future = await pay(h, await createSubscriberWithService(h, 99900), 1000, { paymentDate: '2099-01-01' });
    expect(future.status).toBe(422);
  });
});

describe('receivables and service control', () => {
  it('aging totals reconcile to the outstanding invoice balances', async () => {
    const f = await createSubscriberWithService(h, 99900);
    await bill(h, f, '2025-06');
    await bill(h, f, addMonths(today().slice(0, 7), 1)); // next month: not yet due, so it ages as Current
    await pay(h, f, 30000);

    const aging = await h.call<AgingReport>('ACCOUNTING', 'GET', '/receivables/aging?pageSize=500');
    const t = aging.body.totals;
    expect(t.CURRENT + t.D1_30 + t.D31_60 + t.D61_90 + t.D90_PLUS).toBe(t.total);
    expect(t.total).toBe(aging.body.outstandingInvoiceTotal);
    const direct = await h.sql<{ total: number }>(sql`select coalesce(sum(balance), 0)::bigint as total from invoices where status in ('UNPAID','PARTIALLY_PAID','OVERDUE')`);
    expect(t.total).toBe(direct[0].total);

    const mine = aging.body.rows.find((r) => r.subscriberId === f.subscriber.id)!;
    expect(mine.D90_PLUS).toBe(69900);
    expect(mine.CURRENT).toBe(99900);
    expect(mine.total).toBe(69900 + 99900);
    const summary = await h.call<ReceivableSummary>('ACCOUNTING', 'GET', '/receivables/summary');
    expect(summary.body.currentReceivable + summary.body.overdueReceivable).toBe(summary.body.totalReceivable);

    const overdue = await h.call('ACCOUNTING', 'GET', `/receivables/overdue?q=${f.subscriber.accountNo}`);
    expect(overdue.body.rows).toEqual([expect.objectContaining({ monthsUnpaid: 1, totalArrears: 69900, bucket: 'D90_PLUS', serviceAccountNo: f.account.accountNo })]);
    expect((await h.call('ACCOUNTING', 'GET', `/receivables/overdue?q=${f.subscriber.accountNo}&bucket=D1_30`)).body.rows).toEqual([]);
  });

  it('suspension candidates follow the grace period and threshold; suspension and reconnection keep full history', async () => {
    const f = await createSubscriberWithService(h, 99900);
    await bill(h, f, '2025-07');
    const candidatesAfterOne = await h.call('ADMIN', 'GET', `/receivables/suspension-candidates?q=${f.account.accountNo}`);
    expect(candidatesAfterOne.body.rows).toEqual([]); // threshold is 2 unpaid months
    await bill(h, f, '2025-08');
    const candidates = await h.call('ADMIN', 'GET', `/receivables/suspension-candidates?q=${f.account.accountNo}`);
    expect(candidates.body.rows).toEqual([expect.objectContaining({ monthsUnpaid: 2, totalArrears: 199800 })]);

    const suspended = await h.call('ADMIN', 'POST', `/service-accounts/${f.account.id}/suspend`, { reason: 'Two months unpaid', effectiveDate: today() });
    expect(suspended.body.status).toBe('SUSPENDED');
    // Suspended accounts are not billed and no longer appear as candidates.
    const run = await h.call('ADMIN', 'POST', '/billing/generate', { period: '2025-09', finalize: true, serviceAccountIds: [f.account.id] });
    expect(run.body.created).toBe(0);

    // Reconnection needs a qualifying payment first.
    const early = await h.call('ADMIN', 'POST', `/service-accounts/${f.account.id}/reconnection`, {});
    expect(early.status).toBe(422);
    expect(early.body.error.message).toContain('₱1,998.00');
    await pay(h, f, 199800);
    const request = await h.call('ADMIN', 'POST', `/service-accounts/${f.account.id}/reconnection`, { notes: 'Paid in full' });
    expect(request.body).toMatchObject({ status: 'REQUESTED', feeAmount: 30000 });
    expect(request.body.feeInvoiceNo).toMatch(/^INV-/);
    expect((await ledgerOf(h, f)).closingBalance).toBe(30000); // reconnection fee billed through the ledger

    expect((await h.call('CASHIER', 'POST', `/reconnections/${request.body.id}/complete`, { completionDate: today() })).status).toBe(403);
    const done = await h.call('TECHNICIAN', 'POST', `/reconnections/${request.body.id}/complete`, { completionDate: today(), notes: 'Restored' });
    expect(done.body).toMatchObject({ status: 'COMPLETED', completionDate: today() });
    expect((await h.call('ADMIN', 'GET', `/service-accounts/${f.account.id}`)).body.status).toBe('ACTIVE');
    const events = await h.call('ADMIN', 'GET', `/subscribers/${f.subscriber.id}/service-events`);
    expect(events.body.map((e: any) => e.eventType)).toEqual(expect.arrayContaining(['ACTIVATED', 'SUSPENDED', 'RECONNECTION_REQUESTED', 'RECONNECTED']));
    const suspensions = await h.call('ADMIN', 'GET', `/suspensions?subscriberId=${f.subscriber.id}`);
    expect(suspensions.body.rows[0]).toMatchObject({ isActive: false, arrearsAtSuspension: 199800, approvedByName: 'Test Administrator' });
  });

  it('subscribers and service accounts are closed by status, never deleted', async () => {
    const f = await createSubscriberWithService(h, 99900);
    expect((await h.call('ADMIN', 'PATCH', `/subscribers/${f.subscriber.id}`, { status: 'TERMINATED', statusReason: 'Moved away' })).status).toBe(422);
    await h.call('ADMIN', 'POST', `/service-accounts/${f.account.id}/terminate`, { reason: 'Moved away from the service area', effectiveDate: today() });
    const closed = await h.call('ADMIN', 'PATCH', `/subscribers/${f.subscriber.id}`, { status: 'TERMINATED', statusReason: 'Moved away' });
    expect(closed.body.status).toBe('TERMINATED');
    expect((await h.call('ADMIN', 'GET', `/subscribers/${f.subscriber.id}`)).status).toBe(200);
    // No DELETE endpoint exists for subscribers at all.
    expect((await h.app.inject({ method: 'DELETE', url: `/api/subscribers/${f.subscriber.id}` })).statusCode).toBe(404);
  });
});

describe('search and reports', () => {
  it('global search finds subscribers, invoices, receipts and GCash references', async () => {
    const f = await createSubscriberWithService(h, 99900);
    const invoice = await bill(h, f, '2025-09');
    const reference = `55${Date.now()}`;
    const payment = await pay(h, f, 99900, { method: 'GCASH', referenceNo: reference }, 'ADMIN');
    const find = async (q: string) => (await h.call<SearchResult[]>('ADMIN', 'GET', `/search?q=${encodeURIComponent(q)}`)).body.map((r) => r.kind);
    expect(await find(f.subscriber.accountNo)).toContain('SUBSCRIBER');
    expect(await find(f.subscriber.lastName)).toContain('SUBSCRIBER');
    expect(await find(invoice.invoiceNo!)).toContain('INVOICE');
    expect(await find(payment.body.receiptNo)).toContain('RECEIPT');
    expect(await find(reference)).toContain('GCASH');
    // A technician's search never returns financial records.
    const tech = await h.call<SearchResult[]>('TECHNICIAN', 'GET', `/search?q=${payment.body.receiptNo}`);
    expect(tech.body).toEqual([]);
  });

  it('every report builds, totals are consistent, and PDF/XLSX/CSV exports are real files', async () => {
    const f = await createSubscriberWithService(h, 99900);
    await bill(h, f, '2025-09');
    await pay(h, f, 50000);
    const catalog = await h.call('OWNER', 'GET', '/reports');
    expect(catalog.body.length).toBeGreaterThanOrEqual(15);
    for (const def of catalog.body) {
      const res = await h.call<ReportData>('OWNER', 'GET', `/reports/${def.key}?from=2025-01-01&to=${today()}&subscriberId=${f.subscriber.id}`);
      expect(res.status, def.key).toBe(200);
      expect(res.body.columns.length, def.key).toBeGreaterThan(2);
    }

    const collections = await h.call<ReportData>('OWNER', 'GET', `/reports/collections?from=${today()}&to=${today()}&groupBy=day`);
    const row = collections.body.rows[0];
    expect(Number(row.cash) + Number(row.gcash) + Number(row.bank) + Number(row.cheque) + Number(row.other)).toBe(row.total);
    const direct = await h.sql<{ total: number }>(sql`select sum(amount)::bigint as total from payments where status = 'POSTED' and payment_date = ${today()}`);
    expect(collections.body.totals!.total).toBe(direct[0].total);

    const soa = await h.call<ReportData>('OWNER', 'GET', `/reports/subscriber-soa?subscriberId=${f.subscriber.id}&from=2025-01-01&to=${today()}`);
    expect(soa.body.totals).toMatchObject({ debit: 99900, credit: 50000, balance: 49900 });
    expect(soa.body.header[1]).toEqual({ label: 'Account No.', value: f.subscriber.accountNo });

    const signature = async (format: string) => ((await h.call('OWNER', 'GET', `/reports/ar-aging?format=${format}`)).body as Buffer).subarray(0, 4).toString('latin1');
    expect(await signature('pdf')).toBe('%PDF');
    expect(await signature('xlsx')).toBe('PK\u0003\u0004');
    const csv = (await h.call('OWNER', 'GET', `/reports/subscriber-soa?subscriberId=${f.subscriber.id}&from=2025-01-01&format=csv`)).body as Buffer;
    expect(csv.toString('utf8')).toContain('CLOSING BALANCE,,,999.00,500.00,499.00');

    // Technicians have no report access; exports are audited.
    expect((await h.call('TECHNICIAN', 'GET', '/reports/collections')).status).toBe(403);
    expect((await h.sql(sql`select count(*)::int as n from audit_logs where action = 'report.export'`))[0].n).toBeGreaterThanOrEqual(3);
  });

  it('the dashboard KPIs agree with the receivables summary', async () => {
    const [dashboard, summary] = await Promise.all([h.call('OWNER', 'GET', '/dashboard'), h.call<ReceivableSummary>('OWNER', 'GET', '/receivables/summary')]);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.kpis.currentReceivable).toBe(summary.body.currentReceivable);
    expect(dashboard.body.kpis.overdueReceivable).toBe(summary.body.overdueReceivable);
    expect(dashboard.body.aging.total).toBe(summary.body.totalReceivable);
    expect(dashboard.body.billingVsCollection).toHaveLength(6);
    expect((await h.call('OWNER', 'GET', '/integrity-check')).body.ok).toBe(true);
  });
});
