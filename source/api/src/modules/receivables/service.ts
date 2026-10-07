import {
  addDays,
  emptyAging,
  overdueTotal,
  type AgingReport,
  type AgingRow,
  type AgingTotals,
  type ListQuery,
  type OutstandingRow,
  type OverdueRow,
  type Paged,
  type ReceivableSummary,
} from '@bcis/shared';
import { sql, type SQL } from 'drizzle-orm';
import { contains, one, paged, where, type DbOrTx } from '../../db/client';
import { today } from '../../lib/context';
import { getSettings } from '../../lib/settings';
import { OPEN } from '../../lib/sqlfrag';

/** Aging buckets as SQL sums over invoices aliased `i`. Mirrors agingBucket() in the shared domain. */
const agingSums = (asOf: string): SQL => sql`
  coalesce(sum(i.balance) filter (where i.due_date >= ${asOf}), 0)::bigint as "CURRENT",
  coalesce(sum(i.balance) filter (where ${asOf}::date - i.due_date between 1 and 30), 0)::bigint as "D1_30",
  coalesce(sum(i.balance) filter (where ${asOf}::date - i.due_date between 31 and 60), 0)::bigint as "D31_60",
  coalesce(sum(i.balance) filter (where ${asOf}::date - i.due_date between 61 and 90), 0)::bigint as "D61_90",
  coalesce(sum(i.balance) filter (where ${asOf}::date - i.due_date > 90), 0)::bigint as "D90_PLUS",
  coalesce(sum(i.balance), 0)::bigint as total`;

const bucketCase = (asOf: string, dueExpr: string): SQL => sql`
  case when ${asOf}::date - ${sql.raw(dueExpr)} <= 0 then 'CURRENT'
       when ${asOf}::date - ${sql.raw(dueExpr)} <= 30 then 'D1_30'
       when ${asOf}::date - ${sql.raw(dueExpr)} <= 60 then 'D31_60'
       when ${asOf}::date - ${sql.raw(dueExpr)} <= 90 then 'D61_90'
       else 'D90_PLUS' end`;

export async function agingTotals(db: DbOrTx, asOf = today()): Promise<AgingTotals> {
  const row = await one<AgingTotals>(db, sql`select ${agingSums(asOf)} from invoices i where i.status in ${OPEN} and i.balance > 0`);
  return row ?? emptyAging();
}

export async function getAging(db: DbOrTx, q: ListQuery): Promise<AgingReport> {
  const asOf = today();
  const term = q.q ? contains(q.q) : null;
  const filters = [
    sql`i.status in ${OPEN}`,
    sql`i.balance > 0`,
    term && sql`(s.full_name ilike ${term} or s.account_no ilike ${term})`,
    q.areaId && sql`s.collection_area_id = ${q.areaId}`,
    q.collectorId && sql`s.collector_id = ${q.collectorId}`,
  ];
  const base = sql`
    select s.id as "subscriberId", s.account_no as "accountNo", s.full_name as "fullName", ar.name as "areaName", c.full_name as "collectorName", ${agingSums(asOf)}
      from invoices i
      join subscribers s on s.id = i.subscriber_id
      left join collection_areas ar on ar.id = s.collection_area_id
      left join collectors c on c.id = s.collector_id
      ${where(...filters)}
     group by s.id, ar.name, c.full_name`;
  const [page, totals, outstanding] = await Promise.all([
    paged<AgingRow>(db, base, q, { accountNo: '"accountNo"', fullName: '"fullName"', total: 'total', CURRENT: '"CURRENT"', D1_30: '"D1_30"', D31_60: '"D31_60"', D61_90: '"D61_90"', D90_PLUS: '"D90_PLUS"' }, 'total desc, "subscriberId"'),
    one<AgingTotals>(db, sql`select ${agingSums(asOf)} from invoices i join subscribers s on s.id = i.subscriber_id ${where(...filters)}`),
    // Independent figure straight from the invoice table, used to prove the report reconciles.
    one<{ total: number }>(db, sql`select coalesce(sum(balance), 0)::bigint as total from invoices where status in ${OPEN}`),
  ]);
  return { ...page, asOf, totals: totals ?? emptyAging(), outstandingInvoiceTotal: outstanding?.total ?? 0 };
}

export async function listOutstanding(db: DbOrTx, q: ListQuery): Promise<Paged<OutstandingRow>> {
  const asOf = today();
  const term = q.q ? contains(q.q) : null;
  const base = sql`
    select s.id as "subscriberId", s.account_no as "accountNo", s.full_name as "fullName", s.phone, ar.name as "areaName", c.full_name as "collectorName",
           count(i.id) as "openInvoices",
           coalesce(sum(i.balance) filter (where i.due_date >= ${asOf}), 0)::bigint as "currentDue",
           coalesce(sum(i.balance) filter (where i.due_date < ${asOf}), 0)::bigint as overdue,
           sum(i.balance)::bigint as balance, min(i.due_date) as "oldestDueDate",
           (select max(p.payment_date) from payments p where p.subscriber_id = s.id and p.status = 'POSTED') as "lastPaymentDate"
      from invoices i
      join subscribers s on s.id = i.subscriber_id
      left join collection_areas ar on ar.id = s.collection_area_id
      left join collectors c on c.id = s.collector_id
      ${where(
        sql`i.status in ${OPEN}`,
        sql`i.balance > 0`,
        term && sql`(s.full_name ilike ${term} or s.account_no ilike ${term} or s.phone ilike ${term})`,
        q.areaId && sql`s.collection_area_id = ${q.areaId}`,
        q.collectorId && sql`s.collector_id = ${q.collectorId}`,
      )}
     group by s.id, ar.name, c.full_name`;
  return paged<OutstandingRow>(db, base, q, { accountNo: '"accountNo"', fullName: '"fullName"', balance: 'balance', overdue: 'overdue', currentDue: '"currentDue"', oldestDueDate: '"oldestDueDate"', openInvoices: '"openInvoices"' }, 'balance desc, "subscriberId"');
}

