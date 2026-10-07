/**
 * Mandatory acceptance tests AT-01 to AT-06: billing, ledger, payment allocation,
 * GCash duplicate protection and reversal. They run through the real HTTP API
 * (authentication, authorization, validation, services, PostgreSQL).
 */
import type { PaymentDetail, ProofRow } from '@bcis/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bill, createSubscriberWithService, gcashReference, invoicesOf, ledgerOf, pay, proofFile, startHarness, today, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

describe('AT-01 Exact payment', () => {
  it('invoice 999.00 + payment 999.00 -> remaining 0, PAID, ledger balanced, receipt created', async () => {
    const f = await createSubscriberWithService(h, 99900);
    const invoice = await bill(h, f, '2025-09');
    expect(invoice).toMatchObject({ total: 99900, balance: 99900 });
    expect(invoice.invoiceNo).toMatch(/^INV-\d{6}$/);

    const payment = await pay(h, f, 99900);
    expect(payment.status).toBe(200);
    expect(payment.body.receiptNo).toMatch(/^RCPT-\d{6}$/);
    expect(payment.body).toMatchObject({ status: 'POSTED', receiptStatus: 'ISSUED', unappliedAmount: 0, balanceAfter: 0 });
    expect(payment.body.allocations).toEqual([expect.objectContaining({ invoiceId: invoice.id, amount: 99900, type: 'AUTO' })]);

    const [after] = await invoicesOf(h, f);
    expect(after).toMatchObject({ status: 'PAID', amountPaid: 99900, balance: 0 });

    const ledger = await ledgerOf(h, f);
    expect(ledger.rows.map((r) => [r.referenceNo, r.debit, r.credit, r.balance])).toEqual([
      [invoice.invoiceNo, 99900, 0, 99900],
      [payment.body.receiptNo, 0, 99900, 0],
    ]);
    expect(ledger).toMatchObject({ totalDebit: 99900, totalCredit: 99900, closingBalance: 0 });
  });
});

describe('AT-02 Partial payment', () => {
  it('invoice 999.00 + payment 500.00 -> remaining 499.00, PARTIALLY_PAID', async () => {
    const f = await createSubscriberWithService(h, 99900);
    const invoice = await bill(h, f, '2025-09');
    const payment = await pay(h, f, 50000);
    expect(payment.body.allocations).toEqual([expect.objectContaining({ invoiceId: invoice.id, amount: 50000 })]);
    expect(payment.body.unappliedAmount).toBe(0);

    const [after] = await invoicesOf(h, f);
    expect(after).toMatchObject({ status: 'PARTIALLY_PAID', amountPaid: 50000, balance: 49900 });
    expect((await ledgerOf(h, f)).closingBalance).toBe(49900);

    // The partial payment is one allocation row for 500.00 against the invoice.
    const allocations = await h.sql(sql`select amount, is_reversed from payment_allocations where invoice_id = ${invoice.id}`);
    expect(allocations).toEqual([{ amount: 50000, is_reversed: false }]);

    // The remaining 499.00 can be settled later and closes the invoice.
    await pay(h, f, 49900);
    expect((await invoicesOf(h, f))[0]).toMatchObject({ status: 'PAID', balance: 0 });
  });
});

