import {
  allocateOldestFirst,
  computeInvoiceTotals,
  deriveInvoiceStatus,
  dueDateFor,
  formatMoney,
  lineAmount,
  periodBounds,
  periodLabel,
  periodOf,
  type AdjustmentInput,
  type AdjustmentRow,
  type BillingCycleRow,
  type BillingGenerateInput,
  type BillingPreview,
  type BillingRunResult,
  type CurrentBilling,
  type InvoiceDetail,
  type InvoiceItemInput,
  type InvoiceItemRow,
  type InvoiceAllocationRow,
  type InvoiceRow,
  type InvoiceType,
  type LedgerResult,
  type LedgerRow,
  type ListQuery,
  type Paged,
  type SettingsMap,
} from '@bcis/shared';
import { eq, sql } from 'drizzle-orm';
import { contains, iso, one, paged, rows, where, type DbOrTx } from '../../db/client';
import { adjustments, billingCycles, invoiceItems, invoices, payments } from '../../db/schema';
import { audit } from '../../lib/audit';
import { today, type Actor, type Ctx } from '../../lib/context';
import { conflict, invalid, notFound } from '../../lib/errors';
import { nextNumber } from '../../lib/sequences';
import { getSettings } from '../../lib/settings';
import { address, OPEN } from '../../lib/sqlfrag';
import { insertAllocation, lockInvoice, lockOpenInvoices, lockSubscriber, postLedger, refreshOverdue, updateInvoiceAmounts } from './core';

// ===================================================================
// Monthly billing
// ===================================================================
interface BillableAccount {
  id: number;
  accountNo: string;
  subscriberId: number;
  subscriberName: string;
  planName: string;
  currentRate: number;
  monthlyDiscount: number;
  dueDay: number;
  billingStartDate: string;
  installationFee: number;
  firstBilling: boolean;
  overdueInvoices: number;
  billed: boolean;
}

/** Active service accounts whose billing has started on or before the end of the period. */
async function billableAccounts(db: DbOrTx, period: string, ids?: number[]): Promise<BillableAccount[]> {
  if (ids && ids.length === 0) return [];
  return rows<BillableAccount>(
    db,
    sql`select sa.id, sa.account_no as "accountNo", sa.subscriber_id as "subscriberId", s.full_name as "subscriberName", p.name as "planName",
          sa.current_rate as "currentRate", sa.monthly_discount as "monthlyDiscount", sa.due_day as "dueDay", sa.billing_start_date as "billingStartDate",
          p.installation_fee as "installationFee",
          not exists (select 1 from invoices i where i.service_account_id = sa.id and i.type = 'MONTHLY' and i.status <> 'VOID') as "firstBilling",
          (select count(*) from invoices i where i.service_account_id = sa.id and i.status in ${OPEN} and i.due_date < ${today()}) as "overdueInvoices",
          exists (select 1 from invoices i where i.service_account_id = sa.id and i.billing_period = ${period} and i.status <> 'VOID') as billed
        from service_accounts sa
        join subscribers s on s.id = sa.subscriber_id
        join service_plans p on p.id = sa.plan_id
       where sa.status = 'ACTIVE' and sa.billing_start_date <= ${periodBounds(period).end}
         ${ids ? sql`and sa.id in ${ids}` : sql``}
       order by sa.id`,
  );
}

/** Line items for one monthly invoice. The rate is copied onto the invoice, so later plan price changes never alter it. */
export function buildMonthlyItems(account: Pick<BillableAccount, 'planName' | 'currentRate' | 'monthlyDiscount' | 'installationFee' | 'firstBilling' | 'overdueInvoices'>, period: string, settings: SettingsMap): InvoiceItemInput[] {
  const items: InvoiceItemInput[] = [{ itemType: 'SUBSCRIPTION', description: `${account.planName} - ${periodLabel(period)}`, quantity: 1, unitAmount: account.currentRate }];
  if (account.firstBilling && account.installationFee > 0) {
    items.push({ itemType: 'INSTALLATION_FEE', description: 'Installation fee', quantity: 1, unitAmount: account.installationFee });
  }
  if (settings['billing.penaltyEnabled'] && account.overdueInvoices > 0 && Number(settings['billing.penaltyAmount']) > 0) {
    items.push({ itemType: 'PENALTY', description: 'Late payment penalty', quantity: 1, unitAmount: Number(settings['billing.penaltyAmount']) });
  }
  if (account.monthlyDiscount > 0) {
    items.push({ itemType: 'DISCOUNT', description: 'Monthly discount', quantity: 1, unitAmount: -account.monthlyDiscount });
  }
  return items;
}

