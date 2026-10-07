/** Mandatory acceptance tests AT-09 (concurrent users), AT-10 (authorization) and AT-11 (duplicate billing). */
import { ROLES, type InvoiceRow, type PaymentDetail, type RoleCode } from '@bcis/shared';
import { sql } from 'drizzle-orm';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bill, createSubscriberWithService, invoicesOf, ledgerOf, pay, startHarness, TEST_PASSWORD, type Fixture, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

/** One "office PC": its own login session talking to the API over real HTTP on the network stack. */
async function officePc(baseUrl: string, role: RoleCode, name: string) {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: role.toLowerCase(), password: TEST_PASSWORD, clientName: name }),
  });
  const { token } = (await login.json()) as { token: string };
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as any };
  };
}

describe('AT-09 Concurrent users', () => {
  it('three clients post and read at the same time: no corruption, no duplicate numbers, no cross-session effect', async () => {
    await h.app.listen({ host: '127.0.0.1', port: 0 });
    const baseUrl = `http://127.0.0.1:${(h.app.server.address() as AddressInfo).port}`;
    const pc1 = await officePc(baseUrl, 'OWNER', 'PC-1 Owner');
    const pc2 = await officePc(baseUrl, 'CASHIER', 'PC-2 Cashier');
    const pc3 = await officePc(baseUrl, 'ADMIN', 'PC-3 Operations');

    const fixtures: Fixture[] = [];
    for (let i = 0; i < 12; i++) {
      const f = await createSubscriberWithService(h, 99900);
      await bill(h, f, '2025-08');
      fixtures.push(f);
    }
    const shared = fixtures[0];

    // All at once: 11 payments for different subscribers split across PC-2 and PC-3,
    // 5 simultaneous partial payments on the SAME invoice, September billing from two PCs,
    // and the owner reading dashboards, receivables and ledgers throughout.
    const payment = (pc: typeof pc1, f: Fixture, amount: number) => pc('POST', '/payments', { subscriberId: f.subscriber.id, amount, method: 'CASH', idempotencyKey: randomUUID() });
    const accountIds = fixtures.map((f) => f.account.id);
    const results = await Promise.all([
      ...fixtures.slice(1).map((f, i) => payment(i % 2 ? pc2 : pc3, f, 99900)),
      ...Array.from({ length: 5 }, (_, i) => payment(i % 2 ? pc3 : pc2, shared, 10000)),
      pc3('POST', '/billing/generate', { period: '2025-09', finalize: true, serviceAccountIds: accountIds }),
      pc1('POST', '/billing/generate', { period: '2025-09', finalize: true, serviceAccountIds: accountIds }),
      pc1('GET', '/dashboard'),
      pc1('GET', '/receivables/aging'),
      pc1('GET', `/subscribers/${shared.subscriber.id}/ledger`),
      pc1('GET', '/payments?pageSize=50'),
    ]);
    expect(results.map((r) => r.status).filter((s) => s !== 200)).toEqual([]);

    // Unique, gapless receipt numbers.
    const receipts = results.slice(0, 16).map((r) => (r.body as PaymentDetail).receiptNo);
    expect(new Set(receipts).size).toBe(16);
    const numbers = receipts.map((r) => Number(r.slice(5))).sort((a, b) => a - b);
    expect(numbers[15] - numbers[0]).toBe(15);

    // No lost update on the shared invoice: 5 x 100.00 against 999.00 + September.
    const sharedInvoices = await invoicesOf(h, shared);
    expect(sharedInvoices.find((i) => i.billingPeriod === '2025-08')).toMatchObject({ amountPaid: 50000, balance: 49900, status: 'PARTIALLY_PAID' });
    expect((await ledgerOf(h, shared)).closingBalance).toBe(49900 + 99900);

    // Two PCs generated the same billing period: every account still has exactly one September invoice.
    const [billingA, billingB] = [results[16].body, results[17].body];
    expect(billingA.created + billingB.created).toBe(12);
    const dupes = await h.sql(sql`select service_account_id from invoices where service_account_id in ${accountIds} and billing_period = '2025-09' and status <> 'VOID' group by 1 having count(*) > 1`);
    expect(dupes).toEqual([]);
    const invoiceNos = await h.sql<{ n: number; d: number }>(sql`select count(invoice_no)::int as n, count(distinct invoice_no)::int as d from invoices`);
    expect(invoiceNos[0].n).toBe(invoiceNos[0].d);

    // Each fully paying subscriber: August paid, whole ledger consistent.
    for (const f of fixtures.slice(1)) {
      const invoices = await invoicesOf(h, f);
      expect(invoices.find((i: InvoiceRow) => i.billingPeriod === '2025-08')).toMatchObject({ status: 'PAID', balance: 0 });
      expect((await ledgerOf(h, f)).closingBalance).toBe(99900);
    }
    const integrity = await pc1('GET', '/integrity-check');
    expect(integrity.body.checks.filter((c: any) => !c.ok)).toEqual([]);

    // Sessions are independent: the cashier's session cannot do owner work, and logging
    // one PC out does not disturb the others.
    expect((await pc2('GET', '/users')).status).toBe(403);
    expect((await pc2('POST', '/auth/logout')).status).toBe(200);
    expect((await pc2('GET', '/payments')).status).toBe(401);
    expect((await pc3('GET', '/payments')).status).toBe(200);
    expect((await pc1('GET', '/users')).status).toBe(200);
    h.forgetSessions();
  });
});

