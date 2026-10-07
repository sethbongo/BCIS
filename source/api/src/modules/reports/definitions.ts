import {
  AGING_BUCKET_LABELS,
  AGING_BUCKETS,
  formatDate,
  PAYMENT_METHOD_LABELS,
  periodBounds,
  periodLabel,
  periodOf,
  statusLabel,
  zDate,
  type BatchRow,
  type PaymentMethod,
  type ReportColumn,
  type ReportData,
  type ReportDefinition,
} from '@bcis/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../../config';
import { rows, where, type DbOrTx } from '../../db/client';
import { today } from '../../lib/context';
import { OPEN } from '../../lib/sqlfrag';
import { getLedger } from '../billing/service';
import { batchSelect } from '../collections/service';
import { listPayments } from '../payments/service';
import { getAging, listOverdue } from '../receivables/service';
import { getSubscriber, listSubscribers } from '../subscribers/service';

const optionalId = z.coerce.number().int().positive().optional();
export const ReportQuery = z.object({
  from: zDate.optional(),
  to: zDate.optional(),
  groupBy: z.enum(['day', 'week', 'month', 'year']).default('day'),
  dimension: z.enum(['plan', 'service', 'area']).default('plan'),
  collectorId: optionalId,
  areaId: optionalId,
  subscriberId: optionalId,
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  format: z.enum(['json', 'xlsx', 'pdf', 'csv']).default('json'),
});
export type ReportQuery = z.infer<typeof ReportQuery>;

type Row = Record<string, string | number | null>;
type Built = Pick<ReportData, 'subtitle' | 'columns' | 'rows' | 'totals'> & Partial<Pick<ReportData, 'header' | 'notes'>>;
interface Params extends ReportQuery {
  from: string;
  to: string;
  year: number;
}
type Builder = (db: DbOrTx, p: Params) => Promise<Built>;

const ALL = { page: 1, pageSize: 100_000 };
const range = (p: Params) => `${formatDate(p.from)} to ${formatDate(p.to)}`;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part * 1000) / whole) / 10 : 0);

function totalsOf(data: Row[], columns: ReportColumn[], label = 'TOTAL'): Row {
  const totals: Row = { [columns[0].key]: label };
  for (const col of columns.filter((c) => (c.type === 'money' || c.type === 'int') && c.key !== columns[0].key)) {
    totals[col.key] = data.reduce((sum, r) => sum + (Number(r[col.key]) || 0), 0);
  }
  return totals;
}

const col = (key: string, header: string, type: ReportColumn['type'] = 'text', width?: number): ReportColumn => ({ key, header, type, width });