function monthlyDueDate(account: Pick<BillableAccount, 'dueDay' | 'billingStartDate'>, period: string): string {
  const due = dueDateFor(period, account.dueDay);
  // A subscriber activated after the usual due day gets until the end of that first month.
  return due < account.billingStartDate ? periodBounds(period).end : due;
}

export async function previewBilling(db: DbOrTx, period: string): Promise<BillingPreview> {
  const settings = await getSettings(db);
  const accounts = await billableAccounts(db, period);
  const eligible = accounts.filter((a) => !a.billed);
  const preview = eligible.map((account) => {
    const items = buildMonthlyItems(account, period, settings);
    return {
      serviceAccountId: account.id,
      serviceAccountNo: account.accountNo,
      subscriberName: account.subscriberName,
      planName: account.planName,
      dueDate: monthlyDueDate(account, period),
      total: computeInvoiceTotals(items).total,
      items: items.map((i) => ({ itemType: i.itemType, description: i.description, amount: lineAmount(i) })),
    };
  });
  return {
    period,
    eligibleCount: eligible.length,
    alreadyBilledCount: accounts.length - eligible.length,
    totalAmount: preview.reduce((sum, r) => sum + r.total, 0),
    rows: preview.slice(0, 500),
  };
}

interface DraftInput {
  type: InvoiceType;
  subscriberId: number;
  serviceAccountId: number;
  billingCycleId?: number | null;
  billingPeriod?: string | null;
  invoiceDate: string;
  dueDate: string;
  items: InvoiceItemInput[];
}

/** Inserts a DRAFT invoice with its items. Returns null when the account is already billed for the period. */
async function insertDraft(tx: DbOrTx, actor: Actor, input: DraftInput): Promise<number | null> {
  // Take the subscriber lock before touching invoices so concurrent sessions queue up instead of deadlocking.
  await lockSubscriber(tx, input.subscriberId);
  const totals = computeInvoiceTotals(input.items);
  const bounds = input.billingPeriod ? periodBounds(input.billingPeriod) : null;
  const [invoice] = await tx
    .insert(invoices)
    .values({
      type: input.type,
      subscriberId: input.subscriberId,
      serviceAccountId: input.serviceAccountId,
      billingCycleId: input.billingCycleId ?? null,
      billingPeriod: input.billingPeriod ?? null,
      periodStart: bounds?.start ?? null,
      periodEnd: bounds?.end ?? null,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      total: totals.total,
      balance: totals.total,
      status: 'DRAFT',
      createdBy: actor.id,
    })
    // The partial unique index on (service_account_id, billing_period) rejects a second live invoice.
    .onConflictDoNothing()
    .returning({ id: invoices.id });
  if (!invoice) return null;
  await tx.insert(invoiceItems).values(
    input.items.map((item) => ({ invoiceId: invoice.id, itemType: item.itemType, description: item.description, quantity: item.quantity, unitAmount: item.unitAmount, amount: lineAmount(item) })),
  );
  return invoice.id;
}

/**
 * Finalizes a draft: assigns the invoice number, posts the ledger debit and applies any
 * advance credit the subscriber already holds. After this the invoice is immutable.
 */
