import { addMonths, PAYMENT_METHODS, periodBounds, periodOf, type DashboardData, type PaymentMethod } from '@bcis/shared';
import { sql } from 'drizzle-orm';
import { one, rows, type DbOrTx } from '../../db/client';
import { today } from '../../lib/context';
import { OPEN } from '../../lib/sqlfrag';
import { listPayments } from '../payments/service';
import { getReceivableSummary, agingTotals, listOverdue } from '../receivables/service';

export async function getDashboard(db: DbOrTx): Promise<DashboardData> {
  const asOf = today();
  const period = periodOf(asOf);
  const month = periodBounds(period);
  const firstPeriod = addMonths(period, -5);

  const [summary, aging, month_, counts, trendBilled, trendCollected, methods, collectors, overdue, recent] = await Promise.all([
    getReceivableSummary(db),
    agingTotals(db, asOf),
    one<{ billed: number; collected: number; collectedToday: number }>(
      db,
      sql`select
            (select coalesce(sum(total + adjustments_total), 0)::bigint from invoices where billing_period = ${period} and status not in ('VOID','DRAFT')) as billed,
            (select coalesce(sum(amount), 0)::bigint from payments where status = 'POSTED' and payment_date between ${month.start} and ${month.end}) as collected,
            (select coalesce(sum(amount), 0)::bigint from payments where status = 'POSTED' and payment_date = ${asOf}) as "collectedToday"`,
    ),
    one<{ subscribers: number; accounts: number; pendingGcash: number }>(
      db,
      sql`select (select count(*) from subscribers where status = 'ACTIVE') as subscribers,
                 (select count(*) from service_accounts where status = 'ACTIVE') as accounts,
                 (select count(*) from payment_proofs where status = 'PENDING') as "pendingGcash"`,
    ),
    rows<{ period: string; amount: number }>(
      db,
      sql`select billing_period as period, sum(total + adjustments_total)::bigint as amount from invoices
           where billing_period >= ${firstPeriod} and billing_period <= ${period} and status not in ('VOID','DRAFT') group by 1`,
    ),
    rows<{ period: string; amount: number }>(
      db,
      sql`select to_char(payment_date, 'YYYY-MM') as period, sum(amount)::bigint as amount from payments
           where status = 'POSTED' and payment_date >= ${periodBounds(firstPeriod).start} and payment_date <= ${month.end} group by 1`,
    ),
    rows<{ method: PaymentMethod; count: number; amount: number }>(
      db,
      sql`select method, count(*) as count, sum(amount)::bigint as amount from payments
           where status = 'POSTED' and payment_date between ${month.start} and ${month.end} group by method`,
    ),
    rows<DashboardData['collectorPerformance'][number]>(
      db,
      sql`select c.id as "collectorId", c.full_name as "collectorName",
            (select count(*) from subscribers s where s.collector_id = c.id and s.status = 'ACTIVE') as subscribers,
            (select coalesce(sum(i.balance), 0)::bigint from invoices i join subscribers s on s.id = i.subscriber_id
              where s.collector_id = c.id and i.status in ${OPEN}) as outstanding,
            (select coalesce(sum(p.amount), 0)::bigint from payments p
              where p.collector_id = c.id and p.status = 'POSTED' and p.payment_date between ${month.start} and ${month.end}) as collected
          from collectors c where c.is_active order by c.full_name`,
    ),
    listOverdue(db, { page: 1, pageSize: 8 }),
    listPayments(db, { page: 1, pageSize: 8 }),
  ]);

  const billingVsCollection = Array.from({ length: 6 }, (_, i) => {
    const p = addMonths(firstPeriod, i);
    return { period: p, billed: trendBilled.find((r) => r.period === p)?.amount ?? 0, collected: trendCollected.find((r) => r.period === p)?.amount ?? 0 };
  });

  return {
    asOf,
    period,
    kpis: {
      currentReceivable: summary.currentReceivable,
      overdueReceivable: summary.overdueReceivable,
      subscribersOverdue: summary.subscribersOverdue,
      suspensionCandidates: summary.suspensionCandidates,
      billedThisMonth: month_?.billed ?? 0,
      collectedThisMonth: month_?.collected ?? 0,
      collectedToday: month_?.collectedToday ?? 0,
      activeSubscribers: counts?.subscribers ?? 0,
      activeServiceAccounts: counts?.accounts ?? 0,
      pendingGcash: counts?.pendingGcash ?? 0,
    },
    billingVsCollection,
    paymentMethods: PAYMENT_METHODS.map((method) => methods.find((m) => m.method === method) ?? { method, count: 0, amount: 0 }).filter((m) => m.count > 0),
    aging,
    collectorPerformance: collectors,
    overdueAlerts: overdue.rows,
    recentPayments: recent.rows,
  };
}
