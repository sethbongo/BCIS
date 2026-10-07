import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  agingBucket,
  ALL_PERMISSIONS,
  allocateManually,
  allocateOldestFirst,
  computeInvoiceTotals,
  computeRemittanceVariance,
  deriveInvoiceStatus,
  diffDays,
  DomainError,
  dueDateFor,
  formatMoney,
  invoiceBalance,
  isISODate,
  overdueTotal,
  parseMoney,
  periodBounds,
  periodLabel,
  permissionsForRoles,
  ROLES,
  summarizeAging,
  todayInTimeZone,
  type OpenInvoice,
} from '../index';

const inv = (id: number, dueDate: string, balance: number): OpenInvoice => ({ id, invoiceNo: `INV-${id}`, invoiceDate: `${dueDate.slice(0, 7)}-01`, dueDate, balance });

describe('money (integer centavos)', () => {
  it('parses user input without floating point', () => {
    expect(parseMoney('999')).toBe(99900);
    expect(parseMoney('999.5')).toBe(99950);
    expect(parseMoney('₱ 1,234.56')).toBe(123456);
    expect(parseMoney('0.07')).toBe(7);
    // 0.1 + 0.2 is the classic float trap: 10 + 20 centavos must be exactly 30.
    expect(parseMoney('0.10')! + parseMoney('0.20')!).toBe(30);
    expect(parseMoney('19.99')! * 3).toBe(5997);
  });

  it('rejects invalid amounts', () => {
    for (const bad of ['', 'abc', '1.234', '1.2.3', '--5', '12a']) expect(parseMoney(bad)).toBeNull();
  });

  it('formats centavos for display', () => {
    expect(formatMoney(99900)).toBe('999.00');
    expect(formatMoney(123456789)).toBe('1,234,567.89');
    expect(formatMoney(-49900, { symbol: true })).toBe('-₱499.00');
    expect(formatMoney(5)).toBe('0.05');
    expect(() => formatMoney(10.5)).toThrow(RangeError);
  });
});

describe('dates and billing periods', () => {
  it('handles month arithmetic across years', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(periodBounds('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(periodLabel('2026-09')).toBe('September 2026');
  });

  it('computes due dates and day differences', () => {
    expect(dueDateFor('2026-09', 15)).toBe('2026-09-15');
    expect(dueDateFor('2026-02', 31)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-09-15', '2026-10-07')).toBe(22);
    expect(isISODate('2026-02-30')).toBe(false);
    expect(todayInTimeZone('Asia/Manila', new Date('2026-10-07T17:30:00Z'))).toBe('2026-10-08');
  });
});

describe('payment allocation - oldest unpaid invoice first', () => {
  it('AT-01 exact payment clears the invoice', () => {
    const r = allocateOldestFirst([inv(1, '2026-09-15', 99900)], 99900);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ applied: 99900, balanceAfter: 0 });
    expect(r.unapplied).toBe(0);
  });

  it('AT-02 partial payment leaves the remainder on the invoice', () => {
    const r = allocateOldestFirst([inv(1, '2026-09-15', 99900)], 50000);
    expect(r.lines[0]).toMatchObject({ applied: 50000, balanceAfter: 49900 });
    expect(r.unapplied).toBe(0);
  });

  it('AT-03 advance payment keeps the excess as unapplied credit - nothing is lost', () => {
    const r = allocateOldestFirst([inv(1, '2026-09-15', 100000)], 300000);
    expect(r.totalApplied).toBe(100000);
    expect(r.unapplied).toBe(200000);
    expect(r.totalApplied + r.unapplied).toBe(300000);
  });

  it('AT-04 pays August before September regardless of input order', () => {
    const r = allocateOldestFirst([inv(2, '2026-09-15', 99900), inv(1, '2026-08-15', 99900)], 120000);
    expect(r.lines.map((l) => [l.invoiceNo, l.applied, l.balanceAfter])).toEqual([
      ['INV-1', 99900, 0],
      ['INV-2', 20100, 79800],
    ]);
  });

  it('skips settled invoices and handles a subscriber with nothing due', () => {
    expect(allocateOldestFirst([inv(1, '2026-08-15', 0), inv(2, '2026-09-15', 500)], 500).lines).toHaveLength(1);
    expect(allocateOldestFirst([], 12345)).toMatchObject({ lines: [], totalApplied: 0, unapplied: 12345 });
  });

  it('rejects zero, negative and fractional amounts', () => {
    expect(() => allocateOldestFirst([inv(1, '2026-09-15', 100)], 0)).toThrow(DomainError);
    expect(() => allocateOldestFirst([inv(1, '2026-09-15', 100)], -5)).toThrow(DomainError);
    expect(() => allocateOldestFirst([inv(1, '2026-09-15', 100)], 10.5)).toThrow(RangeError);
  });

  it('always conserves the payment across many invoice mixes', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const invoices = Array.from({ length: seed % 6 }, (_, i) => inv(i + 1, `2026-0${(i % 9) + 1}-15`, ((seed * 7919 + i * 104729) % 250000) + 1));
      const amount = ((seed * 31337) % 600000) + 1;
      const r = allocateOldestFirst(invoices, amount);
      expect(r.totalApplied + r.unapplied).toBe(amount);
      expect(r.lines.reduce((s, l) => s + l.applied, 0)).toBe(r.totalApplied);
      for (const line of r.lines) expect(line.balanceAfter).toBeGreaterThanOrEqual(0);
      // Only the last touched invoice may be left partially paid.
      expect(r.lines.slice(0, -1).every((l) => l.balanceAfter === 0)).toBe(true);
    }
  });
});