describe('AT-03 Advance payment', () => {
  it('monthly 1,000.00 + payment 3,000.00 -> credit is kept and applied to future invoices without losing value', async () => {
    const f = await createSubscriberWithService(h, 100000);
    const first = await bill(h, f, '2025-07');
    const payment = await pay(h, f, 300000);

    // Documented policy: oldest invoices first; the excess stays on the payment as advance credit.
    expect(payment.body.allocations).toEqual([expect.objectContaining({ invoiceId: first.id, amount: 100000 })]);
    expect(payment.body.unappliedAmount).toBe(200000);
    expect(payment.body.balanceAfter).toBe(-200000);
    const subscriber = await h.call('ADMIN', 'GET', `/subscribers/${f.subscriber.id}`);
    expect(subscriber.body).toMatchObject({ outstanding: 0, credit: 200000, balance: -200000 });

    // The next two billing runs consume the credit automatically.
    const second = await bill(h, f, '2025-08');
    expect(second).toMatchObject({ status: 'PAID', amountPaid: 100000, balance: 0 });
    const third = await bill(h, f, '2025-09');
    expect(third).toMatchObject({ status: 'PAID', balance: 0 });

    const detail = await h.call<PaymentDetail>('ADMIN', 'GET', `/payments/${payment.body.id}`);
    expect(detail.body.unappliedAmount).toBe(0);
    expect(detail.body.allocations.map((a) => [a.amount, a.type])).toEqual([
      [100000, 'AUTO'],
      [100000, 'CREDIT'],
      [100000, 'CREDIT'],
    ]);
    // Value check: every centavo of the 3,000.00 is accounted for.
    expect(detail.body.allocations.reduce((s, a) => s + a.amount, 0) + detail.body.unappliedAmount).toBe(300000);
    expect((await ledgerOf(h, f)).closingBalance).toBe(0);

    // A fourth month has no credit left and is simply unpaid.
    const fourth = await bill(h, f, '2025-10');
    expect(fourth).toMatchObject({ amountPaid: 0, balance: 100000 });
  });
});

describe('AT-04 Oldest-first arrears', () => {
  it('August 999.00 + September 999.00, payment 1,200.00 -> August 0.00, September 798.00', async () => {
    const f = await createSubscriberWithService(h, 99900);
    await bill(h, f, '2025-08');
    await bill(h, f, '2025-09');

    const preview = await h.call('CASHIER', 'POST', '/payments/preview', { subscriberId: f.subscriber.id, amount: 120000 });
    expect(preview.body.lines.map((l: any) => [l.applied, l.balanceAfter])).toEqual([
      [99900, 0],
      [20100, 79800],
    ]);

    const payment = await pay(h, f, 120000);
    expect(payment.status).toBe(200);
    const [august, september] = await invoicesOf(h, f);
    expect(august).toMatchObject({ billingPeriod: '2025-08', status: 'PAID', balance: 0 });
    expect(september).toMatchObject({ billingPeriod: '2025-09', status: 'PARTIALLY_PAID', amountPaid: 20100, balance: 79800 });
    expect((await ledgerOf(h, f)).closingBalance).toBe(79800);
  });

  it('manual allocation needs authorization and cannot over-apply', async () => {
    const f = await createSubscriberWithService(h, 99900);
    await bill(h, f, '2025-08');
    const september = await bill(h, f, '2025-09');
    const manual = { allocations: [{ invoiceId: september.id, amount: 99900 }] };

    expect((await pay(h, f, 99900, manual, 'CASHIER')).status).toBe(403);
    expect((await pay(h, f, 99900, { allocations: [{ invoiceId: september.id, amount: 100000 }] }, 'ADMIN')).status).toBe(422);
    const ok = await pay(h, f, 99900, manual, 'ADMIN');
    expect(ok.body.allocations).toEqual([expect.objectContaining({ invoiceId: september.id, type: 'MANUAL' })]);
    const [august, sept] = await invoicesOf(h, f);
    expect([august.balance, sept.balance]).toEqual([99900, 0]);
  });
});

