/**
 * PostgreSQL schema (Drizzle). Column names are snake_case in the database
 * (see `casing` in drizzle.config.ts and db/client.ts).
 *
 * Conventions
 *  - money: BIGINT integer centavos, never floating point
 *  - business dates: DATE; audit timestamps: TIMESTAMPTZ
 *  - posted financial rows are never deleted; see the 0001 migration for the guard triggers
 */
import {
  ADJUSTMENT_TYPES,
  ALLOCATION_TYPES,
  BATCH_OUTCOMES,
  BATCH_STATUSES,
  INVOICE_ITEM_TYPES,
  INVOICE_STATUSES,
  INVOICE_TYPES,
  LEDGER_SOURCES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PROOF_STATUSES,
  RECEIPT_STATUSES,
  RECONNECTION_STATUSES,
  SERVICE_ACCOUNT_STATUSES,
  SERVICE_TYPE_CODES,
  SUBSCRIBER_STATUSES,
  VARIANCE_TYPES,
} from '@bcis/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const money = () => bigint({ mode: 'number' });
const ts = () => timestamp({ withTimezone: true, mode: 'date' });
const createdAt = () => ts().notNull().defaultNow();

export const subscriberStatus = pgEnum('subscriber_status', SUBSCRIBER_STATUSES);
export const serviceTypeCode = pgEnum('service_type_code', SERVICE_TYPE_CODES);
export const serviceAccountStatus = pgEnum('service_account_status', SERVICE_ACCOUNT_STATUSES);
export const invoiceStatus = pgEnum('invoice_status', INVOICE_STATUSES);
export const invoiceType = pgEnum('invoice_type', INVOICE_TYPES);
export const invoiceItemType = pgEnum('invoice_item_type', INVOICE_ITEM_TYPES);
export const adjustmentType = pgEnum('adjustment_type', ADJUSTMENT_TYPES);
export const ledgerSource = pgEnum('ledger_source', LEDGER_SOURCES);
export const paymentMethod = pgEnum('payment_method', PAYMENT_METHODS);
export const paymentStatus = pgEnum('payment_status', PAYMENT_STATUSES);
export const allocationType = pgEnum('allocation_type', ALLOCATION_TYPES);
export const proofStatus = pgEnum('proof_status', PROOF_STATUSES);
export const receiptStatus = pgEnum('receipt_status', RECEIPT_STATUSES);
export const batchStatus = pgEnum('batch_status', BATCH_STATUSES);
export const batchOutcome = pgEnum('batch_outcome', BATCH_OUTCOMES);
export const varianceType = pgEnum('variance_type', VARIANCE_TYPES);
export const reconnectionStatus = pgEnum('reconnection_status', RECONNECTION_STATUSES);

// ======================= Security =======================
export const users = pgTable('users', {
  id: serial().primaryKey(),
  username: varchar({ length: 40 }).notNull().unique(),
  fullName: varchar({ length: 120 }).notNull(),
  email: varchar({ length: 160 }),
  passwordHash: text().notNull(),
  isActive: boolean().notNull().default(true),
  failedLoginCount: integer().notNull().default(0),
  lockedUntil: ts(),
  lastLoginAt: ts(),
  createdAt: createdAt(),
  updatedAt: createdAt(),
});

export const roles = pgTable('roles', {
  id: serial().primaryKey(),
  code: varchar({ length: 40 }).notNull().unique(),
  name: varchar({ length: 80 }).notNull(),
  description: text().notNull().default(''),
});

