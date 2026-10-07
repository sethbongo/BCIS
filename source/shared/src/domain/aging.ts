import { diffDays, type ISODate } from '../dates';
import { AGING_BUCKETS, type AgingBucket } from '../enums';
import type { Centavos } from '../money';

/** Days past the due date as of a given date; zero or negative means not yet overdue. */
export function daysPastDue(dueDate: ISODate, asOf: ISODate): number {
  return diffDays(dueDate, asOf);
}

export function agingBucket(dueDate: ISODate, asOf: ISODate): AgingBucket {
  const days = daysPastDue(dueDate, asOf);
  if (days <= 0) return 'CURRENT';
  if (days <= 30) return 'D1_30';
  if (days <= 60) return 'D31_60';
  if (days <= 90) return 'D61_90';
  return 'D90_PLUS';
}

export type AgingTotals = Record<AgingBucket, Centavos> & { total: Centavos };

export function emptyAging(): AgingTotals {
  return { CURRENT: 0, D1_30: 0, D31_60: 0, D61_90: 0, D90_PLUS: 0, total: 0 };
}

/** Buckets open invoice balances; the bucket sum always equals the sum of the balances. */
export function summarizeAging(invoices: readonly { dueDate: ISODate; balance: Centavos }[], asOf: ISODate): AgingTotals {
  const totals = emptyAging();
  for (const inv of invoices) {
    if (inv.balance <= 0) continue;
    totals[agingBucket(inv.dueDate, asOf)] += inv.balance;
    totals.total += inv.balance;
  }
  return totals;
}

export function overdueTotal(totals: AgingTotals): Centavos {
  return AGING_BUCKETS.filter((b) => b !== 'CURRENT').reduce((sum, b) => sum + totals[b], 0);
}
