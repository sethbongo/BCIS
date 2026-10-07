/**
 * Zod schemas for every request body that crosses the API boundary.
 * The API validates with them; the desktop forms reuse them through React Hook Form.
 * Money is always an integer number of centavos.
 */
import { z } from 'zod';
import { isBillingPeriod, isISODate } from './dates';
import { ADJUSTMENT_TYPES, BATCH_OUTCOMES, PAYMENT_METHODS, SERVICE_TYPE_CODES, SUBSCRIBER_STATUSES } from './enums';
import { ROLE_CODES } from './permissions';

const MAX_MONEY = 100_000_000_00; // PHP 100,000,000.00

export const zId = z.number().int().positive();
export const zMoney = z.number().int('Amount must be in whole centavos').min(1, 'Amount must be greater than zero').max(MAX_MONEY);
export const zMoneyOrZero = z.number().int('Amount must be in whole centavos').min(0, 'Amount cannot be negative').max(MAX_MONEY);
export const zDate = z.string().refine(isISODate, 'Enter a valid date');
export const zPeriod = z.string().refine(isBillingPeriod, 'Enter a billing period as YYYY-MM');
export const zDay = z.number().int().min(1, 'Use a day from 1 to 28').max(28, 'Use a day from 1 to 28');
const req = (max: number, label = 'This field') => z.string().trim().min(1, `${label} is required`).max(max);
const opt = (max: number) => z.string().trim().max(max).optional();
const zPhone = z
  .string()
  .trim()
  .regex(/^[0-9+\-() ]{7,20}$/, 'Enter a valid contact number');
const zReason = z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500);

// ---------- auth & users ----------
export const LoginInput = z.object({
  username: req(60, 'Username'),
  password: z.string().min(1, 'Password is required').max(200),
  clientName: opt(80),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const zPassword = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), 'Include upper-case, lower-case and a number');

export const UnlockInput = z.object({ password: z.string().min(1).max(200) });
export const ChangePasswordInput = z.object({ currentPassword: z.string().min(1).max(200), newPassword: zPassword });
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;

export const UserCreateInput = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/, 'Use 3-40 letters, digits, dot, dash or underscore'),
  fullName: req(120, 'Full name'),
  email: z.union([z.literal(''), z.email('Enter a valid email')]).optional(),
  password: zPassword,
  roleCodes: z.array(z.enum(ROLE_CODES)).min(1, 'Select at least one role'),
  isActive: z.boolean(),
});
export type UserCreateInput = z.infer<typeof UserCreateInput>;

export const UserUpdateInput = UserCreateInput.omit({ username: true, password: true }).partial();
export type UserUpdateInput = z.infer<typeof UserUpdateInput>;
export const ResetPasswordInput = z.object({ newPassword: zPassword });

// ---------- plans ----------
export const PlanInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, 'Use 2-20 letters, digits or dashes'),
  name: req(100, 'Plan name'),
  serviceType: z.enum(SERVICE_TYPE_CODES),
  monthlyPrice: zMoney,
  installationFee: zMoneyOrZero,
  reconnectionFee: zMoneyOrZero,
  speedMbps: z.number().int().min(1).max(100_000).nullable().optional(),
  channelCount: z.number().int().min(1).max(10_000).nullable().optional(),
  description: opt(500),
  isActive: z.boolean(),
});
export type PlanInput = z.infer<typeof PlanInput>;
export const PlanUpdateInput = PlanInput.omit({ code: true, serviceType: true }).partial();
export type PlanUpdateInput = z.infer<typeof PlanUpdateInput>;

// ---------- subscribers ----------
export const AddressInput = z.object({
  label: opt(40),
  line1: req(160, 'Street / house no.'),
  barangay: req(80, 'Barangay'),
  city: req(80, 'City / municipality'),
  province: req(80, 'Province'),
  landmark: opt(160),
});
export type AddressInput = z.infer<typeof AddressInput>;