export const permissions = pgTable('permissions', {
  id: serial().primaryKey(),
  code: varchar({ length: 60 }).notNull().unique(),
  description: text().notNull().default(''),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: integer().notNull().references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: integer().notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
    roleId: integer().notNull().references(() => roles.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the bearer token; the token itself is never stored. */
    tokenHash: char({ length: 64 }).notNull().unique(),
    clientName: varchar({ length: 80 }),
    ip: varchar({ length: 64 }),
    createdAt: createdAt(),
    lastSeenAt: ts().notNull().defaultNow(),
    expiresAt: ts().notNull(),
    lockedAt: ts(),
    revokedAt: ts(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

// ======================= Collections master data =======================
export const collectionAreas = pgTable('collection_areas', {
  id: serial().primaryKey(),
  code: varchar({ length: 20 }).notNull().unique(),
  name: varchar({ length: 100 }).notNull(),
  description: text(),
  routeNotes: text(),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
});

export const collectors = pgTable('collectors', {
  id: serial().primaryKey(),
  code: varchar({ length: 20 }).notNull().unique(),
  fullName: varchar({ length: 120 }).notNull(),
  phone: varchar({ length: 20 }),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
});

export const collectorAssignments = pgTable(
  'collector_assignments',
  {
    id: serial().primaryKey(),
    collectorId: integer().notNull().references(() => collectors.id),
    areaId: integer().notNull().references(() => collectionAreas.id),
    assignedFrom: date().notNull(),
    assignedTo: date(),
    isActive: boolean().notNull().default(true),
    assignedBy: integer().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('collector_assignments_collector_idx').on(t.collectorId),
    index('collector_assignments_area_idx').on(t.areaId),
    uniqueIndex('collector_assignments_active_uq').on(t.collectorId, t.areaId).where(sql`is_active`),
  ],
);

// ======================= Subscribers =======================
export const subscribers = pgTable(
  'subscribers',
  {
    id: serial().primaryKey(),
    accountNo: varchar({ length: 20 }).notNull().unique(),
    firstName: varchar({ length: 80 }).notNull(),
    lastName: varchar({ length: 80 }).notNull(),
    /** "Last, First" - stored for fast search and sorting. */
    fullName: varchar({ length: 170 }).notNull(),
    phone: varchar({ length: 20 }).notNull(),
    altPhone: varchar({ length: 20 }),
    email: varchar({ length: 160 }),
    dueDay: integer().notNull().default(15),
    status: subscriberStatus().notNull().default('ACTIVE'),
    collectionAreaId: integer().references(() => collectionAreas.id),
    collectorId: integer().references(() => collectors.id),
    routeSequence: integer(),
    notes: text(),
    createdBy: integer().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [
    index('subscribers_name_idx').on(t.fullName),
    index('subscribers_phone_idx').on(t.phone),
    index('subscribers_area_idx').on(t.collectionAreaId),
    index('subscribers_collector_idx').on(t.collectorId),
    index('subscribers_status_idx').on(t.status),
    check('subscribers_due_day_ck', sql`due_day between 1 and 28`),
  ],
);

export const subscriberAddresses = pgTable(
  'subscriber_addresses',
  {
    id: serial().primaryKey(),
    subscriberId: integer().notNull().references(() => subscribers.id),
    label: varchar({ length: 40 }),
    line1: varchar({ length: 160 }).notNull(),
    barangay: varchar({ length: 80 }).notNull(),
    city: varchar({ length: 80 }).notNull(),
    province: varchar({ length: 80 }).notNull(),
    landmark: varchar({ length: 160 }),
    isPrimary: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('subscriber_addresses_subscriber_idx').on(t.subscriberId),
    uniqueIndex('subscriber_addresses_primary_uq').on(t.subscriberId).where(sql`is_primary`),
  ],
);

// ======================= Services =======================
export const serviceTypes = pgTable('service_types', {
  id: serial().primaryKey(),
  code: serviceTypeCode().notNull().unique(),
  name: varchar({ length: 60 }).notNull(),
});

export const servicePlans = pgTable(
  'service_plans',
  {
    id: serial().primaryKey(),
    code: varchar({ length: 20 }).notNull().unique(),
    name: varchar({ length: 100 }).notNull(),
    serviceTypeId: integer().notNull().references(() => serviceTypes.id),
    monthlyPrice: money().notNull(),
    installationFee: money().notNull().default(0),
    reconnectionFee: money().notNull().default(0),
    speedMbps: integer(),
    channelCount: integer(),
    description: text(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [check('service_plans_price_ck', sql`monthly_price > 0 and installation_fee >= 0 and reconnection_fee >= 0`)],
);

export const serviceAccounts = pgTable(
  'service_accounts',
  {
    id: serial().primaryKey(),
    accountNo: varchar({ length: 20 }).notNull().unique(),
    subscriberId: integer().notNull().references(() => subscribers.id),
    planId: integer().notNull().references(() => servicePlans.id),
    addressId: integer().notNull().references(() => subscriberAddresses.id),
    activationDate: date().notNull(),
    billingStartDate: date().notNull(),
    dueDay: integer().notNull(),
    /** Monthly rate billed going forward. Past invoices keep the rate they were billed at. */
    currentRate: money().notNull(),
    monthlyDiscount: money().notNull().default(0),
    status: serviceAccountStatus().notNull().default('ACTIVE'),
    collectorId: integer().references(() => collectors.id),
    notes: text(),
    createdBy: integer().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [
    index('service_accounts_subscriber_idx').on(t.subscriberId),
    index('service_accounts_plan_idx').on(t.planId),
    index('service_accounts_status_idx').on(t.status),
    index('service_accounts_collector_idx').on(t.collectorId),
    check('service_accounts_ck', sql`due_day between 1 and 28 and current_rate > 0 and monthly_discount >= 0 and monthly_discount <= current_rate`),
  ],
);

export const serviceEvents = pgTable(
  'service_events',
  {
    id: serial().primaryKey(),
    serviceAccountId: integer().notNull().references(() => serviceAccounts.id),
    eventType: varchar({ length: 40 }).notNull(),
    fromStatus: varchar({ length: 20 }),
    toStatus: varchar({ length: 20 }),
    description: text().notNull(),
    effectiveDate: date().notNull(),
    createdBy: integer().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('service_events_account_idx').on(t.serviceAccountId, t.effectiveDate)],
);

// ======================= Billing =======================
export const billingCycles = pgTable('billing_cycles', {
  id: serial().primaryKey(),
  period: char({ length: 7 }).notNull().unique(),
  periodStart: date().notNull(),
  periodEnd: date().notNull(),
  lastGeneratedAt: ts(),
  lastGeneratedBy: integer().references(() => users.id),
  createdAt: createdAt(),
});

export const invoices = pgTable(
  'invoices',
  {
    id: serial().primaryKey(),
    /** Assigned when the invoice is finalized so numbering has no gaps from discarded drafts. */
    invoiceNo: varchar({ length: 20 }).unique(),
    type: invoiceType().notNull().default('MONTHLY'),
    subscriberId: integer().notNull().references(() => subscribers.id),
    serviceAccountId: integer().notNull().references(() => serviceAccounts.id),
    billingCycleId: integer().references(() => billingCycles.id),
    billingPeriod: char({ length: 7 }),
    periodStart: date(),
    periodEnd: date(),
    invoiceDate: date().notNull(),
    dueDate: date().notNull(),
    subtotal: money().notNull(),
    discountTotal: money().notNull().default(0),
    total: money().notNull(),
    adjustmentsTotal: money().notNull().default(0),
    amountPaid: money().notNull().default(0),
    balance: money().notNull(),
    status: invoiceStatus().notNull().default('DRAFT'),
    finalizedAt: ts(),
    finalizedBy: integer().references(() => users.id),
    voidedAt: ts(),
    voidedBy: integer().references(() => users.id),
    voidReason: text(),
    createdBy: integer().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    // One live invoice per service account and billing period. A voided invoice frees the slot.
    uniqueIndex('invoices_account_period_uq').on(t.serviceAccountId, t.billingPeriod).where(sql`billing_period is not null and status <> 'VOID'`),
    index('invoices_subscriber_idx').on(t.subscriberId),
    index('invoices_due_status_idx').on(t.dueDate, t.status),
    index('invoices_status_idx').on(t.status),
    index('invoices_period_idx').on(t.billingPeriod),
    index('invoices_open_idx').on(t.subscriberId, t.dueDate).where(sql`balance > 0 and status in ('UNPAID','PARTIALLY_PAID','OVERDUE')`),
    check('invoices_amounts_ck', sql`total >= 0 and amount_paid >= 0 and balance >= 0 and total = subtotal - discount_total`),
    check('invoices_balance_ck', sql`status in ('VOID','DRAFT') or balance = total + adjustments_total - amount_paid`),
    check('invoices_finalized_ck', sql`status = 'DRAFT' or invoice_no is not null`),
  ],
);

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: serial().primaryKey(),
    invoiceId: integer().notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    itemType: invoiceItemType().notNull(),
    description: varchar({ length: 200 }).notNull(),
    quantity: integer().notNull().default(1),
    unitAmount: money().notNull(),
    amount: money().notNull(),
  },
  (t) => [index('invoice_items_invoice_idx').on(t.invoiceId), check('invoice_items_amount_ck', sql`amount = quantity * unit_amount and quantity > 0`)],
);

export const adjustments = pgTable(
  'adjustments',
  {
    id: serial().primaryKey(),
    adjustmentNo: varchar({ length: 20 }).notNull().unique(),
    subscriberId: integer().notNull().references(() => subscribers.id),
    invoiceId: integer().notNull().references(() => invoices.id),
    type: adjustmentType().notNull(),
    amount: money().notNull(),
    reason: text().notNull(),
    createdBy: integer().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('adjustments_invoice_idx').on(t.invoiceId), check('adjustments_amount_ck', sql`amount > 0`)],
);

// ======================= Ledger =======================
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    subscriberId: integer().notNull().references(() => subscribers.id),
    serviceAccountId: integer().references(() => serviceAccounts.id),
    entryDate: date().notNull(),
    sourceType: ledgerSource().notNull(),
    sourceId: integer().notNull(),
    referenceNo: varchar({ length: 30 }).notNull(),
    description: varchar({ length: 200 }).notNull(),
    debit: money().notNull().default(0),
    credit: money().notNull().default(0),
    createdBy: integer().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('ledger_subscriber_date_idx').on(t.subscriberId, t.entryDate, t.id),
    index('ledger_source_idx').on(t.sourceType, t.sourceId),
    // Each entry is exactly one side: a debit or a credit.
    check('ledger_one_side_ck', sql`debit >= 0 and credit >= 0 and (debit = 0) <> (credit = 0)`),
  ],
);

// ======================= Collection batches (declared before payments for the FK) =======================
export const collectionBatches = pgTable(
  'collection_batches',
  {
    id: serial().primaryKey(),
    batchNo: varchar({ length: 20 }).notNull().unique(),
    collectorId: integer().notNull().references(() => collectors.id),
    areaId: integer().notNull().references(() => collectionAreas.id),
    collectionDate: date().notNull(),
    status: batchStatus().notNull().default('OPEN'),
    expectedTotal: money().notNull().default(0),
    cashCollected: money().notNull().default(0),
    nonCashCollected: money().notNull().default(0),
    cashRemitted: money().notNull().default(0),
    /** cash_remitted - cash_collected, set at reconciliation. */
    difference: money().notNull().default(0),
    varianceType: varianceType(),
    varianceReason: text(),
    notes: text(),
    createdBy: integer().references(() => users.id),
    createdAt: createdAt(),
    startedAt: ts(),
    submittedAt: ts(),
    reconciledBy: integer().references(() => users.id),
    reconciledAt: ts(),
    closedBy: integer().references(() => users.id),
    closedAt: ts(),
  },
  (t) => [
    index('collection_batches_collector_idx').on(t.collectorId, t.collectionDate),
    index('collection_batches_area_idx').on(t.areaId),
    index('collection_batches_status_idx').on(t.status),
    // A batch can only be reconciled/closed with an explicit variance classification,
    // and any shortage or overage must carry an explanation.
    check(
      'collection_batches_variance_ck',
      sql`status not in ('RECONCILED','CLOSED') or (variance_type is not null and difference = cash_remitted - cash_collected and ((variance_type = 'BALANCED') = (difference = 0)) and (difference = 0 or variance_reason is not null))`,
    ),
  ],
);

// ======================= Payments =======================
export const payments = pgTable(
  'payments',
  {
    id: serial().primaryKey(),
    subscriberId: integer().notNull().references(() => subscribers.id),
    paymentDate: date().notNull(),
    paidAt: ts().notNull().defaultNow(),
    amount: money().notNull(),
    method: paymentMethod().notNull(),
    referenceNo: varchar({ length: 80 }),
    notes: text(),
    status: paymentStatus().notNull().default('POSTED'),
    /** Portion not applied to any invoice: the subscriber's advance credit. */
    unappliedAmount: money().notNull().default(0),
    receivedBy: integer().references(() => users.id),
    collectorId: integer().references(() => collectors.id),
    collectionBatchId: integer().references(() => collectionBatches.id),
    idempotencyKey: uuid().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    index('payments_subscriber_idx').on(t.subscriberId, t.paymentDate),
    index('payments_date_idx').on(t.paymentDate),
    index('payments_reference_idx').on(t.referenceNo),
    index('payments_batch_idx').on(t.collectionBatchId),
    index('payments_collector_idx').on(t.collectorId),
    // A GCash reference can back only one posted payment. Reversing the payment frees it.
    uniqueIndex('payments_gcash_reference_uq').on(sql`upper(reference_no)`).where(sql`method = 'GCASH' and status = 'POSTED'`),
    check('payments_amount_ck', sql`amount > 0 and unapplied_amount >= 0 and unapplied_amount <= amount`),
  ],
);

export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: serial().primaryKey(),
    paymentId: integer().notNull().references(() => payments.id),
    invoiceId: integer().notNull().references(() => invoices.id),
    amount: money().notNull(),
    type: allocationType().notNull().default('AUTO'),
    isReversed: boolean().notNull().default(false),
    reversedAt: ts(),
    createdBy: integer().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('payment_allocations_payment_idx').on(t.paymentId),
    index('payment_allocations_invoice_idx').on(t.invoiceId),
    check('payment_allocations_amount_ck', sql`amount > 0`),
  ],
);

export const paymentProofs = pgTable(
  'payment_proofs',
  {
    id: serial().primaryKey(),
    subscriberId: integer().notNull().references(() => subscribers.id),
    /** Set only when an authorized user verifies the proof and the payment is posted. */
    paymentId: integer().references(() => payments.id),
    method: paymentMethod().notNull().default('GCASH'),
    referenceNo: varchar({ length: 80 }).notNull(),
    senderName: varchar({ length: 120 }).notNull(),
    senderNumber: varchar({ length: 20 }).notNull(),
    amount: money().notNull(),
    transactionDate: date().notNull(),
    notes: text(),
    /** Server-generated file name inside the attachments folder; never the client's path. */
    storedName: varchar({ length: 80 }).notNull(),
    fileName: varchar({ length: 200 }).notNull(),
    mimeType: varchar({ length: 60 }).notNull(),
    fileSize: integer().notNull(),
    sha256: char({ length: 64 }).notNull(),
    status: proofStatus().notNull().default('PENDING'),
    submittedBy: integer().references(() => users.id),
    submittedAt: createdAt(),
    reviewedBy: integer().references(() => users.id),
    reviewedAt: ts(),
    rejectionReason: text(),
  },
  (t) => [
    index('payment_proofs_status_idx').on(t.status, t.submittedAt),
    index('payment_proofs_reference_idx').on(sql`upper(reference_no)`),
    index('payment_proofs_subscriber_idx').on(t.subscriberId),
    check('payment_proofs_ck', sql`amount > 0 and (status <> 'VERIFIED' or (payment_id is not null and reviewed_by is not null and reviewed_at is not null))`),
  ],
);

export const paymentReversals = pgTable('payment_reversals', {
  id: serial().primaryKey(),
  reversalNo: varchar({ length: 20 }).notNull().unique(),
  /** A payment can be reversed at most once. */
  paymentId: integer().notNull().unique().references(() => payments.id),
  amount: money().notNull(),
  reason: text().notNull(),
  reversedBy: integer().notNull().references(() => users.id),
  reversedAt: createdAt(),
});

export const receipts = pgTable(
  'receipts',
  {
    id: serial().primaryKey(),
    /** Unique forever: a voided receipt keeps its number. */
    receiptNo: varchar({ length: 20 }).notNull().unique(),
    paymentId: integer().notNull().unique().references(() => payments.id),
    status: receiptStatus().notNull().default('ISSUED'),
    issuedBy: integer().references(() => users.id),
    issuedAt: createdAt(),
    voidedBy: integer().references(() => users.id),
    voidedAt: ts(),
    voidReason: text(),
    printCount: integer().notNull().default(0),
  },
  (t) => [index('receipts_status_idx').on(t.status)],
);

// ======================= Collection batch details =======================
export const batchAccounts = pgTable(
  'batch_accounts',
  {
    id: serial().primaryKey(),
    batchId: integer().notNull().references(() => collectionBatches.id, { onDelete: 'cascade' }),
    subscriberId: integer().notNull().references(() => subscribers.id),
    sequence: integer().notNull().default(0),
    currentBill: money().notNull().default(0),
    arrears: money().notNull().default(0),
    totalDue: money().notNull().default(0),
    collectedAmount: money().notNull().default(0),
    outcome: batchOutcome().notNull().default('PENDING'),
    notes: text(),
  },
  (t) => [uniqueIndex('batch_accounts_uq').on(t.batchId, t.subscriberId), index('batch_accounts_subscriber_idx').on(t.subscriberId)],
);

export const collectorRemittances = pgTable(
  'collector_remittances',
  {
    id: serial().primaryKey(),
    remittanceNo: varchar({ length: 20 }).notNull().unique(),
    batchId: integer().notNull().references(() => collectionBatches.id),
    collectorId: integer().notNull().references(() => collectors.id),
    amount: money().notNull(),
    notes: text(),
    receivedBy: integer().references(() => users.id),
    remittedAt: createdAt(),
  },
  (t) => [index('collector_remittances_batch_idx').on(t.batchId), check('collector_remittances_amount_ck', sql`amount >= 0`)],
);

// ======================= Operations =======================
export const suspensionRecords = pgTable(
  'suspension_records',
  {
    id: serial().primaryKey(),
    serviceAccountId: integer().notNull().references(() => serviceAccounts.id),
    reason: text().notNull(),
    effectiveDate: date().notNull(),
    arrearsAtSuspension: money().notNull().default(0),
    approvedBy: integer().references(() => users.id),
    notes: text(),
    isActive: boolean().notNull().default(true),
    liftedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index('suspension_records_account_idx').on(t.serviceAccountId)],
);

export const reconnectionRecords = pgTable(
  'reconnection_records',
  {
    id: serial().primaryKey(),
    serviceAccountId: integer().notNull().references(() => serviceAccounts.id),
    suspensionId: integer().references(() => suspensionRecords.id),
    requestDate: date().notNull(),
    completionDate: date(),
    feeAmount: money().notNull().default(0),
    feeInvoiceId: integer().references(() => invoices.id),
    technicianUserId: integer().references(() => users.id),
    status: reconnectionStatus().notNull().default('REQUESTED'),
    requestedBy: integer().references(() => users.id),
    completedBy: integer().references(() => users.id),
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [index('reconnection_records_account_idx').on(t.serviceAccountId), index('reconnection_records_status_idx').on(t.status)],
);

// ======================= System =======================
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    at: createdAt(),
    actorId: integer().references(() => users.id),
    actorUsername: varchar({ length: 40 }),
    action: varchar({ length: 60 }).notNull(),
    entityType: varchar({ length: 40 }).notNull(),
    entityId: varchar({ length: 40 }),
    subscriberId: integer(),
    reason: text(),
    oldValues: jsonb(),
    newValues: jsonb(),
    ip: varchar({ length: 64 }),
  },
  (t) => [
    index('audit_logs_at_idx').on(t.at),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_actor_idx').on(t.actorId, t.at),
    index('audit_logs_subscriber_idx').on(t.subscriberId),
  ],
);

export const applicationSettings = pgTable('application_settings', {
  key: varchar({ length: 60 }).primaryKey(),
  value: jsonb().notNull(),
  updatedBy: integer().references(() => users.id),
  updatedAt: createdAt(),
});

export const backupHistory = pgTable('backup_history', {
  id: serial().primaryKey(),
  kind: varchar({ length: 10 }).notNull(),
  name: varchar({ length: 80 }).notNull(),
  status: varchar({ length: 12 }).notNull(),
  sizeBytes: bigint({ mode: 'number' }).notNull().default(0),
  checksum: char({ length: 64 }),
  verifiedAt: ts(),
  verificationResult: text(),
  notes: text(),
  createdBy: integer().references(() => users.id),
  createdByName: varchar({ length: 120 }),
  createdAt: createdAt(),
});

/** Gapless document numbering. The row lock taken by UPDATE serializes concurrent issuers. */
export const numberSequences = pgTable('number_sequences', {
  name: varchar({ length: 30 }).primaryKey(),
  prefix: varchar({ length: 10 }).notNull(),
  padding: integer().notNull().default(6),
  nextValue: bigint({ mode: 'number' }).notNull().default(1),
});
