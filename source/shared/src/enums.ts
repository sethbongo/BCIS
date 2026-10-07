export const INVOICE_STATUSES = ['DRAFT', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID', 'CREDITED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Finalized invoices that can still receive payment allocations. */
export const OPEN_INVOICE_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'] as const satisfies readonly InvoiceStatus[];

export const INVOICE_TYPES = ['MONTHLY', 'ONE_TIME'] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const INVOICE_ITEM_TYPES = ['SUBSCRIPTION', 'INSTALLATION_FEE', 'RECONNECTION_FEE', 'DISCOUNT', 'PENALTY', 'OTHER'] as const;
export type InvoiceItemType = (typeof INVOICE_ITEM_TYPES)[number];

export const PAYMENT_METHODS = ['CASH', 'GCASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['POSTED', 'REVERSED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ALLOCATION_TYPES = ['AUTO', 'MANUAL', 'CREDIT'] as const;
export type AllocationType = (typeof ALLOCATION_TYPES)[number];

export const PROOF_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export type ProofStatus = (typeof PROOF_STATUSES)[number];

export const RECEIPT_STATUSES = ['ISSUED', 'VOID'] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const SUBSCRIBER_STATUSES = ['ACTIVE', 'INACTIVE', 'TERMINATED', 'ARCHIVED'] as const;
export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number];

export const SERVICE_ACCOUNT_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'DISCONNECTED', 'TERMINATED'] as const;
export type ServiceAccountStatus = (typeof SERVICE_ACCOUNT_STATUSES)[number];

export const SERVICE_TYPE_CODES = ['INTERNET', 'CABLE', 'COMBO'] as const;
export type ServiceTypeCode = (typeof SERVICE_TYPE_CODES)[number];

export const BATCH_STATUSES = ['OPEN', 'IN_PROGRESS', 'SUBMITTED', 'REMITTED', 'RECONCILED', 'CLOSED'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const BATCH_OUTCOMES = ['PENDING', 'COLLECTED', 'PARTIAL', 'NOT_HOME', 'PROMISED', 'REFUSED'] as const;
export type BatchOutcome = (typeof BATCH_OUTCOMES)[number];

export const VARIANCE_TYPES = ['BALANCED', 'SHORTAGE', 'OVERAGE'] as const;
export type VarianceType = (typeof VARIANCE_TYPES)[number];

export const ADJUSTMENT_TYPES = ['DEBIT', 'CREDIT'] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

export const LEDGER_SOURCES = ['INVOICE', 'INVOICE_VOID', 'PAYMENT', 'PAYMENT_REVERSAL', 'ADJUSTMENT'] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];

export const RECONNECTION_STATUSES = ['REQUESTED', 'COMPLETED', 'CANCELLED'] as const;
export type ReconnectionStatus = (typeof RECONNECTION_STATUSES)[number];

export const AGING_BUCKETS = ['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  CURRENT: 'Current',
  D1_30: '1–30 days',
  D31_60: '31–60 days',
  D61_90: '61–90 days',
  D90_PLUS: '90+ days',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  GCASH: 'GCash',
  BANK_TRANSFER: 'Bank Transfer',
  CHEQUE: 'Cheque',
  OTHER: 'Other',
};

/** Human label for any SCREAMING_SNAKE status: PARTIALLY_PAID -> "Partially Paid". */
export function statusLabel(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
