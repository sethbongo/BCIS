import { AGING_BUCKET_LABELS, AGING_BUCKETS, SERVICE_TYPE_CODES, type AgingReport, type AgingRow, type OutstandingRow, type OverdueRow, type Paged, type ReceivableSummary } from '@bcis/shared';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Money, statusOptions, useLookups } from '../components/common';
import { DataTable, FilterSelect, type Column } from '../components/DataTable';
import { Button, Card, cn, PageHeader, Stat, StatusBadge } from '../components/ui';
import { useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { count, date, peso } from '../lib/format';
import { ServiceActionDialogs, type ServiceAction } from './ServiceAccounts';

const csvMoney = (value: number) => (value / 100).toFixed(2);
const RAMP = ['bg-ramp-1', 'bg-ramp-2', 'bg-ramp-3', 'bg-ramp-4', 'bg-ramp-5'];

function SummaryStrip() {
  const { data } = useApi<ReceivableSummary>('/receivables/summary');
  if (!data) return null;
  return (
    <Card className="mb-3 grid grid-cols-5 divide-x divide-line">
      <div className="px-4 py-2.5"><Stat label="Total receivable" value={peso(data.totalReceivable)} sub={`as of ${date(data.asOf)}`} /></div>
      <div className="px-4 py-2.5"><Stat label="Current (not yet due)" value={peso(data.currentReceivable)} /></div>
      <div className="px-4 py-2.5"><Stat label="Overdue" value={peso(data.overdueReceivable)} tone={data.overdueReceivable > 0 ? 'danger' : undefined} /></div>
      <div className="px-4 py-2.5"><Stat label="Subscribers overdue" value={count(data.subscribersOverdue)} sub={`${count(data.subscribersWithBalance)} with a balance`} /></div>
      <div className="px-4 py-2.5"><Stat label="Suspension candidates" value={count(data.suspensionCandidates)} sub={`${data.thresholdMonths}+ months unpaid past ${data.graceDays}-day grace`} tone={data.suspensionCandidates > 0 ? 'warning' : undefined} /></div>
    </Card>
  );
}

function useAreaCollectorFilters() {
  const { areas, collectors } = useLookups();
  const [areaId, setAreaId] = useState('');
  const [collectorId, setCollectorId] = useState('');
  return {
    params: { areaId, collectorId },
    controls: (
      <>
        <FilterSelect label="Area" value={areaId} onChange={setAreaId} options={areas.map((a) => ({ value: a.id, label: a.name }))} />
        <FilterSelect label="Collector" value={collectorId} onChange={setCollectorId} options={collectors.map((c) => ({ value: c.id, label: c.fullName }))} />
      </>
    ),
  };
}

// ---------------------------------------------------------------- Outstanding
const outstandingColumns: Column<OutstandingRow>[] = [
  { accessorKey: 'accountNo', header: 'Account No.', cell: (c) => <span className="font-medium text-accent">{c.row.original.accountNo}</span> },
  { accessorKey: 'fullName', header: 'Subscriber' },
  { accessorKey: 'phone', header: 'Contact No.', enableSorting: false },
  { accessorKey: 'areaName', header: 'Area', enableSorting: false },
  { accessorKey: 'collectorName', header: 'Collector', enableSorting: false },
  { accessorKey: 'openInvoices', header: 'Open invoices', num: true },
  { accessorKey: 'oldestDueDate', header: 'Oldest due', cell: (c) => <span className="whitespace-nowrap">{date(c.row.original.oldestDueDate)}</span> },
  { accessorKey: 'lastPaymentDate', header: 'Last payment', enableSorting: false, cell: (c) => <span className="whitespace-nowrap">{date(c.row.original.lastPaymentDate)}</span> },
  { accessorKey: 'currentDue', header: 'Current', num: true, cell: (c) => <Money value={c.row.original.currentDue} zeroDash />, csv: (r) => csvMoney(r.currentDue) },
  { accessorKey: 'overdue', header: 'Overdue', num: true, cell: (c) => <Money value={c.row.original.overdue} zeroDash className={c.row.original.overdue > 0 ? 'text-danger' : undefined} />, csv: (r) => csvMoney(r.overdue) },
  { accessorKey: 'balance', header: 'Total outstanding', num: true, cell: (c) => <Money value={c.row.original.balance} className="font-semibold" />, csv: (r) => csvMoney(r.balance) },
];

export function OutstandingPage() {
  const navigate = useNavigate();
  const filters = useAreaCollectorFilters();
  return (
    <>
      <PageHeader title="Outstanding Receivables" description="Subscribers with open invoice balances, current and overdue." />
      <SummaryStrip />
      <DataTable<OutstandingRow> endpoint="/receivables/outstanding" columns={outstandingColumns} params={filters.params} filters={filters.controls} searchPlaceholder="Subscriber, account, contact…" exportName="outstanding-receivables" onRowClick={(row) => navigate(`/subscribers/${row.subscriberId}?tab=ledger`)} />
    </>
  );
}

// ---------------------------------------------------------------- Overdue and suspension candidates
function overdueColumns(extra: Column<OverdueRow>[] = []): Column<OverdueRow>[] {
  return [
    { accessorKey: 'fullName', header: 'Subscriber', cell: (c) => <><span className="font-medium">{c.row.original.fullName}</span> <span className="text-xs text-muted">{c.row.original.accountNo}</span></> },
    { accessorKey: 'planName', header: 'Service', cell: (c) => <>{c.row.original.planName} <span className="text-xs text-muted">{c.row.original.serviceAccountNo}</span></>, csv: (r) => `${r.planName} (${r.serviceAccountNo})` },
    { id: 'area', header: 'Area', enableSorting: false, cell: (c) => c.row.original.areaName, csv: (r) => r.areaName },
    { id: 'collector', header: 'Collector', enableSorting: false, cell: (c) => c.row.original.collectorName, csv: (r) => r.collectorName },
    { accessorKey: 'monthsUnpaid', header: 'Months unpaid', num: true },
    { id: 'oldest', header: 'Oldest unpaid invoice', enableSorting: false, cell: (c) => <span className="whitespace-nowrap">{c.row.original.oldestInvoiceNo} · due {date(c.row.original.oldestDueDate)}</span>, csv: (r) => `${r.oldestInvoiceNo} due ${r.oldestDueDate}` },
    { accessorKey: 'daysPastDue', header: 'Days past due', num: true, cell: (c) => <span className={c.row.original.daysPastDue > 60 ? 'font-semibold text-danger' : undefined}>{c.row.original.daysPastDue}</span> },
    { id: 'age', header: 'Age', enableSorting: false, cell: (c) => <StatusBadge status={c.row.original.daysPastDue > 60 ? 'OVERDUE' : 'PENDING'} label={AGING_BUCKET_LABELS[c.row.original.bucket]} />, csv: (r) => AGING_BUCKET_LABELS[r.bucket] },
    { id: 'lastPayment', header: 'Last payment', enableSorting: false, cell: (c) => <span className="whitespace-nowrap">{date(c.row.original.lastPaymentDate)}</span>, csv: (r) => r.lastPaymentDate },
    { accessorKey: 'totalArrears', header: 'Total arrears', num: true, cell: (c) => <Money value={c.row.original.totalArrears} className="font-semibold" />, csv: (r) => csvMoney(r.totalArrears) },
    ...extra,
  ];
}

function OverdueFilters({ onChange, showBucket = true }: { onChange: (params: Record<string, string>) => void; showBucket?: boolean }) {
  const { areas, collectors, plans } = useLookups();
  const [state, setState] = useState({ areaId: '', collectorId: '', planId: '', serviceType: '', bucket: '' });
  const set = (key: keyof typeof state) => (value: string) => {
    const next = { ...state, [key]: value };
    setState(next);
    onChange(next);
  };
  return (
    <>
      <FilterSelect label="Collector" value={state.collectorId} onChange={set('collectorId')} options={collectors.map((c) => ({ value: c.id, label: c.fullName }))} />
      <FilterSelect label="Area" value={state.areaId} onChange={set('areaId')} options={areas.map((a) => ({ value: a.id, label: a.name }))} />
      <FilterSelect label="Plan" value={state.planId} onChange={set('planId')} options={plans.map((p) => ({ value: p.id, label: p.name }))} />
      <FilterSelect label="Service" value={state.serviceType} onChange={set('serviceType')} options={statusOptions(SERVICE_TYPE_CODES)} />
      {showBucket && <FilterSelect label="Delinquency age" value={state.bucket} onChange={set('bucket')} options={AGING_BUCKETS.filter((b) => b !== 'CURRENT').map((b) => ({ value: b, label: AGING_BUCKET_LABELS[b] }))} />}
    </>
  );
}

export function OverduePage() {
  const navigate = useNavigate();
  const [params, setParams] = useState<Record<string, string>>({});
  return (
    <>
      <PageHeader title="Overdue Accounts" description="Service accounts with invoices past their due date, oldest first." />
      <SummaryStrip />
      <DataTable<OverdueRow> endpoint="/receivables/overdue" columns={overdueColumns()} params={params} filters={<OverdueFilters onChange={setParams} />} searchPlaceholder="Subscriber, account, contact…" exportName="overdue-accounts" onRowClick={(row) => navigate(`/subscribers/${row.subscriberId}?tab=billing`)} />
    </>
  );
}

export function SuspensionCandidatesPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [params, setParams] = useState<Record<string, string>>({});
  const [action, setAction] = useState<ServiceAction>(null);
  const summary = useApi<ReceivableSummary>('/receivables/summary').data;
  const suspendColumn: Column<OverdueRow> = {
    id: 'actions',
    header: '',
    enableSorting: false,
    cell: (c) =>
      can('service.suspend') && (
        <Button
          size="sm"
          variant="danger-outline"
          onClick={(e) => {
            e.stopPropagation();
            const r = c.row.original;
            // Only the fields the suspend dialog shows are needed here.
            setAction({ kind: 'suspend', account: { id: r.serviceAccountId, accountNo: r.serviceAccountNo, subscriberName: r.fullName, planName: r.planName, balance: r.totalArrears } as never });
          }}
        >
          Suspend
        </Button>
      ),
  };
  return (
    <>
      <PageHeader
        title="Suspension Candidates"
        description={summary ? `Active accounts with at least ${summary.thresholdMonths} invoices unpaid more than ${summary.graceDays} days past due. Both values are set in Administration › Settings.` : 'Accounts that passed the grace period and suspension threshold.'}
      />
      <DataTable<OverdueRow>
        endpoint="/receivables/suspension-candidates"
        columns={overdueColumns([suspendColumn])}
        params={params}
        filters={<OverdueFilters onChange={setParams} showBucket={false} />}
        searchPlaceholder="Subscriber, account, contact…"
        exportName="suspension-candidates"
        emptyTitle="No accounts currently qualify for suspension"
        onRowClick={(row) => navigate(`/subscribers/${row.subscriberId}?tab=services`)}
      />
      <ServiceActionDialogs action={action} onClose={() => setAction(null)} />
    </>
  );
}

