/** Response shapes returned by the API and consumed by the desktop client. */
import type { AllocationLine } from './domain/allocation';
import type { AgingTotals } from './domain/aging';
import type {
  AdjustmentType,
  AgingBucket,
  AllocationType,
  BatchOutcome,
  BatchStatus,
  InvoiceItemType,
  InvoiceStatus,
  InvoiceType,
  LedgerSource,
  PaymentMethod,
  PaymentStatus,
  ProofStatus,
  ReceiptStatus,
  ReconnectionStatus,
  ServiceAccountStatus,
  ServiceTypeCode,
  SubscriberStatus,
  VarianceType,
} from './enums';
import type { Permission, RoleCode } from './permissions';

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

// ---------- auth ----------
export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  roles: RoleCode[];
  permissions: Permission[];
}
export interface LoginResult {
  token: string;
  expiresAt: string;
  idleLockMinutes: number;
  user: AuthUser;
}
export interface UserRow {
  id: number;
  username: string;
  fullName: string;
  email: string | null;
  isActive: boolean;
  roles: RoleCode[];
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
}
export interface RoleRow {
  code: RoleCode;
  name: string;
  description: string;
  permissions: Permission[];
  userCount: number;
}

// ---------- master data ----------
export interface PlanRow {
  id: number;
  code: string;
  name: string;
  serviceType: ServiceTypeCode;
  monthlyPrice: number;
  installationFee: number;
  reconnectionFee: number;
  speedMbps: number | null;
  channelCount: number | null;
  description: string | null;
  isActive: boolean;
  activeAccounts: number;
}
export interface NamedRef {
  id: number;
  name: string;
}
export interface AreaRow {
  id: number;
  code: string;
  name: string;
  description: string | null;
  routeNotes: string | null;
  isActive: boolean;
  subscriberCount: number;
  collectors: NamedRef[];
}
export interface CollectorRow {
  id: number;
  code: string;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  areas: NamedRef[];
  subscriberCount: number;
}

// ---------- subscribers ----------
export interface AddressRow {
  id: number;
  label: string | null;
  line1: string;
  barangay: string;
  city: string;
  province: string;
  landmark: string | null;
  isPrimary: boolean;
  formatted: string;
}
export interface SubscriberRow {
  id: number;
  accountNo: string;
  fullName: string;
  phone: string;
  address: string;
  areaName: string | null;
  collectorName: string | null;
  status: SubscriberStatus;
  dueDay: number;
  serviceCount: number;
  balance: number;
}
export interface SubscriberDetail extends SubscriberRow {
  firstName: string;
  lastName: string;
  altPhone: string | null;
  email: string | null;
  collectionAreaId: number | null;
  collectorId: number | null;
  routeSequence: number | null;
  notes: string | null;
  createdAt: string;
  addresses: AddressRow[];
  /** Total of open invoice balances. */
  outstanding: number;
  /** Open invoice balances past their due date. */
  overdue: number;
  /** Unapplied advance payments available to future invoices. */
  credit: number;
  lastPaymentDate: string | null;
  lastPaymentAmount: number | null;
}
export interface ServiceAccountRow {
  id: number;
  accountNo: string;
  subscriberId: number;
  subscriberAccountNo: string;
  subscriberName: string;
  planId: number;
  planCode: string;
  planName: string;
  serviceType: ServiceTypeCode;
  address: string;
  areaName: string | null;
  collectorName: string | null;
  activationDate: string;
  billingStartDate: string;
  dueDay: number;
  currentRate: number;
  monthlyDiscount: number;
  status: ServiceAccountStatus;
  notes: string | null;
  balance: number;
}
export interface ServiceEventRow {
  id: number;
  serviceAccountId: number;
  serviceAccountNo: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  description: string;
  effectiveDate: string;
  createdByName: string | null;
  createdAt: string;
}
export interface SuspensionRow {
  id: number;
  serviceAccountId: number;
  serviceAccountNo: string;
  subscriberId: number;
  subscriberName: string;
  planName: string;
  reason: string;
  effectiveDate: string;
  arrearsAtSuspension: number;
  approvedByName: string | null;
  notes: string | null;
  isActive: boolean;
  liftedAt: string | null;
  currentArrears: number;
}
export interface ReconnectionRow {
  id: number;
  serviceAccountId: number;
  serviceAccountNo: string;
  subscriberId: number;
  subscriberName: string;
  planName: string;
  address: string;
  requestDate: string;
  completionDate: string | null;
  feeAmount: number;
  feeInvoiceNo: string | null;
  technicianName: string | null;
  status: ReconnectionStatus;
  requestedByName: string | null;
  notes: string | null;
}