export const SubscriberInput = z.object({
  firstName: req(80, 'First name'),
  lastName: req(80, 'Last name'),
  phone: zPhone,
  altPhone: z.union([z.literal(''), zPhone]).optional(),
  email: z.union([z.literal(''), z.email('Enter a valid email')]).optional(),
  dueDay: zDay,
  collectionAreaId: zId.nullable().optional(),
  collectorId: zId.nullable().optional(),
  routeSequence: z.number().int().min(0).max(100_000).nullable().optional(),
  notes: opt(1000),
  address: AddressInput,
});
export type SubscriberInput = z.infer<typeof SubscriberInput>;

export const SubscriberUpdateInput = SubscriberInput.omit({ address: true })
  .partial()
  .extend({ status: z.enum(SUBSCRIBER_STATUSES).optional(), statusReason: opt(500) });
export type SubscriberUpdateInput = z.infer<typeof SubscriberUpdateInput>;

// ---------- service accounts ----------
export const ServiceAccountInput = z.object({
  subscriberId: zId,
  planId: zId,
  addressId: zId.nullable().optional(),
  newAddress: AddressInput.optional(),
  activationDate: zDate,
  billingStartDate: zDate,
  dueDay: zDay,
  monthlyDiscount: zMoneyOrZero,
  collectorId: zId.nullable().optional(),
  notes: opt(1000),
});
export type ServiceAccountInput = z.infer<typeof ServiceAccountInput>;

export const ServiceAccountUpdateInput = z.object({
  planId: zId.optional(),
  dueDay: zDay.optional(),
  monthlyDiscount: zMoneyOrZero.optional(),
  collectorId: zId.nullable().optional(),
  notes: opt(1000),
  reason: opt(500),
});
export type ServiceAccountUpdateInput = z.infer<typeof ServiceAccountUpdateInput>;

export const SuspendInput = z.object({ reason: zReason, effectiveDate: zDate, notes: opt(1000) });
export type SuspendInput = z.infer<typeof SuspendInput>;

export const ReconnectionRequestInput = z.object({
  technicianUserId: zId.nullable().optional(),
  waiveFee: z.boolean().optional(),
  notes: opt(1000),
});
export type ReconnectionRequestInput = z.infer<typeof ReconnectionRequestInput>;
export const ReconnectionCompleteInput = z.object({ completionDate: zDate, notes: opt(1000) });
export type ReconnectionCompleteInput = z.infer<typeof ReconnectionCompleteInput>;
export const TerminateInput = z.object({ reason: zReason, effectiveDate: zDate });

// ---------- billing ----------
export const BillingGenerateInput = z.object({
  period: zPeriod,
  /** false creates DRAFT invoices for review; true finalizes and posts ledger debits immediately. */
  finalize: z.boolean(),
  serviceAccountIds: z.array(zId).max(5000).optional(),
});
export type BillingGenerateInput = z.infer<typeof BillingGenerateInput>;
export const FinalizeDraftsInput = z.object({ period: zPeriod });
export const InvoiceVoidInput = z.object({ reason: zReason });
export const AdjustmentInput = z.object({ invoiceId: zId, type: z.enum(ADJUSTMENT_TYPES), amount: zMoney, reason: zReason });
export type AdjustmentInput = z.infer<typeof AdjustmentInput>;

// ---------- payments ----------
export const ManualAllocationInput = z.object({ invoiceId: zId, amount: zMoney });
export const FileUploadInput = z.object({
  fileName: req(200, 'File name'),
  /** Base64 file content. The server re-validates the real type and size. */
  dataBase64: z.string().min(1, 'File is empty').max(8_000_000, 'File is too large'),
});
export type FileUploadInput = z.infer<typeof FileUploadInput>;

export const PaymentPreviewInput = z.object({
  subscriberId: zId,
  amount: zMoney,
  allocations: z.array(ManualAllocationInput).max(200).optional(),
});
export type PaymentPreviewInput = z.infer<typeof PaymentPreviewInput>;