describe('AT-05 Duplicate GCash reference', () => {
  it('a reference that backs a posted payment is flagged at submission and blocked at verification', async () => {
    const first = await createSubscriberWithService(h, 99900);
    const second = await createSubscriberWithService(h, 99900);
    await bill(h, first, '2025-09');
    const secondInvoice = await bill(h, second, '2025-09');
    const referenceNo = gcashReference();
    const submission = (subscriberId: number, seed: number) => ({ subscriberId, referenceNo, senderName: 'Juan Sample', senderNumber: '0917 555 0199', amount: 99900, transactionDate: today(), file: proofFile(seed) });

    // Recording the proof never pays the account by itself.
    const proof = await h.call<ProofRow>('CASHIER', 'POST', '/gcash/proofs', submission(first.subscriber.id, 1));
    expect(proof.status).toBe(200);
    expect(proof.body).toMatchObject({ status: 'PENDING', paymentId: null, duplicates: [] });
    expect((await invoicesOf(h, first))[0].balance).toBe(99900);

    // A cashier cannot verify; the verifier's identity and time are recorded.
    expect((await h.call('CASHIER', 'POST', `/gcash/proofs/${proof.body.id}/verify`, {})).status).toBe(403);
    const verified = await h.call<ProofRow>('ADMIN', 'POST', `/gcash/proofs/${proof.body.id}/verify`, { notes: 'Seen in GCash history' });
    expect(verified.body).toMatchObject({ status: 'VERIFIED', reviewedByName: 'Test Administrator' });
    expect(verified.body.reviewedAt).toBeTruthy();
    expect(verified.body.receiptNo).toMatch(/^RCPT-/);
    expect((await invoicesOf(h, first))[0]).toMatchObject({ status: 'PAID', balance: 0 });

    // Same reference submitted again (here for another subscriber): explicit warning...
    const duplicate = await h.call<ProofRow>('CASHIER', 'POST', '/gcash/proofs', submission(second.subscriber.id, 2));
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicates).toEqual([expect.objectContaining({ kind: 'PAYMENT', status: 'POSTED', receiptNo: verified.body.receiptNo })]);
    // ...and a hard block when someone tries to verify it.
    const blocked = await h.call('ADMIN', 'POST', `/gcash/proofs/${duplicate.body.id}/verify`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('DUPLICATE_GCASH_REFERENCE');
    expect((await h.call<ProofRow>('ADMIN', 'GET', `/gcash/proofs/${duplicate.body.id}`)).body.status).toBe('PENDING');
    expect((await invoicesOf(h, second))[0]).toMatchObject({ id: secondInvoice.id, balance: 99900, amountPaid: 0 });

    // Posting directly with the used reference is blocked too, and the database enforces it independently.
    const direct = await pay(h, second, 99900, { method: 'GCASH', referenceNo: referenceNo.toLowerCase() }, 'ADMIN');
    expect(direct.status).toBe(409);
    await expect(
      h.sql(sql`insert into payments (subscriber_id, payment_date, amount, method, reference_no) values (${second.subscriber.id}, ${today()}, 100, 'GCASH', ${referenceNo})`),
    ).rejects.toThrow();
  });

  it('rejects proof files that are not real images and never trusts the client file name', async () => {
    const f = await createSubscriberWithService(h, 99900);
    const body = { subscriberId: f.subscriber.id, referenceNo: gcashReference(), senderName: 'Juan Sample', senderNumber: '0917 555 0199', amount: 1000, transactionDate: today() };
    const exe = await h.call('CASHIER', 'POST', '/gcash/proofs', { ...body, file: { fileName: 'proof.png', dataBase64: Buffer.from('MZ this is not an image').toString('base64') } });
    expect(exe.status).toBe(422);
    const traversal = await h.call<ProofRow>('CASHIER', 'POST', '/gcash/proofs', { ...body, file: { ...proofFile(3), fileName: '..\\..\\windows\\evil.png' } });
    expect(traversal.status).toBe(200);
    const [stored] = await h.sql(sql`select stored_name, file_name, mime_type from payment_proofs where id = ${traversal.body.id}`);
    expect(stored.stored_name).toMatch(/^\d{4}-\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(stored.file_name).not.toMatch(/[\\/]/);
    const file = await h.call('ADMIN', 'GET', `/gcash/proofs/${traversal.body.id}/file`);
    expect(file.status).toBe(200);
    expect((file.body as Buffer).subarray(1, 4).toString()).toBe('PNG');
  });
});

describe('AT-06 Payment reversal', () => {
  it('original stays visible, linked reversal exists, balances restore, actor and reason are audited', async () => {
    const f = await createSubscriberWithService(h, 99900);
    await bill(h, f, '2025-08');
    await bill(h, f, '2025-09');
    const payment = await pay(h, f, 150000);
    expect((await invoicesOf(h, f)).map((i) => i.balance)).toEqual([0, 49800]);

    const reason = 'Wrong amount keyed in; customer paid 1,000.00';
    expect((await h.call('CASHIER', 'POST', `/payments/${payment.body.id}/reverse`, { reason })).status).toBe(403);
    expect((await h.call('ADMIN', 'POST', `/payments/${payment.body.id}/reverse`, { reason: '' })).status).toBe(400);
    const reversed = await h.call<PaymentDetail>('ADMIN', 'POST', `/payments/${payment.body.id}/reverse`, { reason });
    expect(reversed.status).toBe(200);

    // Original remains, marked reversed, with the same receipt number now VOID.
    expect(reversed.body).toMatchObject({ id: payment.body.id, status: 'REVERSED', receiptNo: payment.body.receiptNo, receiptStatus: 'VOID', amount: 150000 });
    expect(reversed.body.reversal).toMatchObject({ reason, reversedByName: 'Test Administrator' });
    expect(reversed.body.reversal!.reversalNo).toMatch(/^REV-/);
    expect(reversed.body.allocations.every((a) => a.isReversed)).toBe(true);
    const history = await h.call('ADMIN', 'GET', `/payments?subscriberId=${f.subscriber.id}`);
    expect(history.body.rows).toHaveLength(1);

    // Balances are restored.
    expect((await invoicesOf(h, f)).map((i) => [i.status === 'PAID', i.amountPaid, i.balance])).toEqual([
      [false, 0, 99900],
      [false, 0, 99900],
    ]);
    const ledger = await ledgerOf(h, f);
    expect(ledger.closingBalance).toBe(199800);
    expect(ledger.rows.at(-1)).toMatchObject({ sourceType: 'PAYMENT_REVERSAL', debit: 150000, referenceNo: reversed.body.reversal!.reversalNo });

    // Audit trail.
    const audit = await h.call('ACCOUNTING', 'GET', `/audit-logs?subscriberId=${f.subscriber.id}&action=payment.reverse`);
    expect(audit.body.rows).toHaveLength(1);
    expect(audit.body.rows[0]).toMatchObject({ actorUsername: 'admin', reason, entityId: String(payment.body.id) });
    expect(audit.body.rows[0].oldValues.status).toBe('POSTED');
    expect(audit.body.rows[0].newValues.status).toBe('REVERSED');

    // A payment cannot be reversed twice, and the voided receipt number is never issued again.
    expect((await h.call('ADMIN', 'POST', `/payments/${payment.body.id}/reverse`, { reason })).status).toBe(409);
    const next = await pay(h, f, 100000);
    expect(next.body.receiptNo).not.toBe(payment.body.receiptNo);
    expect(Number(next.body.receiptNo.slice(5))).toBeGreaterThan(Number(payment.body.receiptNo.slice(5)));
  });

  it('the database itself refuses to delete or edit posted financial records', async () => {
    const f = await createSubscriberWithService(h, 99900);
    const invoice = await bill(h, f, '2025-09');
    const payment = await pay(h, f, 99900);
    await expect(h.sql(sql`delete from payments where id = ${payment.body.id}`)).rejects.toThrow();
    await expect(h.sql(sql`update payments set amount = 1 where id = ${payment.body.id}`)).rejects.toThrow();
    await expect(h.sql(sql`delete from ledger_entries where subscriber_id = ${f.subscriber.id}`)).rejects.toThrow();
    await expect(h.sql(sql`update ledger_entries set credit = 1 where subscriber_id = ${f.subscriber.id} and credit > 0`)).rejects.toThrow();
    await expect(h.sql(sql`update invoices set total = 1, subtotal = 1 where id = ${invoice.id}`)).rejects.toThrow();
    await expect(h.sql(sql`delete from invoices where id = ${invoice.id}`)).rejects.toThrow();
    await expect(h.sql(sql`update receipts set receipt_no = 'RCPT-999999' where payment_id = ${payment.body.id}`)).rejects.toThrow();
    await expect(h.sql(sql`delete from audit_logs where subscriber_id = ${f.subscriber.id}`)).rejects.toThrow();
  });

  it('a retried request with the same idempotency key posts only once', async () => {
    const f = await createSubscriberWithService(h, 99900);
    await bill(h, f, '2025-09');
    const idempotencyKey = '5b0e7b1c-4e0e-4a6f-9d2b-0a1b2c3d4e5f'.replace('5b0e', Math.random().toString(16).slice(2, 6).padEnd(4, '0'));
    const a = await pay(h, f, 50000, { idempotencyKey });
    const b = await pay(h, f, 50000, { idempotencyKey });
    expect(b.body.id).toBe(a.body.id);
    expect((await invoicesOf(h, f))[0].balance).toBe(49900);
  });
});