// ---------- billing ----------
export interface InvoiceRow {
  id: number;
  invoiceNo: string | null;
  type: InvoiceType;
  subscriberId: number;
  subscriberAccountNo: string;
  subscriberName: string;
  serviceAccountId: number;
  serviceAccountNo: string;
  planName: string;
  billingPeriod: string | null;
  invoiceDate: string;
  dueDate: string;
  total: number;
  adjustmentsTotal: number;
  amountPaid: number;
  balance: number;
  status: InvoiceStatus;
  /** Positive when the invoice still has a balance and is past its due date. */
  daysPastDue: number;
}
export interface InvoiceItemRow {
  id: number;
  itemType: InvoiceItemType;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
}
export interface InvoiceAllocationRow {
  paymentId: number;
  receiptNo: string;
  paymentDate: string;
  method: PaymentMethod;
  amount: number;
  type: AllocationType;
  isReversed: boolean;
}
export interface AdjustmentRow {
  id: number;
  adjustmentNo: string;
  invoiceId: number;
  invoiceNo: string | null;
  subscriberId: number;
  subscriberName: string;
  type: AdjustmentType;
  amount: number;
  reason: string;
  createdByName: string | null;
  createdAt: string;
}
export interface InvoiceDetail extends InvoiceRow {
  periodStart: string | null;
  periodEnd: string | null;
  subtotal: number;
  discountTotal: number;
  address: string;
  finalizedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  items: InvoiceItemRow[];
  allocations: InvoiceAllocationRow[];
  adjustments: AdjustmentRow[];
}
export interface BillingPreviewRow {
  serviceAccountId: number;
  serviceAccountNo: string;
  subscriberName: string;
  planName: string;
  dueDate: string;
  total: number;
  items: { itemType: InvoiceItemType; description: string; amount: number }[];
}
export interface BillingPreview {
  period: string;
  eligibleCount: number;
  alreadyBilledCount: number;
  totalAmount: number;
  rows: BillingPreviewRow[];
}
export interface BillingRunResult {
  period: string;
  created: number;
  skippedAlreadyBilled: number;
  finalized: number;
  totalBilled: number;
  creditApplied: number;
}
export interface BillingCycleRow {
  id: number;
  period: string;
  invoiceCount: number;
  draftCount: number;
  totalBilled: number;
  totalCollected: number;
  totalOutstanding: number;
  lastGeneratedAt: string | null;
  lastGeneratedByName: string | null;
}
export interface CurrentBilling {
  period: string;
  activeAccounts: number;
  billedAccounts: number;
  unbilledAccounts: number;
  draftCount: number;
  totalBilled: number;
  totalCollected: number;
  totalOutstanding: number;
  byStatus: { status: InvoiceStatus; count: number; total: number; balance: number }[];
}

// ---------- ledger ----------
export interface LedgerRow {
  id: number;
  entryDate: string;
  referenceNo: string;
  description: string;
  sourceType: LedgerSource;
  sourceId: number;
  debit: number;
  credit: number;
  balance: number;
}
export interface LedgerResult {
  subscriberId: number;
  from: string | null;
  to: string | null;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  rows: LedgerRow[];
}