describe('manual allocation (authorized override)', () => {
  const open = [inv(1, '2026-08-15', 99900), inv(2, '2026-09-15', 99900)];

  it('applies to the chosen invoice and keeps the rest as credit', () => {
    const r = allocateManually(open, 100000, [{ invoiceId: 2, amount: 99900 }]);
    expect(r.lines[0]).toMatchObject({ invoiceId: 2, balanceAfter: 0 });
    expect(r.unapplied).toBe(100);
  });

  it('refuses over-allocation, duplicates and foreign invoices', () => {
    expect(() => allocateManually(open, 50000, [{ invoiceId: 1, amount: 60000 }])).toThrow(/exceed/);
    expect(() => allocateManually(open, 200000, [{ invoiceId: 1, amount: 100000 }])).toThrow(/exceeds its remaining balance/);
    expect(() => allocateManually(open, 1000, [{ invoiceId: 1, amount: 500 }, { invoiceId: 1, amount: 500 }])).toThrow(/only once/);
    expect(() => allocateManually(open, 1000, [{ invoiceId: 99, amount: 500 }])).toThrow(/not open/);
  });
});

describe('invoice totals and state machine', () => {
  it('adds charges and subtracts discounts', () => {
    const totals = computeInvoiceTotals([
      { itemType: 'SUBSCRIPTION', description: 'Plan', quantity: 1, unitAmount: 129900 },
      { itemType: 'INSTALLATION_FEE', description: 'Install', quantity: 1, unitAmount: 150000 },
      { itemType: 'DISCOUNT', description: 'Promo', quantity: 1, unitAmount: -10000 },
    ]);
    expect(totals).toEqual({ subtotal: 279900, discountTotal: 10000, total: 269900 });
    expect(() => computeInvoiceTotals([{ itemType: 'DISCOUNT', description: 'x', quantity: 1, unitAmount: -1 }])).toThrow(DomainError);
  });

  const base = { total: 99900, adjustmentsTotal: 0, amountPaid: 0, finalized: true, voided: false, dueDate: '2026-09-15' };
  it('derives every status from amounts and dates', () => {
    expect(deriveInvoiceStatus({ ...base, finalized: false }, '2026-09-01')).toBe('DRAFT');
    expect(deriveInvoiceStatus(base, '2026-09-15')).toBe('UNPAID');
    expect(deriveInvoiceStatus(base, '2026-09-16')).toBe('OVERDUE');
    expect(deriveInvoiceStatus({ ...base, amountPaid: 50000 }, '2026-09-01')).toBe('PARTIALLY_PAID');
    expect(deriveInvoiceStatus({ ...base, amountPaid: 50000 }, '2026-12-01')).toBe('PARTIALLY_PAID');
    expect(deriveInvoiceStatus({ ...base, amountPaid: 99900 }, '2026-12-01')).toBe('PAID');
    expect(deriveInvoiceStatus({ ...base, adjustmentsTotal: -99900 }, '2026-12-01')).toBe('CREDITED');
    expect(deriveInvoiceStatus({ ...base, adjustmentsTotal: -20000, amountPaid: 79900 }, '2026-12-01')).toBe('PAID');
    expect(deriveInvoiceStatus({ ...base, voided: true, amountPaid: 0 }, '2026-12-01')).toBe('VOID');
    expect(invoiceBalance({ total: 99900, adjustmentsTotal: 5000, amountPaid: 50000 })).toBe(54900);
  });

  it('never allows a negative balance', () => {
    expect(() => deriveInvoiceStatus({ ...base, amountPaid: 100000 }, '2026-09-01')).toThrow(DomainError);
  });
});