describe('AT-10 Authorization', () => {
  it('a cashier calling admin-only user and backup operations directly is rejected by the server', async () => {
    const newUser = { username: 'intruder', fullName: 'Intruder', password: 'Intruder-Pass-1', roleCodes: ['OWNER'], isActive: true };
    const attempts: [string, 'GET' | 'POST' | 'PATCH' | 'PUT', string, unknown?][] = [
      ['create user', 'POST', '/users', newUser],
      ['list users', 'GET', '/users'],
      ['change roles', 'PATCH', '/users/1', { roleCodes: ['OWNER'] }],
      ['reset password', 'POST', '/users/1/reset-password', { newPassword: 'Hijacked-Pass-1' }],
      ['create backup', 'POST', '/backups', {}],
      ['list backups', 'GET', '/backups'],
      ['restore backup', 'POST', '/backups/1/restore', { confirmation: 'RESTORE', reason: 'trying my luck' }],
      ['change settings', 'PUT', '/settings', { values: { 'security.maxFailedLogins': 20 } }],
      ['read audit log', 'GET', '/audit-logs'],
      ['generate billing', 'POST', '/billing/generate', { period: '2025-09', finalize: true }],
      ['void invoice', 'POST', '/invoices/1/void', { reason: 'no reason at all' }],
      ['create plan', 'POST', '/plans', {}],
    ];
    for (const [label, method, url, body] of attempts) {
      const res = await h.call('CASHIER', method, url, body);
      expect(res.status, label).toBe(403);
      expect(res.body.error.code, label).toBe('FORBIDDEN');
    }
    expect(await h.sql(sql`select 1 from users where username = 'intruder'`)).toEqual([]);
    expect((await h.call('OWNER', 'GET', '/backups')).status).toBe(200);
  });

  it('requests without a valid session are rejected on every protected route', async () => {
    for (const url of ['/subscribers', '/payments', '/dashboard', '/users', '/backups', '/reports/collections', '/lookups', '/settings']) {
      expect((await h.call(null, 'GET', url)).status, url).toBe(401);
    }
    const forged = await h.app.inject({ method: 'GET', url: '/api/users', headers: { authorization: 'Bearer not-a-real-token' } });
    expect(forged.statusCode).toBe(401);
    expect((await h.call(null, 'GET', '/health')).status).toBe(200);
  });

  it('every role receives exactly the permissions of the documented role matrix', async () => {
    for (const role of ROLES) {
      const me = await h.call(role.code, 'GET', '/auth/me');
      expect([...me.body.user.permissions].sort(), role.code).toEqual([...role.permissions].sort());
    }
  });

  it('read-only and operational roles cannot mutate financial data', async () => {
    const f = await createSubscriberWithService(h, 99900);
    await bill(h, f, '2025-09');
    const body = { subscriberId: f.subscriber.id, amount: 1000, method: 'CASH' };
    for (const role of ['VIEWER', 'ACCOUNTING', 'TECHNICIAN'] as const) expect((await h.call(role, 'POST', '/payments', body)).status, role).toBe(403);
    expect((await h.call('TECHNICIAN', 'GET', '/payments')).status).toBe(403);
    expect((await h.call('TECHNICIAN', 'GET', '/service-accounts')).status).toBe(200);
    expect((await h.call('VIEWER', 'GET', '/dashboard')).status).toBe(200);
    expect((await h.call('VIEWER', 'GET', '/reports/audit-trail')).status).toBe(403);
    // GCash without verification authority must go through the verification queue.
    const gcash = await pay(h, f, 1000, { method: 'GCASH', referenceNo: '1234567890123' }, 'CASHIER');
    expect(gcash.status).toBe(403);
  });

  it('locks the account after repeated failed logins and supports session lock/unlock', async () => {
    const login = (password: string) => h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'viewer', password } });
    for (let i = 0; i < 5; i++) expect((await login('wrong-password')).statusCode).toBe(401);
    const locked = await login(TEST_PASSWORD);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('ACCOUNT_LOCKED');
    await h.sql(sql`update users set locked_until = null where username = 'viewer'`);
    expect((await login(TEST_PASSWORD)).statusCode).toBe(200);

    // Session lock: nothing works until the password is re-entered.
    expect((await h.call('ACCOUNTING', 'POST', '/auth/lock')).status).toBe(200);
    expect((await h.call('ACCOUNTING', 'GET', '/payments')).status).toBe(423);
    expect((await h.call('ACCOUNTING', 'POST', '/auth/unlock', { password: 'nope' })).status).toBe(401);
    expect((await h.call('ACCOUNTING', 'POST', '/auth/unlock', { password: TEST_PASSWORD })).status).toBe(200);
    expect((await h.call('ACCOUNTING', 'GET', '/payments')).status).toBe(200);

    // Passwords are stored only as salted scrypt hashes.
    const stored = await h.sql<{ password_hash: string }>(sql`select password_hash from users`);
    expect(stored.every((u) => u.password_hash.startsWith('scrypt$') && !u.password_hash.includes(TEST_PASSWORD))).toBe(true);
    const failures = await h.sql(sql`select action from audit_logs where action in ('auth.login_failed', 'auth.account_locked') and entity_id = (select id::text from users where username = 'viewer')`);
    expect(failures.length).toBeGreaterThanOrEqual(5);
  });
});