// ---------- payments ----------
export interface PaymentRow {
  id: number;
  receiptNo: string;
  receiptStatus: ReceiptStatus;
  subscriberId: number;
  subscriberAccountNo: string;
  subscriberName: string;
  paymentDate: string;
  paidAt: string;
  amount: number;
  method: PaymentMethod;
  referenceNo: string | null;
  status: PaymentStatus;
  unappliedAmount: number;
  receivedByName: string | null;
  collectorName: string | null;
  batchNo: string | null;
}
export interface PaymentAllocationRow {
  id: number;
  invoiceId: number;
  invoiceNo: string | null;
  billingPeriod: string | null;
  description: string;
  amount: number;
  type: AllocationType;
  isReversed: boolean;
}
export interface PaymentDetail extends PaymentRow {
  notes: string | null;
  address: string;
  allocations: PaymentAllocationRow[];
  reversal: { reversalNo: string; reason: string; reversedByName: string | null; reversedAt: string } | null;
  proofId: number | null;
  /** Subscriber ledger balance right after this payment was posted. */
  balanceAfter: number;
  company: { name: string; address: string; phone: string };
}
export interface AllocationPreview {
  subscriberId: number;
  amount: number;
  outstandingBefore: number;
  outstandingAfter: number;
  lines: AllocationLine[];
  totalApplied: number;
  unapplied: number;
}

// ---------- GCash ----------
export interface DuplicateReference {
  kind: 'PAYMENT' | 'PROOF';
  id: number;
  status: string;
  subscriberName: string;
  amount: number;
  date: string;
  receiptNo: string | null;
}
export interface ProofRow {
  id: number;
  subscriberId: number;
  subscriberAccountNo: string;
  subscriberName: string;
  subscriberBalance: number;
  referenceNo: string;
  senderName: string;
  senderNumber: string;
  amount: number;
  transactionDate: string;
  status: ProofStatus;
  notes: string | null;
  fileName: string;
  mimeType: string;
  submittedByName: string | null;
  submittedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  paymentId: number | null;
  receiptNo: string | null;
  duplicates: DuplicateReference[];
}

// ---------- collections ----------
export interface RouteSheetRow {
  subscriberId: number;
  accountNo: string;
  fullName: string;
  address: string;
  phone: string;
  services: string;
  currentBill: number;
  arrears: number;
  totalDue: number;
}
export interface RouteSheet {
  areaName: string;
  collectorName: string;
  asOf: string;
  rows: RouteSheetRow[];
  totals: { currentBill: number; arrears: number; totalDue: number };
}
export interface BatchRow {
  id: number;
  batchNo: string;
  collectorId: number;
  collectorName: string;
  areaId: number;
  areaName: string;
  collectionDate: string;
  status: BatchStatus;
  accountCount: number;
  collectedCount: number;
  expectedTotal: number;
  cashCollected: number;
  nonCashCollected: number;
  cashRemitted: number;
  difference: number;
  varianceType: VarianceType | null;
}
export interface BatchAccountRow extends RouteSheetRow {
  id: number;
  sequence: number;
  collectedAmount: number;
  outcome: BatchOutcome;
  notes: string | null;
  payments: { paymentId: number; receiptNo: string; method: PaymentMethod; amount: number; status: PaymentStatus }[];
}
export interface RemittanceRow {
  id: number;
  remittanceNo: string;
  amount: number;
  remittedAt: string;
  receivedByName: string | null;
  notes: string | null;
}
export interface BatchDetail extends BatchRow {
  notes: string | null;
  varianceReason: string | null;
  uncollected: number;
  createdByName: string | null;
  createdAt: string;
  submittedAt: string | null;
  reconciledByName: string | null;
  reconciledAt: string | null;
  closedByName: string | null;
  closedAt: string | null;
  accounts: BatchAccountRow[];
  remittances: RemittanceRow[];
  /** Accounts needing attention: reversed payments, refusals, promises and not-at-home visits. */
  exceptions: { subscriberName: string; accountNo: string; detail: string }[];
}