export async function finalizeInvoice(tx: DbOrTx, actor: Actor, invoiceId: number, settings: SettingsMap): Promise<{ invoiceNo: string; total: number; creditApplied: number }> {
  const head = await one<{ subscriberId: number; description: string }>(
    tx,
    sql`select i.subscriber_id as "subscriberId",
          case when i.type = 'MONTHLY' then st.name else (select ii.description from invoice_items ii where ii.invoice_id = i.id order by ii.id limit 1) end as description
        from invoices i join service_accounts sa on sa.id = i.service_account_id
        join service_plans p on p.id = sa.plan_id join service_types st on st.id = p.service_type_id
       where i.id = ${invoiceId}`,
  );
  if (!head) throw notFound('Invoice');
  await lockSubscriber(tx, head.subscriberId);
  const inv = await lockInvoice(tx, invoiceId);
  if (inv.status !== 'DRAFT') throw conflict('ALREADY_FINALIZED', 'This invoice has already been finalized.');

  const invoiceNo = await nextNumber(tx, 'INVOICE');
  const period = await one<{ billingPeriod: string | null }>(tx, sql`select billing_period as "billingPeriod" from invoices where id = ${invoiceId}`);
  const status = deriveInvoiceStatus({ ...inv, finalized: true, voided: false }, today());
  await tx.update(invoices).set({ invoiceNo, status, finalizedAt: new Date(), finalizedBy: actor.id }).where(eq(invoices.id, invoiceId));
  if (inv.total > 0) {
    await postLedger(tx, {
      subscriberId: head.subscriberId,
      serviceAccountId: inv.serviceAccountId,
      entryDate: inv.invoiceDate,
      sourceType: 'INVOICE',
      sourceId: invoiceId,
      referenceNo: invoiceNo,
      description: period?.billingPeriod ? `${periodLabel(period.billingPeriod)} ${head.description}` : head.description,
      debit: inv.total,
      actorId: actor.id,
    });
  }
  const creditApplied = settings['billing.autoApplyCredit'] ? await applyAvailableCredit(tx, actor, head.subscriberId) : 0;
  return { invoiceNo, total: inv.total, creditApplied };
}

/**
 * Advance payment policy: money paid beyond the open invoices stays on the payment as
 * unapplied credit. When new invoices are finalized the credit is applied oldest payment
 * first, oldest invoice first. No ledger entry is needed - the ledger was already credited
 * with the full payment on the day it was received.
 */
export async function applyAvailableCredit(tx: DbOrTx, actor: Actor, subscriberId: number): Promise<number> {
  const credits = await rows<{ id: number; unapplied: number }>(
    tx,
    sql`select id, unapplied_amount as unapplied from payments
         where subscriber_id = ${subscriberId} and status = 'POSTED' and unapplied_amount > 0
         order by payment_date, id for update`,
  );
  if (!credits.length) return 0;
  const open = await lockOpenInvoices(tx, subscriberId);
  let applied = 0;
  for (const credit of credits) {
    const remaining = open.filter((inv) => inv.balance > 0);
    if (!remaining.length) break;
    const result = allocateOldestFirst(remaining, credit.unapplied);
    for (const line of result.lines) {
      await insertAllocation(tx, { paymentId: credit.id, invoice: open.find((inv) => inv.id === line.invoiceId)!, amount: line.applied, type: 'CREDIT', actorId: actor.id });
    }
    await tx.update(payments).set({ unappliedAmount: result.unapplied }).where(eq(payments.id, credit.id));
    applied += result.totalApplied;
  }
  if (applied > 0) {
    await audit(tx, actor, { action: 'payment.credit_applied', entityType: 'subscriber', entityId: subscriberId, subscriberId, newValues: { amountApplied: applied } });
  }
  return applied;
}

/**
 * Generates the monthly invoices for a period. Each invoice (header, items, number, ledger
 * debit) commits atomically in its own transaction, and the database rejects a second live
 * invoice for the same service account and period - so the run can be repeated safely and
 * simply fills in whatever is still missing.
 */