describe('accounts receivable aging', () => {
  it('uses the documented bucket boundaries', () => {
    const asOf = '2026-10-07';
    expect(agingBucket('2026-10-07', asOf)).toBe('CURRENT');
    expect(agingBucket('2026-10-06', asOf)).toBe('D1_30');
    expect(agingBucket('2026-09-07', asOf)).toBe('D1_30');
    expect(agingBucket('2026-09-06', asOf)).toBe('D31_60');
    expect(agingBucket('2026-08-08', asOf)).toBe('D31_60');
    expect(agingBucket('2026-08-07', asOf)).toBe('D61_90');
    expect(agingBucket('2026-07-09', asOf)).toBe('D61_90');
    expect(agingBucket('2026-07-08', asOf)).toBe('D90_PLUS');
  });

  it('bucket totals reconcile to the outstanding balances', () => {
    const invoices = [
      { dueDate: '2026-10-20', balance: 99900 },
      { dueDate: '2026-09-20', balance: 49900 },
      { dueDate: '2026-08-20', balance: 99900 },
      { dueDate: '2026-07-20', balance: 65000 },
      { dueDate: '2026-05-20', balance: 129900 },
      { dueDate: '2026-05-20', balance: 0 },
    ];
    const totals = summarizeAging(invoices, '2026-10-07');
    expect(totals).toEqual({ CURRENT: 99900, D1_30: 49900, D31_60: 99900, D61_90: 65000, D90_PLUS: 129900, total: 444600 });
    expect(overdueTotal(totals)).toBe(344700);
    expect(totals.total).toBe(invoices.reduce((s, i) => s + i.balance, 0));
  });
});

describe('collector remittance reconciliation', () => {
  it('AT-07 balanced remittance', () => {
    expect(computeRemittanceVariance(2000000, 2000000)).toEqual({ difference: 0, type: 'BALANCED', amount: 0 });
  });
  it('AT-08 shortage is reported, never rounded away', () => {
    expect(computeRemittanceVariance(2000000, 1950000)).toEqual({ difference: -50000, type: 'SHORTAGE', amount: 50000 });
    expect(computeRemittanceVariance(2000000, 1999999)).toMatchObject({ type: 'SHORTAGE', amount: 1 });
  });
  it('overage is reported', () => {
    expect(computeRemittanceVariance(2000000, 2010000)).toEqual({ difference: 10000, type: 'OVERAGE', amount: 10000 });
  });
});

describe('role and permission matrix', () => {
  const has = (role: string, permission: string) => permissionsForRoles([role]).includes(permission as never);

  it('gives the owner every permission and nobody an unknown one', () => {
    expect(permissionsForRoles(['OWNER']).sort()).toEqual([...ALL_PERMISSIONS].sort());
    for (const role of ROLES) for (const p of role.permissions) expect(ALL_PERMISSIONS).toContain(p);
  });

  it('keeps sensitive operations away from lower roles', () => {
    for (const role of ['ADMIN', 'CASHIER', 'COLLECTION_SUPERVISOR', 'ACCOUNTING', 'TECHNICIAN', 'VIEWER']) {
      expect(has(role, 'user.manage')).toBe(false);
      expect(has(role, 'backup.restore')).toBe(false);
      expect(has(role, 'settings.manage')).toBe(false);
    }
    expect(has('CASHIER', 'payment.create')).toBe(true);
    expect(has('CASHIER', 'payment.reverse')).toBe(false);
    expect(has('CASHIER', 'gcash.verify')).toBe(false);
    expect(has('COLLECTION_SUPERVISOR', 'collection.reconcile')).toBe(true);
    expect(has('COLLECTION_SUPERVISOR', 'collection.close')).toBe(false);
    expect(has('TECHNICIAN', 'payment.view')).toBe(false);
  });

  it('read-only roles hold no mutating permission', () => {
    const mutating = /\.(create|update|manage|generate|void|reverse|verify|submit|record|remit|reconcile|close|restore|suspend|reconnect|allocate_manual)$/;
    for (const role of ['VIEWER', 'ACCOUNTING']) expect(permissionsForRoles([role]).filter((p) => mutating.test(p))).toEqual([]);
  });
});