export const PaymentInput = PaymentPreviewInput.extend({
  method: z.enum(PAYMENT_METHODS),
  paymentDate: zDate.optional(),
  referenceNo: opt(80),
  notes: opt(500),
  /** Client-generated key so a retried request can never post the same payment twice. */
  idempotencyKey: z.uuid().optional(),
  proof: FileUploadInput.optional(),
}).refine((v) => v.method === 'CASH' || !!v.referenceNo, { path: ['referenceNo'], message: 'Reference number is required for non-cash payments' });
export type PaymentInput = z.infer<typeof PaymentInput>;

export const PaymentReverseInput = z.object({ reason: zReason });

// ---------- GCash verification ----------
export const GcashSubmissionInput = z.object({
  subscriberId: zId,
  referenceNo: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{6,40}$/, 'Enter the GCash reference number (6-40 letters or digits)'),
  senderName: req(120, 'Sender name'),
  senderNumber: zPhone,
  amount: zMoney,
  transactionDate: zDate,
  notes: opt(500),
  file: FileUploadInput,
});
export type GcashSubmissionInput = z.infer<typeof GcashSubmissionInput>;
export const GcashVerifyInput = z.object({ notes: opt(500) });
export const GcashRejectInput = z.object({ reason: zReason });

// ---------- collections ----------
export const AreaInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, 'Use 2-20 letters, digits or dashes'),
  name: req(100, 'Area name'),
  description: opt(500),
  routeNotes: opt(1000),
  isActive: z.boolean(),
});
export type AreaInput = z.infer<typeof AreaInput>;

export const CollectorInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, 'Use 2-20 letters, digits or dashes'),
  fullName: req(120, 'Collector name'),
  phone: z.union([z.literal(''), zPhone]).optional(),
  isActive: z.boolean(),
  areaIds: z.array(zId).max(100),
});
export type CollectorInput = z.infer<typeof CollectorInput>;

export const BatchCreateInput = z.object({ collectorId: zId, areaId: zId, collectionDate: zDate, notes: opt(500) });
export type BatchCreateInput = z.infer<typeof BatchCreateInput>;

export const BatchCollectInput = z
  .object({
    subscriberId: zId,
    amount: zMoney,
    method: z.enum(PAYMENT_METHODS),
    referenceNo: opt(80),
    notes: opt(500),
    idempotencyKey: z.uuid().optional(),
  })
  .refine((v) => v.method === 'CASH' || !!v.referenceNo, { path: ['referenceNo'], message: 'Reference number is required for non-cash payments' });
export type BatchCollectInput = z.infer<typeof BatchCollectInput>;

export const BatchOutcomeInput = z.object({
  subscriberId: zId,
  outcome: z.enum(BATCH_OUTCOMES).exclude(['COLLECTED', 'PARTIAL', 'PENDING']),
  notes: opt(500),
});
export const RemittanceInput = z.object({ amount: zMoneyOrZero, notes: opt(500) });
export type RemittanceInput = z.infer<typeof RemittanceInput>;
/** A variance explanation is mandatory whenever remitted cash differs from collected cash. */
export const ReconcileInput = z.object({ varianceReason: opt(500) });
export const CloseBatchInput = z.object({ confirm: z.literal(true), notes: opt(500) });

// ---------- administration ----------
export const SettingsUpdateInput = z.object({ values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])) });
export const BackupCreateInput = z.object({ notes: opt(300) });
export const BackupRestoreInput = z.object({
  confirmation: z.literal('RESTORE', { error: 'Type RESTORE to confirm' }),
  reason: zReason,
});

// ---------- list queries (server side) ----------
const qNum = z.coerce.number().int().positive().optional();
export const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
  q: z.string().trim().max(100).optional(),
  sort: z.string().max(40).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  status: z.string().max(40).optional(),
  areaId: qNum,
  collectorId: qNum,
  planId: qNum,
  subscriberId: qNum,
  serviceType: z.enum(SERVICE_TYPE_CODES).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  period: zPeriod.optional(),
  from: zDate.optional(),
  to: zDate.optional(),
  bucket: z.string().max(20).optional(),
});
export type ListQuery = z.infer<typeof ListQuery>;