export async function generateBilling({ db, actor }: Ctx, input: BillingGenerateInput): Promise<BillingRunResult> {
  const settings = await getSettings(db);
  await refreshOverdue(db);
  const bounds = periodBounds(input.period);
  const [cycle] = await db
    .insert(billingCycles)
    .values({ period: input.period, periodStart: bounds.start, periodEnd: bounds.end })
    .onConflictDoUpdate({ target: billingCycles.period, set: { periodStart: bounds.start } })
    .returning({ id: billingCycles.id });

  const accounts = await billableAccounts(db, input.period, input.serviceAccountIds);
  const result: BillingRunResult = { period: input.period, created: 0, skippedAlreadyBilled: accounts.filter((a) => a.billed).length, finalized: 0, totalBilled: 0, creditApplied: 0 };

  for (const account of accounts.filter((a) => !a.billed)) {
    const outcome = await db.transaction(async (tx) => {
      const invoiceId = await insertDraft(tx, actor, {
        type: 'MONTHLY',
        subscriberId: account.subscriberId,
        serviceAccountId: account.id,
        billingCycleId: cycle.id,
        billingPeriod: input.period,
        invoiceDate: bounds.start,
        dueDate: monthlyDueDate(account, input.period),
        items: buildMonthlyItems(account, input.period, settings),
      });
      if (invoiceId === null) return null; // another PC billed this account a moment ago
      if (!input.finalize) return { total: computeInvoiceTotals(buildMonthlyItems(account, input.period, settings)).total, creditApplied: 0, finalized: false };
      return { ...(await finalizeInvoice(tx, actor, invoiceId, settings)), finalized: true };
    });
    if (outcome === null) {
      result.skippedAlreadyBilled++;
      continue;
    }
    result.created++;
    result.totalBilled += outcome.total;
    result.creditApplied += outcome.creditApplied;
    if (outcome.finalized) result.finalized++;
  }

  await db.update(billingCycles).set({ lastGeneratedAt: new Date(), lastGeneratedBy: actor.id }).where(eq(billingCycles.id, cycle.id));
  await audit(db, actor, { action: 'billing.generate', entityType: 'billing_cycle', entityId: input.period, newValues: { ...result, mode: input.finalize ? 'FINALIZED' : 'DRAFT' } });
  return result;
}

export async function finalizeDrafts({ db, actor }: Ctx, period: string): Promise<{ finalized: number; totalBilled: number }> {
  const settings = await getSettings(db);
  const drafts = await rows<{ id: number }>(db, sql`select id from invoices where status = 'DRAFT' and billing_period = ${period} order by id`);
  let finalized = 0;
  let totalBilled = 0;
  for (const draft of drafts) {
    const done = await db.transaction(async (tx) => {
      const current = await one<{ status: string }>(tx, sql`select status from invoices where id = ${draft.id}`);
      if (current?.status !== 'DRAFT') return null;
      return finalizeInvoice(tx, actor, draft.id, settings);
    });
    if (done) {
      finalized++;
      totalBilled += done.total;
    }
  }
  await audit(db, actor, { action: 'billing.finalize_drafts', entityType: 'billing_cycle', entityId: period, newValues: { finalized, totalBilled } });
  return { finalized, totalBilled };
}

/** Drafts were never posted to the ledger, so discarding them is not a destructive financial change. */
export async function discardDrafts({ db, actor }: Ctx, period: string): Promise<{ discarded: number }> {
  const deleted = await rows(db, sql`delete from invoices where status = 'DRAFT' and billing_period = ${period} returning id`);
  await audit(db, actor, { action: 'billing.discard_drafts', entityType: 'billing_cycle', entityId: period, newValues: { discarded: deleted.length } });
  return { discarded: deleted.length };
}

/** One-off charge such as a reconnection fee, finalized immediately. */
export async function createOneTimeInvoice(
  tx: DbOrTx,
  actor: Actor,
  input: { subscriberId: number; serviceAccountId: number; invoiceDate: string; dueDate: string; items: InvoiceItemInput[] },
): Promise<{ id: number; invoiceNo: string; total: number }> {
  const id = await insertDraft(tx, actor, { ...input, type: 'ONE_TIME' });
  if (id === null) throw conflict('DUPLICATE_INVOICE', 'The invoice could not be created.');
  const finalized = await finalizeInvoice(tx, actor, id, await getSettings(tx));
  return { id, ...finalized };
}