// ---------------------------------------------------------------- Aging
const agingColumns: Column<AgingRow>[] = [
  { accessorKey: 'accountNo', header: 'Account No.', cell: (c) => <span className="font-medium text-accent">{c.row.original.accountNo}</span> },
  { accessorKey: 'fullName', header: 'Subscriber' },
  { id: 'area', header: 'Area', enableSorting: false, cell: (c) => c.row.original.areaName, csv: (r) => r.areaName },
  { id: 'collector', header: 'Collector', enableSorting: false, cell: (c) => c.row.original.collectorName, csv: (r) => r.collectorName },
  ...AGING_BUCKETS.map(
    (bucket): Column<AgingRow> => ({
      accessorKey: bucket,
      header: AGING_BUCKET_LABELS[bucket],
      num: true,
      cell: (c) => <Money value={c.row.original[bucket]} zeroDash className={bucket === 'D90_PLUS' && c.row.original[bucket] > 0 ? 'text-danger' : undefined} />,
      csv: (r) => csvMoney(r[bucket]),
    }),
  ),
  { accessorKey: 'total', header: 'Total', num: true, cell: (c) => <Money value={c.row.original.total} className="font-semibold" />, csv: (r) => csvMoney(r.total) },
];

export function AgingPage() {
  const navigate = useNavigate();
  const filters = useAreaCollectorFilters();
  return (
    <>
      <PageHeader title="Accounts Receivable Aging" description="Open invoice balances grouped by days past the due date." />
      <DataTable<AgingRow>
        endpoint="/receivables/aging"
        columns={agingColumns}
        params={filters.params}
        filters={filters.controls}
        searchPlaceholder="Subscriber or account…"
        exportName="ar-aging"
        onRowClick={(row) => navigate(`/subscribers/${row.subscriberId}?tab=billing`)}
        summary={(data: Paged<AgingRow>) => {
          const report = data as AgingReport;
          const { totals } = report;
          const filtered = Boolean(filters.params.areaId || filters.params.collectorId);
          const reconciles = totals.total === report.outstandingInvoiceTotal;
          return (
            <div className="border-b border-line px-3 py-3">
              <div className="grid grid-cols-6 gap-3">
                {AGING_BUCKETS.map((bucket, i) => (
                  <div key={bucket}>
                    <p className="flex items-center gap-1.5 text-xs text-muted">
                      <span className={cn('size-2.5 rounded-sm', RAMP[i])} /> {AGING_BUCKET_LABELS[bucket]}
                    </p>
                    <p className="text-base font-semibold tabular-nums">{peso(totals[bucket])}</p>
                    <p className="text-xs text-muted">{totals.total ? ((totals[bucket] / totals.total) * 100).toFixed(1) : '0.0'}%</p>
                  </div>
                ))}
                <div>
                  <p className="text-xs text-muted">Total receivable</p>
                  <p className="text-base font-semibold tabular-nums">{peso(totals.total)}</p>
                  <p className="text-xs text-muted">as of {date(report.asOf)}</p>
                </div>
              </div>
              <div className="mt-2 flex h-2.5 gap-0.5 overflow-hidden rounded" role="img" aria-label="Share of receivables by aging bucket">
                {AGING_BUCKETS.map((bucket, i) => totals[bucket] > 0 && <div key={bucket} className={RAMP[i]} style={{ flexGrow: totals[bucket] }} title={`${AGING_BUCKET_LABELS[bucket]}: ${peso(totals[bucket])}`} />)}
              </div>
              {!filtered && (
                <p className={cn('mt-2 flex items-center gap-1.5 text-xs', reconciles ? 'text-success' : 'text-danger')}>
                  <CheckCircle2 className="size-3.5" />
                  {reconciles
                    ? `Reconciled: the aging total equals the sum of all open invoice balances (${peso(report.outstandingInvoiceTotal)}).`
                    : `Does not reconcile: open invoice balances total ${peso(report.outstandingInvoiceTotal)}. Run the integrity check in Administration.`}
                </p>
              )}
            </div>
          );
        }}
      />
    </>
  );
}