// ------------------------------------------------------------------ Collections
const collections: Builder = async (db, p) => {
  const group = {
    day: sql`p.payment_date::text`,
    week: sql`'Week of ' || to_char(date_trunc('week', p.payment_date), 'YYYY-MM-DD')`,
    month: sql`to_char(p.payment_date, 'YYYY-MM')`,
    year: sql`to_char(p.payment_date, 'YYYY')`,
  }[p.groupBy];
  const data = await rows<Row>(
    db,
    sql`select ${group} as period, count(*) as payments,
          coalesce(sum(amount) filter (where method = 'CASH'), 0)::bigint as cash,
          coalesce(sum(amount) filter (where method = 'GCASH'), 0)::bigint as gcash,
          coalesce(sum(amount) filter (where method = 'BANK_TRANSFER'), 0)::bigint as bank,
          coalesce(sum(amount) filter (where method = 'CHEQUE'), 0)::bigint as cheque,
          coalesce(sum(amount) filter (where method = 'OTHER'), 0)::bigint as other,
          sum(amount)::bigint as total
        from payments p where p.status = 'POSTED' and p.payment_date between ${p.from} and ${p.to}
       group by 1 order by 1`,
  );
  const columns = [
    col('period', { day: 'Date', week: 'Week', month: 'Month', year: 'Year' }[p.groupBy], 'text', 2),
    col('payments', 'Payments', 'int'),
    col('cash', 'Cash', 'money'),
    col('gcash', 'GCash', 'money'),
    col('bank', 'Bank Transfer', 'money'),
    col('cheque', 'Cheque', 'money'),
    col('other', 'Other', 'money'),
    col('total', 'Total Collected', 'money'),
  ];
  const labels = { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Annual' };
  return { subtitle: `${labels[p.groupBy]} collections, ${range(p)}`, columns, rows: data, totals: totalsOf(data, columns), notes: ['Reversed payments are excluded.'] };
};

const paymentMethods: Builder = async (db, p) => {
  const data = await rows<{ method: PaymentMethod; payments: number; amount: number }>(
    db,
    sql`select method, count(*) as payments, sum(amount)::bigint as amount from payments
         where status = 'POSTED' and payment_date between ${p.from} and ${p.to} group by method order by 3 desc`,
  );
  const grand = data.reduce((sum, r) => sum + r.amount, 0);
  const out = data.map((r) => ({ method: PAYMENT_METHOD_LABELS[r.method], payments: r.payments, amount: r.amount, share: pct(r.amount, grand) }));
  const columns = [col('method', 'Payment Method', 'text', 2), col('payments', 'Payments', 'int'), col('amount', 'Amount', 'money'), col('share', '% of Total', 'percent')];
  return { subtitle: `Payment method summary, ${range(p)}`, columns, rows: out, totals: { ...totalsOf(out, columns), share: grand ? 100 : 0 } };
};

const paymentRegister: Builder = async (db, p) => {
  const page = await listPayments(db, { ...ALL, from: p.from, to: p.to, collectorId: p.collectorId, sort: 'paymentDate', dir: 'asc' });
  const data = page.rows.map((r) => ({
    paymentDate: r.paymentDate,
    receiptNo: r.receiptNo,
    accountNo: r.subscriberAccountNo,
    subscriber: r.subscriberName,
    method: PAYMENT_METHOD_LABELS[r.method],
    referenceNo: r.referenceNo,
    receivedBy: r.collectorName ?? r.receivedByName,
    status: statusLabel(r.status),
    amount: r.status === 'POSTED' ? r.amount : 0,
  }));
  const columns = [
    col('paymentDate', 'Date', 'date'),
    col('receiptNo', 'Receipt No.'),
    col('accountNo', 'Account No.'),
    col('subscriber', 'Subscriber', 'text', 2),
    col('method', 'Method'),
    col('referenceNo', 'Reference'),
    col('receivedBy', 'Received / Collected By', 'text', 1.5),
    col('status', 'Status'),
    col('amount', 'Amount', 'money'),
  ];
  return { subtitle: `Payment register, ${range(p)}`, columns, rows: data, totals: totalsOf(data, columns), notes: ['Reversed payments are listed with a zero amount so receipt numbering stays complete.'] };
};

// ------------------------------------------------------------------ Billing & revenue
const billingVsCollection: Builder = async (db, p) => {
  const data = await rows<{ period: string; billed: number; collected: number; outstanding: number }>(
    db,
    sql`select m.period,
          (select coalesce(sum(total + adjustments_total), 0)::bigint from invoices where billing_period = m.period and status not in ('VOID','DRAFT')) as billed,
          (select coalesce(sum(amount), 0)::bigint from payments where status = 'POSTED' and to_char(payment_date, 'YYYY-MM') = m.period) as collected,
          (select coalesce(sum(balance), 0)::bigint from invoices where billing_period = m.period and status in ${OPEN}) as outstanding
        from (select to_char(make_date(${p.year}::int, g, 1), 'YYYY-MM') as period from generate_series(1, 12) g) m order by 1`,
  );
  const out = data.map((r) => ({ month: periodLabel(r.period), billed: r.billed, collected: r.collected, rate: pct(r.collected, r.billed), outstanding: r.outstanding }));
  const columns = [col('month', 'Billing Month', 'text', 2), col('billed', 'Billed', 'money'), col('collected', 'Collected', 'money'), col('rate', 'Collection Rate %', 'percent'), col('outstanding', 'Still Outstanding', 'money')];
  const totals = totalsOf(out, columns);
  return {
    subtitle: `Billing versus collection, ${p.year}`,
    columns,
    rows: out,
    totals: { ...totals, rate: pct(Number(totals.collected), Number(totals.billed)) },
    notes: ['Billed = invoices of the billing month. Collected = payments received during the calendar month (including advance payments and arrears).'],
  };
};

const revenue: Builder = async (db, p) => {
  const dimension = { plan: sql`p.name`, service: sql`st.name`, area: sql`coalesce(ar.name, 'Unassigned')` }[p.dimension];
  const data = await rows<Row>(
    db,
    sql`select ${dimension} as name, count(*) as invoices, sum(i.total + i.adjustments_total)::bigint as billed,
          sum(i.amount_paid)::bigint as collected, sum(i.balance)::bigint as outstanding
        from invoices i
        join service_accounts sa on sa.id = i.service_account_id
        join service_plans p on p.id = sa.plan_id
        join service_types st on st.id = p.service_type_id
        join subscribers s on s.id = i.subscriber_id
        left join collection_areas ar on ar.id = s.collection_area_id
       where i.status not in ('VOID','DRAFT') and i.invoice_date between ${p.from} and ${p.to}
       group by 1 order by 3 desc`,
  );
  const label = { plan: 'Plan', service: 'Service Type', area: 'Collection Area' }[p.dimension];
  const columns = [col('name', label, 'text', 2.5), col('invoices', 'Invoices', 'int'), col('billed', 'Billed Revenue', 'money'), col('collected', 'Collected', 'money'), col('outstanding', 'Outstanding', 'money')];
  return { subtitle: `Revenue by ${label.toLowerCase()}, invoices dated ${range(p)}`, columns, rows: data, totals: totalsOf(data, columns) };
};

// ------------------------------------------------------------------ Receivables
const arAging: Builder = async (db, p) => {
  const report = await getAging(db, { ...ALL, areaId: p.areaId, collectorId: p.collectorId });
  const columns = [
    col('accountNo', 'Account No.'),
    col('fullName', 'Subscriber', 'text', 2),
    col('areaName', 'Area', 'text', 1.3),
    ...AGING_BUCKETS.map((b) => col(b, AGING_BUCKET_LABELS[b], 'money')),
    col('total', 'Total', 'money'),
  ];
  const data = report.rows.map((r) => ({ ...r }) as unknown as Row);
  return {
    subtitle: `Accounts receivable aging as of ${formatDate(report.asOf)}`,
    columns,
    rows: data,
    totals: { accountNo: 'TOTAL', ...report.totals },
    notes: [`Aging is based on invoice due date. Total of open invoice balances in the system: ${(report.outstandingInvoiceTotal / 100).toFixed(2)}.`],
  };
};

const overdue: Builder = async (db, p) => {
  const page = await listOverdue(db, { ...ALL, areaId: p.areaId, collectorId: p.collectorId });
  const columns = [
    col('accountNo', 'Account No.'),
    col('fullName', 'Subscriber', 'text', 2),
    col('planName', 'Service', 'text', 1.5),
    col('areaName', 'Area', 'text', 1.2),
    col('collectorName', 'Collector', 'text', 1.3),
    col('monthsUnpaid', 'Months Unpaid', 'int'),
    col('oldestInvoiceNo', 'Oldest Invoice'),
    col('oldestDueDate', 'Oldest Due', 'date'),
    col('daysPastDue', 'Days Past Due', 'int'),
    col('lastPaymentDate', 'Last Payment', 'date'),
    col('totalArrears', 'Total Arrears', 'money'),
  ];
  const data = page.rows.map((r) => ({ ...r }) as unknown as Row);
  return { subtitle: `Overdue accounts as of ${formatDate(today())}`, columns, rows: data, totals: { accountNo: 'TOTAL', totalArrears: page.rows.reduce((s, r) => s + r.totalArrears, 0) } };
};

// ------------------------------------------------------------------ Subscribers
const subscriberMaster: Builder = async (db, p) => {
  const page = await listSubscribers(db, { ...ALL, areaId: p.areaId, collectorId: p.collectorId, sort: 'accountNo' });
  const columns = [
    col('accountNo', 'Account No.'),
    col('fullName', 'Subscriber', 'text', 2),
    col('phone', 'Contact No.'),
    col('address', 'Address', 'text', 2.5),
    col('areaName', 'Area', 'text', 1.2),
    col('collectorName', 'Collector', 'text', 1.3),
    col('serviceCount', 'Services', 'int'),
    col('status', 'Status'),
    col('balance', 'Balance', 'money'),
  ];
  const data = page.rows.map((r) => ({ ...r, status: statusLabel(r.status) }) as unknown as Row);
  return { subtitle: `Subscriber master list as of ${formatDate(today())}`, columns, rows: data, totals: { accountNo: `TOTAL (${data.length})`, balance: page.rows.reduce((s, r) => s + r.balance, 0) } };
};

const subscriberSoa: Builder = async (db, p) => {
  if (!p.subscriberId) throw new Error('subscriberId is required');
  const [subscriber, ledger] = await Promise.all([getSubscriber(db, p.subscriberId), getLedger(db, p.subscriberId, { from: p.from, to: p.to })]);
  const columns = [col('entryDate', 'Date', 'date'), col('referenceNo', 'Reference'), col('description', 'Description', 'text', 3), col('debit', 'Debit', 'money'), col('credit', 'Credit', 'money'), col('balance', 'Balance', 'money')];
  const data: Row[] = [
    { entryDate: p.from, referenceNo: '', description: 'Balance brought forward', debit: null, credit: null, balance: ledger.openingBalance },
    ...ledger.rows.map((r) => ({ entryDate: r.entryDate, referenceNo: r.referenceNo, description: r.description, debit: r.debit || null, credit: r.credit || null, balance: r.balance })),
  ];
  return {
    subtitle: `Statement of Account, ${range(p)}`,
    columns,
    rows: data,
    totals: { entryDate: 'CLOSING BALANCE', debit: ledger.totalDebit, credit: ledger.totalCredit, balance: ledger.closingBalance },
    header: [
      { label: 'Subscriber', value: subscriber.fullName },
      { label: 'Account No.', value: subscriber.accountNo },
      { label: 'Address', value: subscriber.address },
      { label: 'Contact No.', value: subscriber.phone },
    ],
    notes: ['A positive balance is the amount due. A negative balance is advance credit that will be applied to future invoices.'],
  };
};

// ------------------------------------------------------------------ Collectors
const collectorAssignments: Builder = async (db) => {
  const data = await rows<Row>(
    db,
    sql`select c.full_name as collector, a.name as area, ca.assigned_from as "assignedFrom",
          (select count(*) from subscribers s where s.collector_id = c.id and s.collection_area_id = a.id and s.status = 'ACTIVE') as subscribers,
          (select coalesce(sum(i.balance), 0)::bigint from invoices i join subscribers s on s.id = i.subscriber_id
            where s.collector_id = c.id and s.collection_area_id = a.id and i.status in ${OPEN}) as outstanding
        from collector_assignments ca join collectors c on c.id = ca.collector_id join collection_areas a on a.id = ca.area_id
       where ca.is_active order by 1, 2`,
  );
  const columns = [col('collector', 'Collector', 'text', 2), col('area', 'Collection Area', 'text', 2), col('assignedFrom', 'Assigned Since', 'date'), col('subscribers', 'Subscribers', 'int'), col('outstanding', 'Outstanding Receivable', 'money')];
  return { subtitle: `Collector assignments as of ${formatDate(today())}`, columns, rows: data, totals: totalsOf(data, columns) };
};

async function batchesIn(db: DbOrTx, p: Params): Promise<(BatchRow & { varianceReason: string | null })[]> {
  return rows(
    db,
    sql`select t.*, x.variance_reason as "varianceReason" from (${batchSelect}) t join collection_batches x on x.id = t.id
        ${where(sql`t."collectionDate" between ${p.from} and ${p.to}`, p.collectorId && sql`t."collectorId" = ${p.collectorId}`, p.areaId && sql`t."areaId" = ${p.areaId}`)}
        order by t."collectionDate", t.id`,
  );
}

const collectorPerformance: Builder = async (db, p) => {
  const byCollector = new Map<string, { collector: string; batches: number; expected: number; cash: number; nonCash: number; remitted: number; shortage: number; overage: number }>();
  for (const b of await batchesIn(db, p)) {
    const row = byCollector.get(b.collectorName) ?? { collector: b.collectorName, batches: 0, expected: 0, cash: 0, nonCash: 0, remitted: 0, shortage: 0, overage: 0 };
    row.batches++;
    row.expected += b.expectedTotal;
    row.cash += b.cashCollected;
    row.nonCash += b.nonCashCollected;
    row.remitted += b.cashRemitted;
    if (b.varianceType === 'SHORTAGE') row.shortage += -b.difference;
    if (b.varianceType === 'OVERAGE') row.overage += b.difference;
    byCollector.set(b.collectorName, row);
  }
  const data = [...byCollector.values()].map((r) => ({ ...r, efficiency: pct(r.cash + r.nonCash, r.expected) }));
  const columns = [
    col('collector', 'Collector', 'text', 2),
    col('batches', 'Batches', 'int'),
    col('expected', 'Expected', 'money'),
    col('cash', 'Cash Collected', 'money'),
    col('nonCash', 'Non-cash Collected', 'money'),
    col('remitted', 'Cash Remitted', 'money'),
    col('shortage', 'Shortage', 'money'),
    col('overage', 'Overage', 'money'),
    col('efficiency', 'Collection Efficiency %', 'percent'),
  ];
  const totals = totalsOf(data, columns);
  return { subtitle: `Collector performance, batches dated ${range(p)}`, columns, rows: data, totals: { ...totals, efficiency: pct(Number(totals.cash) + Number(totals.nonCash), Number(totals.expected)) } };
};

const collectorRemittance: Builder = async (db, p) => {
  const data = (await batchesIn(db, p)).map((b) => ({
    batchNo: b.batchNo,
    collectionDate: b.collectionDate,
    collector: b.collectorName,
    area: b.areaName,
    status: statusLabel(b.status),
    expected: b.expectedTotal,
    cash: b.cashCollected,
    nonCash: b.nonCashCollected,
    remitted: b.cashRemitted,
    difference: b.difference,
    variance: b.varianceType ? statusLabel(b.varianceType) : 'Not reconciled',
    reason: b.varianceReason,
  }));
  const columns = [
    col('batchNo', 'Batch No.'),
    col('collectionDate', 'Date', 'date'),
    col('collector', 'Collector', 'text', 1.6),
    col('area', 'Area', 'text', 1.3),
    col('status', 'Status'),
    col('expected', 'Expected', 'money'),
    col('cash', 'Cash Collected', 'money'),
    col('nonCash', 'Non-cash', 'money'),
    col('remitted', 'Cash Remitted', 'money'),
    col('difference', 'Difference', 'money'),
    col('variance', 'Result'),
    col('reason', 'Variance Reason', 'text', 2),
  ];
  return { subtitle: `Collector remittance and shortage/overage, ${range(p)}`, columns, rows: data, totals: totalsOf(data, columns), notes: ['Difference = cash remitted - cash collected. A negative difference is a shortage.'] };
};

// ------------------------------------------------------------------ Audit & control
const localDate = (expr: string) => sql`(${sql.raw(expr)} at time zone ${config.timeZone})::date`;

const reversals: Builder = async (db, p) => {
  const data = await rows<Row>(
    db,
    sql`select pr.reversal_no as "reversalNo", ${localDate('pr.reversed_at')}::text as "reversedOn", r.receipt_no as "receiptNo", p.payment_date as "paymentDate",
          s.full_name as subscriber, p.method::text as method, p.amount, pr.reason, u.full_name as "reversedBy"
        from payment_reversals pr
        join payments p on p.id = pr.payment_id
        join receipts r on r.payment_id = p.id
        join subscribers s on s.id = p.subscriber_id
        left join users u on u.id = pr.reversed_by
       where ${localDate('pr.reversed_at')} between ${p.from} and ${p.to} order by pr.id`,
  );
  const out = data.map((r) => ({ ...r, method: PAYMENT_METHOD_LABELS[r.method as PaymentMethod] }));
  const columns = [
    col('reversalNo', 'Reversal No.'),
    col('reversedOn', 'Reversed On', 'date'),
    col('receiptNo', 'Voided Receipt'),
    col('paymentDate', 'Payment Date', 'date'),
    col('subscriber', 'Subscriber', 'text', 2),
    col('method', 'Method'),
    col('amount', 'Amount', 'money'),
    col('reason', 'Reason', 'text', 2.5),
    col('reversedBy', 'Reversed By', 'text', 1.4),
  ];
  return { subtitle: `Payment reversals and voided receipts, ${range(p)}`, columns, rows: out, totals: totalsOf(out, columns), notes: ['Voided receipt numbers stay reserved and are never issued again.'] };
};

const adjustmentsReport: Builder = async (db, p) => {
  const data = await rows<Row>(
    db,
    sql`select a.adjustment_no as "adjustmentNo", ${localDate('a.created_at')}::text as "postedOn", i.invoice_no as "invoiceNo", s.full_name as subscriber,
          initcap(a.type::text) as type, case when a.type = 'DEBIT' then a.amount else 0 end as debit, case when a.type = 'CREDIT' then a.amount else 0 end as credit,
          a.reason, u.full_name as "postedBy"
        from adjustments a join invoices i on i.id = a.invoice_id join subscribers s on s.id = a.subscriber_id left join users u on u.id = a.created_by
       where ${localDate('a.created_at')} between ${p.from} and ${p.to} order by a.id`,
  );
  const columns = [
    col('adjustmentNo', 'Adjustment No.'),
    col('postedOn', 'Posted On', 'date'),
    col('invoiceNo', 'Invoice'),
    col('subscriber', 'Subscriber', 'text', 2),
    col('type', 'Type'),
    col('debit', 'Debit', 'money'),
    col('credit', 'Credit', 'money'),
    col('reason', 'Reason', 'text', 2.5),
    col('postedBy', 'Posted By', 'text', 1.4),
  ];
  return { subtitle: `Invoice adjustments, ${range(p)}`, columns, rows: data, totals: totalsOf(data, columns) };
};

const userActivity: Builder = async (db, p) => {
  const data = await rows<Row>(
    db,
    sql`select coalesce(actor_username, '(system)') as username, action, count(*) as events,
          to_char(max(at) at time zone ${config.timeZone}, 'YYYY-MM-DD HH24:MI') as "lastAt"
        from audit_logs where ${localDate('at')} between ${p.from} and ${p.to} group by 1, 2 order by 1, 3 desc`,
  );
  const columns = [col('username', 'User', 'text', 1.5), col('action', 'Action', 'text', 2.5), col('events', 'Events', 'int'), col('lastAt', 'Last Activity', 'text', 1.5)];
  return { subtitle: `User activity summary, ${range(p)}`, columns, rows: data, totals: totalsOf(data, columns) };
};

const auditTrail: Builder = async (db, p) => {
  const data = await rows<Row>(
    db,
    sql`select to_char(at at time zone ${config.timeZone}, 'YYYY-MM-DD HH24:MI:SS') as at, coalesce(actor_username, '(system)') as username, action,
          entity_type || coalesce(' #' || entity_id, '') as entity, reason, ip
        from audit_logs where ${localDate('at')} between ${p.from} and ${p.to} order by id desc limit 5000`,
  );
  const columns = [col('at', 'Date / Time', 'text', 1.6), col('username', 'User', 'text', 1.2), col('action', 'Action', 'text', 2), col('entity', 'Record', 'text', 1.6), col('reason', 'Reason', 'text', 3), col('ip', 'Client IP', 'text', 1.2)];
  return { subtitle: `Audit trail, ${range(p)}`, columns, rows: data, totals: null, notes: ['Most recent first; limited to 5,000 entries.'] };
};

// ------------------------------------------------------------------ Catalog
export const REPORTS: (ReportDefinition & { build: Builder })[] = [
  { key: 'collections', title: 'Collection Report', category: 'Collections', description: 'Daily, weekly, monthly or annual collections broken down by payment method.', params: ['from', 'to', 'groupBy'], landscape: true, build: collections },
  { key: 'payment-methods', title: 'Payment Method Summary', category: 'Collections', description: 'Cash, GCash and other payment methods with share of total.', params: ['from', 'to'], build: paymentMethods },
  { key: 'payment-register', title: 'Payment Register', category: 'Collections', description: 'Every receipt issued in the period, including voided receipts.', params: ['from', 'to', 'collectorId'], landscape: true, build: paymentRegister },
  { key: 'billing-vs-collection', title: 'Billing vs Collection', category: 'Billing & Revenue', description: 'Monthly billed amount against collections with the collection rate.', params: ['year'], build: billingVsCollection },
  { key: 'revenue', title: 'Revenue by Plan / Service / Area', category: 'Billing & Revenue', description: 'Billed revenue, collected and outstanding grouped by plan, service type or collection area.', params: ['from', 'to', 'dimension'], build: revenue },
  { key: 'ar-aging', title: 'Accounts Receivable Aging', category: 'Receivables', description: 'Open balances per subscriber in Current, 1-30, 31-60, 61-90 and 90+ day buckets.', params: ['areaId', 'collectorId'], landscape: true, build: arAging },
  { key: 'overdue', title: 'Overdue Accounts', category: 'Receivables', description: 'Service accounts with past-due invoices, months unpaid and total arrears.', params: ['areaId', 'collectorId'], landscape: true, build: overdue },
  { key: 'subscriber-master', title: 'Subscriber Master List', category: 'Subscribers', description: 'All subscribers with contact, area, collector, status and balance.', params: ['areaId', 'collectorId'], landscape: true, build: subscriberMaster },
  { key: 'subscriber-soa', title: 'Statement of Account', category: 'Subscribers', description: 'Subscriber ledger with running balance for a date range.', params: ['subscriberId', 'from', 'to'], build: subscriberSoa },
  { key: 'collector-assignments', title: 'Collector Assignments', category: 'Collectors', description: 'Areas, subscribers and outstanding receivable assigned to each collector.', params: [], build: collectorAssignments },
  { key: 'collector-performance', title: 'Collector Performance', category: 'Collectors', description: 'Expected versus collected, remitted cash, shortage/overage and efficiency per collector.', params: ['from', 'to', 'collectorId'], landscape: true, build: collectorPerformance },
  { key: 'collector-remittance', title: 'Collector Remittance & Shortage/Overage', category: 'Collectors', description: 'Batch-level remittance with the reconciled difference and its recorded reason.', params: ['from', 'to', 'collectorId', 'areaId'], landscape: true, build: collectorRemittance },
  { key: 'reversals', title: 'Payment Reversals & Voided Receipts', category: 'Audit & Control', description: 'Reversed payments with voided receipt numbers, reason and approver.', params: ['from', 'to'], landscape: true, build: reversals },
  { key: 'adjustments', title: 'Invoice Adjustments', category: 'Audit & Control', description: 'Debit and credit adjustments posted to finalized invoices.', params: ['from', 'to'], landscape: true, build: adjustmentsReport },
  { key: 'user-activity', title: 'User Activity Summary', category: 'Audit & Control', description: 'Number of audited actions per user.', params: ['from', 'to'], build: userActivity },
  { key: 'audit-trail', title: 'Audit Trail', category: 'Audit & Control', description: 'Chronological record of audited actions.', params: ['from', 'to'], landscape: true, build: auditTrail },
];

export function defaultParams(query: ReportQuery): Params {
  const now = today();
  return { ...query, from: query.from ?? periodBounds(periodOf(now)).start, to: query.to ?? now, year: query.year ?? Number(now.slice(0, 4)) };
}