// ===================================================================
// Controlled changes to finalized invoices: void and adjustment
// ===================================================================
export async function voidInvoice({ db, actor }: Ctx, invoiceId: number, reason: string): Promise<InvoiceDetail> {
  await db.transaction(async (tx) => {
    const head = await one<{ subscriberId: number }>(tx, sql`select subscriber_id as "subscriberId" from invoices where id = ${invoiceId}`);
    if (!head) throw notFound('Invoice');
    await lockSubscriber(tx, head.subscriberId);
    const inv = await lockInvoice(tx, invoiceId);
    if (inv.status === 'DRAFT') throw invalid('Draft invoices are discarded, not voided.');
    if (inv.status === 'VOID') throw conflict('ALREADY_VOID', 'This invoice is already void.');
    if (inv.amountPaid > 0) throw conflict('INVOICE_HAS_PAYMENTS', 'Payments are applied to this invoice. Reverse those payments before voiding it.');

    const outstanding = inv.total + inv.adjustmentsTotal;
    await tx.update(invoices).set({ status: 'VOID', balance: 0, voidedAt: new Date(), voidedBy: actor.id, voidReason: reason }).where(eq(invoices.id, invoiceId));
    if (outstanding > 0) {
      await postLedger(tx, {
        subscriberId: head.subscriberId,
        serviceAccountId: inv.serviceAccountId,
        entryDate: today(),
        sourceType: 'INVOICE_VOID',
        sourceId: invoiceId,
        referenceNo: inv.invoiceNo,
        description: `Void of ${inv.invoiceNo}`,
        credit: outstanding,
        actorId: actor.id,
      });
    }
    await audit(tx, actor, {
      action: 'invoice.void',
      entityType: 'invoice',
      entityId: invoiceId,
      subscriberId: head.subscriberId,
      reason,
      oldValues: { invoiceNo: inv.invoiceNo, status: inv.status, balance: inv.balance },
      newValues: { status: 'VOID', balance: 0 },
    });
  });
  return getInvoice(db, invoiceId);
}

export async function createAdjustment({ db, actor }: Ctx, input: AdjustmentInput): Promise<InvoiceDetail> {
  await db.transaction(async (tx) => {
    const head = await one<{ subscriberId: number }>(tx, sql`select subscriber_id as "subscriberId" from invoices where id = ${input.invoiceId}`);
    if (!head) throw notFound('Invoice');
    await lockSubscriber(tx, head.subscriberId);
    const inv = await lockInvoice(tx, input.invoiceId);
    if (inv.status === 'DRAFT' || inv.status === 'VOID') throw invalid('Adjustments can only be posted to a finalized, non-void invoice.');
    if (input.type === 'CREDIT' && input.amount > inv.balance) {
      throw invalid(`A credit adjustment cannot exceed the invoice balance of ${formatMoney(inv.balance, { symbol: true })}.`, { amount: 'Exceeds invoice balance' });
    }
    const before = { status: inv.status, balance: inv.balance, adjustmentsTotal: inv.adjustmentsTotal };
    const adjustmentNo = await nextNumber(tx, 'ADJUSTMENT');
    const [adjustment] = await tx
      .insert(adjustments)
      .values({ adjustmentNo, subscriberId: head.subscriberId, invoiceId: inv.id, type: input.type, amount: input.amount, reason: input.reason, createdBy: actor.id })
      .returning({ id: adjustments.id });
    await updateInvoiceAmounts(tx, inv, { adjustmentDelta: input.type === 'DEBIT' ? input.amount : -input.amount });
    await postLedger(tx, {
      subscriberId: head.subscriberId,
      serviceAccountId: inv.serviceAccountId,
      entryDate: today(),
      sourceType: 'ADJUSTMENT',
      sourceId: adjustment.id,
      referenceNo: adjustmentNo,
      description: `${input.type === 'DEBIT' ? 'Debit' : 'Credit'} adjustment on ${inv.invoiceNo}: ${input.reason}`,
      debit: input.type === 'DEBIT' ? input.amount : 0,
      credit: input.type === 'CREDIT' ? input.amount : 0,
      actorId: actor.id,
    });
    await audit(tx, actor, {
      action: 'adjustment.post',
      entityType: 'invoice',
      entityId: inv.id,
      subscriberId: head.subscriberId,
      reason: input.reason,
      oldValues: before,
      newValues: { adjustmentNo, type: input.type, amount: input.amount, balance: inv.balance, adjustmentsTotal: inv.adjustmentsTotal },
    });
  });
  return getInvoice(db, input.invoiceId);
}

export async function listAdjustments(db: DbOrTx, q: ListQuery & { invoiceId?: number }): Promise<Paged<AdjustmentRow>> {
  const base = sql`select a.id, a.adjustment_no as "adjustmentNo", a.invoice_id as "invoiceId", i.invoice_no as "invoiceNo", a.subscriber_id as "subscriberId",
        s.full_name as "subscriberName", a.type, a.amount, a.reason, u.full_name as "createdByName", ${iso('a.created_at')} as "createdAt"
      from adjustments a join invoices i on i.id = a.invoice_id join subscribers s on s.id = a.subscriber_id left join users u on u.id = a.created_by
      ${where(q.subscriberId && sql`a.subscriber_id = ${q.subscriberId}`, q.invoiceId && sql`a.invoice_id = ${q.invoiceId}`)}`;
  return paged<AdjustmentRow>(db, base, q, { createdAt: '"createdAt"', amount: 'amount' }, 'id desc');
}