// ---------- receivables ----------
export interface OutstandingRow {
  subscriberId: number;
  accountNo: string;
  fullName: string;
  phone: string;
  areaName: string | null;
  collectorName: string | null;
  openInvoices: number;
  currentDue: number;
  overdue: number;
  balance: number;
  oldestDueDate: string;
  lastPaymentDate: string | null;
}
export interface OverdueRow {
  serviceAccountId: number;
  serviceAccountNo: string;
  serviceStatus: ServiceAccountStatus;
  subscriberId: number;
  accountNo: string;
  fullName: string;
  phone: string;
  planName: string;
  serviceType: ServiceTypeCode;
  areaName: string | null;
  collectorName: string | null;
  monthsUnpaid: number;
  oldestInvoiceNo: string;
  oldestDueDate: string;
  daysPastDue: number;
  bucket: AgingBucket;
  lastPaymentDate: string | null;
  totalArrears: number;
}
export interface AgingRow {
  subscriberId: number;
  accountNo: string;
  fullName: string;
  areaName: string | null;
  collectorName: string | null;
  CURRENT: number;
  D1_30: number;
  D31_60: number;
  D61_90: number;
  D90_PLUS: number;
  total: number;
}
export interface AgingReport extends Paged<AgingRow> {
  asOf: string;
  totals: AgingTotals;
  /** Sum of all open invoice balances, computed independently so the UI can show the reconciliation. */
  outstandingInvoiceTotal: number;
}
export interface ReceivableSummary {
  asOf: string;
  currentReceivable: number;
  overdueReceivable: number;
  totalReceivable: number;
  subscribersWithBalance: number;
  subscribersOverdue: number;
  suspensionCandidates: number;
  graceDays: number;
  thresholdMonths: number;
}

// ---------- dashboard ----------
export interface DashboardData {
  asOf: string;
  period: string;
  kpis: {
    currentReceivable: number;
    overdueReceivable: number;
    subscribersOverdue: number;
    suspensionCandidates: number;
    billedThisMonth: number;
    collectedThisMonth: number;
    collectedToday: number;
    activeSubscribers: number;
    activeServiceAccounts: number;
    pendingGcash: number;
  };
  billingVsCollection: { period: string; billed: number; collected: number }[];
  paymentMethods: { method: PaymentMethod; count: number; amount: number }[];
  aging: AgingTotals;
  collectorPerformance: { collectorId: number; collectorName: string; subscribers: number; outstanding: number; collected: number }[];
  overdueAlerts: OverdueRow[];
  recentPayments: PaymentRow[];
}

// ---------- reports ----------
export type ReportCellType = 'text' | 'money' | 'int' | 'date' | 'percent';
export interface ReportColumn {
  key: string;
  header: string;
  type: ReportCellType;
  /** Relative column width for PDF output. */
  width?: number;
}
export type ReportParam = 'from' | 'to' | 'asOf' | 'groupBy' | 'dimension' | 'collectorId' | 'areaId' | 'subscriberId' | 'year';
export interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  category: 'Collections' | 'Billing & Revenue' | 'Receivables' | 'Subscribers' | 'Collectors' | 'Audit & Control';
  params: ReportParam[];
  landscape?: boolean;
}
export interface ReportData {
  key: string;
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy: string;
  company: string;
  landscape: boolean;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, string | number | null> | null;
  /** Lines shown above the table, e.g. statement header details. */
  header: { label: string; value: string }[];
  notes: string[];
}

// ---------- administration ----------
export interface AuditRow {
  id: number;
  at: string;
  actorUsername: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  oldValues: unknown;
  newValues: unknown;
  ip: string | null;
}
export interface BackupRow {
  id: number;
  kind: 'BACKUP' | 'RESTORE';
  name: string;
  status: 'COMPLETED' | 'VERIFIED' | 'FAILED';
  sizeBytes: number;
  checksum: string | null;
  verifiedAt: string | null;
  verificationResult: string | null;
  createdByName: string | null;
  createdAt: string;
  notes: string | null;
  available: boolean;
}
export interface IntegrityCheck {
  name: string;
  description: string;
  ok: boolean;
  violations: number;
  detail: string;
}
export interface IntegrityReport {
  ok: boolean;
  checkedAt: string;
  checks: IntegrityCheck[];
}
export interface RestoreResult {
  restoredFrom: string;
  integrity: IntegrityReport;
}
export interface HealthStatus {
  status: 'ok' | 'degraded';
  version: string;
  database: 'up' | 'down';
  time: string;
}
export interface SearchResult {
  kind: 'SUBSCRIBER' | 'SERVICE_ACCOUNT' | 'INVOICE' | 'RECEIPT' | 'GCASH';
  id: number;
  subscriberId: number;
  title: string;
  subtitle: string;
  badge: string | null;
}
