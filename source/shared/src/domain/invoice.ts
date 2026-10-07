import type { ISODate } from '../dates';
import type { InvoiceItemType, InvoiceStatus } from '../enums';
import { assertCentavos, type Centavos } from '../money';
import { DomainError } from './errors';

export interface InvoiceItemInput {
  itemType: InvoiceItemType;
  description: string;
  quantity: number;
  /** Signed unit amount in centavos. Discounts are negative. */
  unitAmount: Centavos;
}

export interface InvoiceTotals {
  subtotal: Centavos;
  discountTotal: Centavos;
  total: Centavos;
}

export function lineAmount(item: Pick<InvoiceItemInput, 'quantity' | 'unitAmount'>): Centavos {
  assertCentavos(item.unitAmount, 'unit amount');
  if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new DomainError('INVALID_ITEM', 'Quantity must be a positive whole number.');
  return item.quantity * item.unitAmount;
}

/** Charges add up to the subtotal; negative lines are discounts. The total can never be negative. */
export function computeInvoiceTotals(items: readonly InvoiceItemInput[]): InvoiceTotals {
  let subtotal = 0;
  let discountTotal = 0;
  for (const item of items) {
    const amount = lineAmount(item);
    if (item.itemType === 'DISCOUNT' && amount > 0) throw new DomainError('INVALID_ITEM', 'Discount lines must be negative.');
    if (amount < 0) discountTotal += -amount;
    else subtotal += amount;
  }
  const total = subtotal - discountTotal;
  if (total < 0) throw new DomainError('INVALID_TOTAL', 'Discounts cannot exceed the invoice charges.');
  return { subtotal, discountTotal, total };
}

export interface InvoiceAmounts {
  total: Centavos;
  /** Net posted adjustments: debit adjustments positive, credit adjustments negative. */
  adjustmentsTotal: Centavos;
  amountPaid: Centavos;
}

export function invoiceBalance(inv: InvoiceAmounts): Centavos {
  return inv.total + inv.adjustmentsTotal - inv.amountPaid;
}

/**
 * Single source of truth for the invoice state machine.
 *
 *  DRAFT          not finalized, not in the ledger
 *  VOID           cancelled through the void workflow
 *  PAID           nothing left to pay and at least one payment was applied
 *  CREDITED       balance cleared entirely by credit adjustments (no payment)
 *  PARTIALLY_PAID some value applied, balance remains (regardless of due date)
 *  OVERDUE        nothing applied yet and the due date has passed
 *  UNPAID         nothing applied yet and not yet due
 *
 * Receivable ageing never relies on this status: it is always computed from
 * due date and balance, so a partially paid invoice that is past due is still aged.
 */
export function deriveInvoiceStatus(
  inv: InvoiceAmounts & { finalized: boolean; voided: boolean; dueDate: ISODate },
  today: ISODate,
): InvoiceStatus {
  if (inv.voided) return 'VOID';
  if (!inv.finalized) return 'DRAFT';
  const balance = invoiceBalance(inv);
  if (balance < 0) throw new DomainError('NEGATIVE_BALANCE', 'Invoice balance cannot be negative.');
  if (balance === 0) return inv.amountPaid > 0 || inv.total === 0 ? 'PAID' : 'CREDITED';
  if (inv.amountPaid > 0 || inv.adjustmentsTotal < 0) return 'PARTIALLY_PAID';
  return inv.dueDate < today ? 'OVERDUE' : 'UNPAID';
}