describe('AT-11 Duplicate billing', () => {
  it('running billing generation twice for the same period creates no duplicate invoice', async () => {
    const fixtures = [await createSubscriberWithService(h, 99900), await createSubscriberWithService(h, 129900), await createSubscriberWithService(h, 45000)];
    const serviceAccountIds = fixtures.map((f) => f.account.id);

    const first = await h.call('ADMIN', 'POST', '/billing/generate', { period: '2025-11', finalize: true, serviceAccountIds });
    expect(first.body).toMatchObject({ created: 3, finalized: 3, skippedAlreadyBilled: 0, totalBilled: 274800 });
    const second = await h.call('ADMIN', 'POST', '/billing/generate', { period: '2025-11', finalize: true, serviceAccountIds });
    expect(second.body).toMatchObject({ created: 0, finalized: 0, skippedAlreadyBilled: 3, totalBilled: 0 });

    for (const f of fixtures) {
      const invoices = (await invoicesOf(h, f)).filter((i) => i.billingPeriod === '2025-11');
      expect(invoices).toHaveLength(1);
      expect((await ledgerOf(h, f)).rows.filter((r) => r.sourceType === 'INVOICE')).toHaveLength(1);
    }
    // The database constraint is the last line of defence.
    const [existing] = await invoicesOf(h, fixtures[0]);
    await expect(
      h.sql(sql`insert into invoices (invoice_no, subscriber_id, service_account_id, billing_period, invoice_date, due_date, subtotal, total, balance, status)
                values ('INV-DUPE', ${existing.subscriberId}, ${existing.serviceAccountId}, '2025-11', '2025-11-01', '2025-11-15', 99900, 99900, 99900, 'UNPAID')`),
    ).rejects.toThrow();
  });

  it('drafts are reviewed before finalizing, and a voided invoice can be re-billed once', async () => {
    const f = await createSubscriberWithService(h, 99900);
    const draft = await h.call('ADMIN', 'POST', '/billing/generate', { period: '2025-12', finalize: false, serviceAccountIds: [f.account.id] });
    expect(draft.body).toMatchObject({ created: 1, finalized: 0 });
    expect((await invoicesOf(h, f))[0]).toMatchObject({ status: 'DRAFT', invoiceNo: null });
    expect((await ledgerOf(h, f)).rows).toHaveLength(0);

    await h.call('ADMIN', 'POST', '/billing/finalize-drafts', { period: '2025-12' });
    const [finalized] = await invoicesOf(h, f);
    expect(finalized.invoiceNo).toMatch(/^INV-/);
    expect((await ledgerOf(h, f)).closingBalance).toBe(99900);

    // Void (not delete): the invoice stays in history and the ledger is offset.
    await pay(h, f, 10000);
    expect((await h.call('ADMIN', 'POST', `/invoices/${finalized.id}/void`, { reason: 'Billed in error' })).status).toBe(409);
    const f2 = await createSubscriberWithService(h, 99900);
    const inv2 = await bill(h, f2, '2025-12');
    const voided = await h.call('ADMIN', 'POST', `/invoices/${inv2.id}/void`, { reason: 'Billed in error - wrong plan' });
    expect(voided.body).toMatchObject({ status: 'VOID', balance: 0, voidReason: 'Billed in error - wrong plan' });
    expect((await ledgerOf(h, f2)).closingBalance).toBe(0);
    const rebilled = await h.call('ADMIN', 'POST', '/billing/generate', { period: '2025-12', finalize: true, serviceAccountIds: [f2.account.id] });
    expect(rebilled.body.created).toBe(1);
    expect((await invoicesOf(h, f2)).map((i) => i.status).sort()).toEqual(['OVERDUE', 'VOID']);
  });
});