// ===================================================================
// Invoice queries
// ===================================================================
const invoiceSelect = () => sql`
  select i.id, i.invoice_no as "invoiceNo", i.type, i.subscriber_id as "subscriberId", s.account_no as "subscriberAccountNo", s.full_name as "subscriberName",
    i.service_account_id as "serviceAccountId", sa.account_no as "serviceAccountNo", p.name as "planName", i.billing_period as "billingPeriod",
    i.invoice_date as "invoiceDate", i.due_date as "dueDate", i.total, i.adjustments_total as "adjustmentsTotal", i.amount_paid as "amountPaid", i.balance, i.status,
    case when i.balance > 0 and i.status in ${OPEN} then greatest(${today()}::date - i.due_date, 0) else 0 end as "daysPastDue"
  from invoices i
  join subscribers s on s.id = i.subscriber_id
  join service_accounts sa on sa.id = i.service_account_id
  join service_plans p on p.id = sa.plan_id`;

export async function listInvoices(db: DbOrTx, q: ListQuery): Promise<Paged<InvoiceRow>> {
  const term = q.q ? contains(q.q) : null;
  const base = sql`${invoiceSelect()} ${where(
    term && sql`(i.invoice_no ilike ${term} or s.full_name ilike ${term} or s.account_no ilike ${term} or sa.account_no ilike ${term})`,
    q.status === 'OPEN' ? sql`i.status in ${OPEN}` : q.status === 'PAST_DUE' ? sql`i.status in ${OPEN} and i.due_date < ${today()}` : q.status && sql`i.status = ${q.status}`,
    q.period && sql`i.billing_period = ${q.period}`,
    q.subscriberId && sql`i.subscriber_id = ${q.subscriberId}`,
    q.from && sql`i.invoice_date >= ${q.from}`,
    q.to && sql`i.invoice_date <= ${q.to}`,
  )}`;
  return paged<InvoiceRow>(
    db,
    base,
    q,
    { invoiceNo: '"invoiceNo"', subscriberName: '"subscriberName"', invoiceDate: '"invoiceDate"', dueDate: '"dueDate"', total: 'total', balance: 'balance', status: 'status', billingPeriod: '"billingPeriod"' },
    '"invoiceDate" desc, id desc',
  );
}

export async function getInvoice(db: DbOrTx, id: number): Promise<InvoiceDetail> {
  const head = await one<Omit<InvoiceDetail, 'items' | 'allocations' | 'adjustments'>>(
    db,
    sql`select t.*, x.period_start as "periodStart", x.period_end as "periodEnd", x.subtotal, x.discount_total as "discountTotal",
          ${address('a')} as address, ${iso('x.finalized_at')} as "finalizedAt", ${iso('x.voided_at')} as "voidedAt", x.void_reason as "voidReason"
        from (${invoiceSelect()} where i.id = ${id}) t
        join invoices x on x.id = t.id
        join service_accounts sa2 on sa2.id = x.service_account_id
        join subscriber_addresses a on a.id = sa2.address_id`,
  );
  if (!head) throw notFound('Invoice');
  const [items, allocations, adjustmentRows] = await Promise.all([
    rows<InvoiceItemRow>(db, sql`select id, item_type as "itemType", description, quantity, unit_amount as "unitAmount", amount from invoice_items where invoice_id = ${id} order by id`),
    rows<InvoiceAllocationRow>(
      db,
      sql`select pa.payment_id as "paymentId", r.receipt_no as "receiptNo", p.payment_date as "paymentDate", p.method, pa.amount, pa.type, pa.is_reversed as "isReversed"
            from payment_allocations pa join payments p on p.id = pa.payment_id join receipts r on r.payment_id = p.id
           where pa.invoice_id = ${id} order by pa.id`,
    ),
    listAdjustments(db, { page: 1, pageSize: 100, invoiceId: id }),
  ]);
  return { ...head, items, allocations, adjustments: adjustmentRows.rows };
}

