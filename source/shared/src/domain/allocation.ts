import { assertCentavos, type Centavos } from '../money';
import { DomainError } from './errors';

export interface OpenInvoice {
  id: number;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  balance: Centavos;
}

export interface AllocationLine {
  invoiceId: number;
  invoiceNo: string;
  dueDate: string;
  balanceBefore: Centavos;
  applied: Centavos;
  balanceAfter: Centavos;
}

export interface AllocationResult {
  lines: AllocationLine[];
  totalApplied: Centavos;
  /** Amount not applied to any invoice. It is kept on the payment as subscriber advance credit. */
  unapplied: Centavos;
}

/** Oldest first: earliest due date, then earliest invoice date, then lowest id (creation order). */
export function sortOldestFirst<T extends Pick<OpenInvoice, 'id' | 'invoiceDate' | 'dueDate'>>(invoices: readonly T[]): T[] {
  return [...invoices].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.invoiceDate.localeCompare(b.invoiceDate) || a.id - b.id,
  );
}

/**
 * Default allocation rule. The payment is applied to the oldest open invoice first and
 * continues until the money or the invoices run out. Nothing is ever discarded:
 * totalApplied + unapplied always equals the payment amount.
 */
export function allocateOldestFirst(invoices: readonly OpenInvoice[], amount: Centavos): AllocationResult {
  assertCentavos(amount, 'payment amount');
  if (amount <= 0) throw new DomainError('INVALID_AMOUNT', 'Payment amount must be greater than zero.');

  let remaining = amount;
  const lines: AllocationLine[] = [];
  for (const inv of sortOldestFirst(invoices)) {
    if (remaining === 0) break;
    assertCentavos(inv.balance, 'invoice balance');
    if (inv.balance <= 0) continue;
    const applied = Math.min(remaining, inv.balance);
    lines.push({
      invoiceId: inv.id,
      invoiceNo: inv.invoiceNo,
      dueDate: inv.dueDate,
      balanceBefore: inv.balance,
      applied,
      balanceAfter: inv.balance - applied,
    });
    remaining -= applied;
  }
  return { lines, totalApplied: amount - remaining, unapplied: remaining };
}

export interface ManualAllocationRequest {
  invoiceId: number;
  amount: Centavos;
}

/**
 * Validates an authorized manual allocation. Each line must target a distinct open invoice of
 * the subscriber, may not exceed that invoice's balance, and the total may not exceed the payment.
 */
export function allocateManually(
  invoices: readonly OpenInvoice[],
  amount: Centavos,
  requested: readonly ManualAllocationRequest[],
): AllocationResult {
  assertCentavos(amount, 'payment amount');
  if (amount <= 0) throw new DomainError('INVALID_AMOUNT', 'Payment amount must be greater than zero.');

  const byId = new Map(invoices.map((inv) => [inv.id, inv]));
  const seen = new Set<number>();
  const lines: AllocationLine[] = [];
  let total = 0;
  for (const req of requested) {
    assertCentavos(req.amount, 'allocation amount');
    if (req.amount <= 0) throw new DomainError('INVALID_ALLOCATION', 'Each allocation must be greater than zero.');
    if (seen.has(req.invoiceId)) throw new DomainError('INVALID_ALLOCATION', 'An invoice may appear only once in an allocation.');
    seen.add(req.invoiceId);
    const inv = byId.get(req.invoiceId);
    if (!inv) throw new DomainError('INVALID_ALLOCATION', 'Allocation refers to an invoice that is not open for this subscriber.');
    if (req.amount > inv.balance) {
      throw new DomainError('OVER_ALLOCATION', `Allocation to ${inv.invoiceNo} exceeds its remaining balance.`);
    }
    total += req.amount;
    lines.push({
      invoiceId: inv.id,
      invoiceNo: inv.invoiceNo,
      dueDate: inv.dueDate,
      balanceBefore: inv.balance,
      applied: req.amount,
      balanceAfter: inv.balance - req.amount,
    });
  }
  if (total > amount) throw new DomainError('OVER_ALLOCATION', 'Allocations exceed the payment amount.');
  return { lines, totalApplied: total, unapplied: amount - total };
}
