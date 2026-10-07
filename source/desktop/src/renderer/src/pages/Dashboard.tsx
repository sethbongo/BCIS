import { AGING_BUCKET_LABELS, AGING_BUCKETS, PAYMENT_METHOD_LABELS, periodLabel, type DashboardData } from '@bcis/shared';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { BarList, GroupedColumns } from '../components/charts';
import { Money } from '../components/common';
import { Card, CardHeader, cn, EmptyState, PageHeader, SimpleTable, Spinner, StatusBadge } from '../components/ui';
import { useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { compactPeso, count, date, peso } from '../lib/format';

const RAMP = ['bg-ramp-1', 'bg-ramp-2', 'bg-ramp-3', 'bg-ramp-4', 'bg-ramp-5'];

function Kpi({ label, value, detail, to, alert }: { label: string; value: string; detail: string; to?: string; alert?: boolean }) {
  const body = (
    <div className={cn('h-full rounded-lg border bg-surface px-4 py-3', alert ? 'border-red-200' : 'border-line', to && 'transition-colors hover:border-accent')}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
        {alert && <AlertTriangle className="size-3.5 text-danger" aria-label="Needs attention" />}
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold leading-7 text-ink">{value}</p>
      <p className="truncate text-xs text-muted">{detail}</p>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data, error } = useApi<DashboardData>('/dashboard', undefined, { refetchInterval: 60_000 });
  if (error) return <EmptyState title="The dashboard could not be loaded" description={error.message} />;
  if (!data) return <Spinner />;
  const k = data.kpis;
  const rate = k.billedThisMonth > 0 ? (k.collectedThisMonth / k.billedThisMonth) * 100 : 0;

  return (
    <div className="space-y-3">
      <PageHeader title="Dashboard" description={`${periodLabel(data.period)} · as of ${date(data.asOf)}`} />

      <div className="grid grid-cols-6 gap-3">
        <Kpi label="Current receivable" value={compactPeso(k.currentReceivable)} detail="Open invoices not yet due" to="/receivables/outstanding" />
        <Kpi label="Overdue receivable" value={compactPeso(k.overdueReceivable)} detail={`${count(k.subscribersOverdue)} subscribers past due`} to="/receivables/overdue" alert={k.overdueReceivable > 0} />
        <Kpi label="Billed this month" value={compactPeso(k.billedThisMonth)} detail={`${count(k.activeServiceAccounts)} active service accounts`} to="/billing/current" />
        <Kpi label="Collected this month" value={compactPeso(k.collectedThisMonth)} detail={`${rate.toFixed(1)}% of billed · today ${peso(k.collectedToday)}`} to="/payments/history" />
        <Kpi label="For follow-up / suspension" value={count(k.suspensionCandidates)} detail="Accounts past the suspension threshold" to="/receivables/suspension" alert={k.suspensionCandidates > 0} />
        <Kpi label="GCash awaiting verification" value={count(k.pendingGcash)} detail={`${count(k.activeSubscribers)} active subscribers`} to="/payments/gcash" alert={k.pendingGcash > 0} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="col-span-2">
          <CardHeader title="Billing vs collection" description="Amount billed for each month against payments received in that month" />
          <div className="px-4 py-3">
            <GroupedColumns seriesA="Billed" seriesB="Collected" data={data.billingVsCollection.map((m) => ({ label: periodLabel(m.period).replace(/(\w{3})\w* (\d{4})/, '$1 $2'), a: m.billed, b: m.collected }))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="AR aging" description={`Open balances by days past due · total ${peso(data.aging.total)}`} />
          <div className="px-4 py-3">
            <BarList
              items={AGING_BUCKETS.map((bucket, i) => ({
                label: AGING_BUCKET_LABELS[bucket],
                value: data.aging[bucket],
                color: RAMP[i],
                note: data.aging.total ? `${((data.aging[bucket] / data.aging.total) * 100).toFixed(0)}%` : undefined,
              }))}
              emptyText="No open receivables."
            />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardHeader title="Payment methods" description={`Posted payments in ${periodLabel(data.period)}`} />
          <div className="px-4 py-3">
            <BarList items={data.paymentMethods.map((m) => ({ label: PAYMENT_METHOD_LABELS[m.method], value: m.amount, note: `${count(m.count)} payment${m.count === 1 ? '' : 's'}` }))} emptyText="No payments posted yet this month." />
          </div>
        </Card>
        <Card className="col-span-2">
          <CardHeader title="Collector performance" description={`Collections tagged to each collector in ${periodLabel(data.period)}`} />
          <SimpleTable
            head={[{ label: 'Collector' }, { label: 'Subscribers', num: true }, { label: 'Collected this month', num: true }, { label: 'Outstanding in route', num: true }, { label: 'Share collected', className: 'w-44' }]}
            rows={data.collectorPerformance.map((c) => {
              const base = c.collected + c.outstanding;
              const share = base > 0 ? (c.collected / base) * 100 : 0;
              return [
                c.collectorName,
                count(c.subscribers),
                <Money value={c.collected} />,
                <Money value={c.outstanding} />,
                <div className="flex items-center gap-2" title={`${share.toFixed(1)}% of collected + outstanding`}>
                  <div className="h-2 flex-1 rounded-r bg-slate-100">
                    <div className="h-2 rounded-r bg-series-1" style={{ width: `${share}%` }} />
                  </div>
                  <span className="num w-10 text-xs text-slate-600">{share.toFixed(0)}%</span>
                </div>,
              ];
            })}
            empty="No active collectors."
          />
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardHeader
            title="Overdue alerts"
            description="Longest overdue service accounts"
            actions={
              <Link to="/receivables/overdue" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                View all <ArrowRight className="size-3" />
              </Link>
            }
          />
          <SimpleTable
            head={[{ label: 'Subscriber' }, { label: 'Service' }, { label: 'Months', num: true }, { label: 'Days late', num: true }, { label: 'Arrears', num: true }]}
            rows={data.overdueAlerts.map((o) => [
              <button type="button" className="text-left font-medium text-accent hover:underline" onClick={() => navigate(`/subscribers/${o.subscriberId}`)}>
                {o.fullName}
              </button>,
              <span className="text-slate-600">{o.planName}</span>,
              o.monthsUnpaid,
              o.daysPastDue,
              <Money value={o.totalArrears} />,
            ])}
            empty="No overdue accounts."
          />
        </Card>
        <Card>
          <CardHeader
            title="Recent payments"
            actions={
              can('payment.view') && (
                <Link to="/payments/history" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                  View all <ArrowRight className="size-3" />
                </Link>
              )
            }
          />
          <SimpleTable
            head={[{ label: 'Receipt' }, { label: 'Subscriber' }, { label: 'Date' }, { label: 'Method' }, { label: 'Amount', num: true }]}
            rows={data.recentPayments.map((p) => [
              <span className="whitespace-nowrap">
                {p.receiptNo} {p.status === 'REVERSED' && <StatusBadge status="REVERSED" />}
              </span>,
              p.subscriberName,
              <span className="whitespace-nowrap">{date(p.paymentDate)}</span>,
              PAYMENT_METHOD_LABELS[p.method],
              <Money value={p.amount} className={p.status === 'REVERSED' ? 'text-muted line-through' : undefined} />,
            ])}
            empty="No payments yet."
          />
        </Card>
      </div>
    </div>
  );
}