export async function currentBilling(db: DbOrTx, period = periodOf(today())): Promise<CurrentBilling> {
  const accounts = await billableAccounts(db, period);
  const byStatus = await rows<CurrentBilling['byStatus'][number]>(
    db,
    sql`select status, count(*) as count, coalesce(sum(total + adjustments_total), 0)::bigint as total, coalesce(sum(balance), 0)::bigint as balance
          from invoices where billing_period = ${period} and status <> 'VOID' group by status order by status`,
  );
  const collected = await one<{ amount: number }>(
    db,
    sql`select coalesce(sum(amount_paid), 0)::bigint as amount from invoices where billing_period = ${period} and status not in ('VOID','DRAFT')`,
  );
  const finalized = byStatus.filter((s) => s.status !== 'DRAFT');
  return {
    period,
    activeAccounts: accounts.length,
    billedAccounts: accounts.filter((a) => a.billed).length,
    unbilledAccounts: accounts.filter((a) => !a.billed).length,
    draftCount: byStatus.find((s) => s.status === 'DRAFT')?.count ?? 0,
    totalBilled: finalized.reduce((sum, s) => sum + s.total, 0),
    totalCollected: collected?.amount ?? 0,
    totalOutstanding: finalized.reduce((sum, s) => sum + s.balance, 0),
    byStatus,
  };
}

export async function listCycles(db: DbOrTx): Promise<BillingCycleRow[]> {
  return rows<BillingCycleRow>(
    db,
    sql`select bc.id, bc.period, ${iso('bc.last_generated_at')} as "lastGeneratedAt", u.full_name as "lastGeneratedByName",
          count(i.id) filter (where i.status not in ('VOID','DRAFT')) as "invoiceCount",
          count(i.id) filter (where i.status = 'DRAFT') as "draftCount",
          coalesce(sum(i.total + i.adjustments_total) filter (where i.status not in ('VOID','DRAFT')), 0)::bigint as "totalBilled",
          coalesce(sum(i.amount_paid) filter (where i.status not in ('VOID','DRAFT')), 0)::bigint as "totalCollected",
          coalesce(sum(i.balance) filter (where i.status not in ('VOID','DRAFT')), 0)::bigint as "totalOutstanding"
        from billing_cycles bc
        left join invoices i on i.billing_period = bc.period
        left join users u on u.id = bc.last_generated_by
       group by bc.id, u.full_name order by bc.period desc`,
  );
}

// ===================================================================
// Subscriber ledger
// ===================================================================
/**
 * The running balance is recomputed from the append-only entries every time, ordered by
 * business date then insertion order, so the same history always yields the same balances.
 */
export async function getLedger(db: DbOrTx, subscriberId: number, range: { from?: string; to?: string }): Promise<LedgerResult> {
  const exists = await one(db, sql`select 1 from subscribers where id = ${subscriberId}`);
  if (!exists) throw notFound('Subscriber');
  const opening = range.from
    ? await one<{ balance: number }>(db, sql`select coalesce(sum(debit - credit), 0)::bigint as balance from ledger_entries where subscriber_id = ${subscriberId} and entry_date < ${range.from}`)
    : { balance: 0 };
  const entries = await rows<LedgerRow>(
    db,
    sql`select * from (
          select l.id, l.entry_date as "entryDate", l.reference_no as "referenceNo", l.description, l.source_type as "sourceType", l.source_id as "sourceId",
                 l.debit, l.credit, (sum(l.debit - l.credit) over (order by l.entry_date, l.id))::bigint as balance
            from ledger_entries l where l.subscriber_id = ${subscriberId}
        ) t
        ${where(range.from && sql`"entryDate" >= ${range.from}`, range.to && sql`"entryDate" <= ${range.to}`)}
        order by "entryDate", id`,
  );
  const totalDebit = entries.reduce((sum, e) => sum + e.debit, 0);
  const totalCredit = entries.reduce((sum, e) => sum + e.credit, 0);
  const openingBalance = opening?.balance ?? 0;
  return {
    subscriberId,
    from: range.from ?? null,
    to: range.to ?? null,
    openingBalance,
    totalDebit,
    totalCredit,
    closingBalance: openingBalance + totalDebit - totalCredit,
    rows: entries,
  };
}