/**
 * Overdue receivables per service account. `cutoff` is the date an invoice must be due
 * before to count: today for the overdue list, today minus the grace period for suspension candidates.
 */
function overdueBase(q: ListQuery, asOf: string, cutoff: string, extra: SQL[] = []): SQL {
  const term = q.q ? contains(q.q) : null;
  return sql`
    select sa.id as "serviceAccountId", sa.account_no as "serviceAccountNo", sa.status as "serviceStatus", s.id as "subscriberId", s.account_no as "accountNo",
           s.full_name as "fullName", s.phone, p.name as "planName", st.code as "serviceType", ar.name as "areaName", c.full_name as "collectorName",
           od.months_unpaid as "monthsUnpaid", od.oldest_invoice_no as "oldestInvoiceNo", od.oldest_due as "oldestDueDate",
           (${asOf}::date - od.oldest_due) as "daysPastDue", ${bucketCase(asOf, 'od.oldest_due')} as bucket,
           (select max(py.payment_date) from payments py where py.subscriber_id = s.id and py.status = 'POSTED') as "lastPaymentDate",
           od.total_arrears as "totalArrears"
      from (
        select i.service_account_id, count(*) as months_unpaid, sum(i.balance)::bigint as total_arrears, min(i.due_date) as oldest_due,
               (array_agg(i.invoice_no order by i.due_date, i.id))[1] as oldest_invoice_no
          from invoices i where i.status in ${OPEN} and i.balance > 0 and i.due_date < ${cutoff}
         group by i.service_account_id
      ) od
      join service_accounts sa on sa.id = od.service_account_id
      join subscribers s on s.id = sa.subscriber_id
      join service_plans p on p.id = sa.plan_id
      join service_types st on st.id = p.service_type_id
      left join collection_areas ar on ar.id = s.collection_area_id
      left join collectors c on c.id = s.collector_id
      ${where(
        term && sql`(s.full_name ilike ${term} or s.account_no ilike ${term} or sa.account_no ilike ${term} or s.phone ilike ${term})`,
        q.areaId && sql`s.collection_area_id = ${q.areaId}`,
        q.collectorId && sql`s.collector_id = ${q.collectorId}`,
        q.planId && sql`sa.plan_id = ${q.planId}`,
        q.serviceType && sql`st.code = ${q.serviceType}`,
        q.bucket && sql`${bucketCase(asOf, 'od.oldest_due')} = ${q.bucket}`,
        ...extra,
      )}`;
}

const OVERDUE_SORT = { fullName: '"fullName"', accountNo: '"accountNo"', totalArrears: '"totalArrears"', daysPastDue: '"daysPastDue"', monthsUnpaid: '"monthsUnpaid"', oldestDueDate: '"oldestDueDate"', planName: '"planName"' };

export async function listOverdue(db: DbOrTx, q: ListQuery): Promise<Paged<OverdueRow>> {
  const asOf = today();
  return paged<OverdueRow>(db, overdueBase(q, asOf, asOf), q, OVERDUE_SORT, '"daysPastDue" desc, "serviceAccountId"');
}

/** Active accounts with at least `thresholdMonths` invoices unpaid beyond the grace period. */
export async function listSuspensionCandidates(db: DbOrTx, q: ListQuery): Promise<Paged<OverdueRow>> {
  const asOf = today();
  const settings = await getSettings(db);
  const cutoff = addDays(asOf, -Number(settings['suspension.graceDays']));
  const base = overdueBase(q, asOf, cutoff, [sql`sa.status = 'ACTIVE'`, sql`od.months_unpaid >= ${Number(settings['suspension.thresholdMonths'])}`]);
  return paged<OverdueRow>(db, base, q, OVERDUE_SORT, '"monthsUnpaid" desc, "daysPastDue" desc, "serviceAccountId"');
}

export async function getReceivableSummary(db: DbOrTx): Promise<ReceivableSummary> {
  const asOf = today();
  const settings = await getSettings(db);
  const [totals, counts, candidates] = await Promise.all([
    agingTotals(db, asOf),
    one<{ withBalance: number; overdue: number }>(
      db,
      sql`select count(distinct subscriber_id) as "withBalance", count(distinct subscriber_id) filter (where due_date < ${asOf}) as overdue
            from invoices where status in ${OPEN} and balance > 0`,
    ),
    listSuspensionCandidates(db, { page: 1, pageSize: 1 }),
  ]);
  return {
    asOf,
    currentReceivable: totals.CURRENT,
    overdueReceivable: overdueTotal(totals),
    totalReceivable: totals.total,
    subscribersWithBalance: counts?.withBalance ?? 0,
    subscribersOverdue: counts?.overdue ?? 0,
    suspensionCandidates: candidates.total,
    graceDays: Number(settings['suspension.graceDays']),
    thresholdMonths: Number(settings['suspension.thresholdMonths']),
  };
}
