import {
  addMonths,
  INVOICE_STATUSES,
  PAYMENT_METHOD_LABELS,
  periodLabel,
  periodOf,
  type BillingCycleRow,
  type BillingPreview,
  type BillingRunResult,
  type CurrentBilling,
  type InvoiceDetail,
  type InvoiceRow,
} from '@bcis/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, FilePlus2, Printer, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Money, PrintHeader, PrintPreview, ReasonDialog, statusOptions } from '../components/common';
import { DataTable, FilterSelect, type Column } from '../components/DataTable';
import { Button, Card, CardHeader, DescriptionList, Dialog, EmptyState, Field, MoneyInput, Notice, PageHeader, Select, SimpleTable, Spinner, Stat, StatusBadge, Textarea } from '../components/ui';
import { api, errorMessage, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { count, date, dateTime, peso, todayIso } from '../lib/format';

const periodChoices = () => Array.from({ length: 8 }, (_, i) => addMonths(periodOf(todayIso()), 1 - i));

// ---------------------------------------------------------------- Current billing
export function CurrentBillingPage() {
  const { can } = useAuth();
  const [period, setPeriod] = useState(periodOf(todayIso()));
  const { data } = useApi<CurrentBilling>('/billing/current', { period });
  const cycles = useApi<BillingCycleRow[]>('/billing/cycles').data ?? [];
  if (!data) return <Spinner />;
  const rate = data.totalBilled > 0 ? (data.totalCollected / data.totalBilled) * 100 : 0;
  return (
    <div className="space-y-3">
      <PageHeader
        title="Current Billing"
        description={`Billing status for ${periodLabel(data.period)}`}
        actions={
          <>
            <Select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Billing period" className="w-44">
              {periodChoices().map((p) => (
                <option key={p} value={p}>
                  {periodLabel(p)}
                </option>
              ))}
            </Select>
            {can('billing.generate') && (
              <Link to="/billing/generate">
                <Button variant="primary">
                  <FilePlus2 /> Generate Billing
                </Button>
              </Link>
            )}
          </>
        }
      />
      {data.unbilledAccounts > 0 && (
        <Notice tone="warning" title={`${count(data.unbilledAccounts)} active service account${data.unbilledAccounts === 1 ? ' has' : 's have'} no invoice for ${periodLabel(data.period)}`}>
          Run Generate Billing to create the missing invoices. Accounts that are already billed are skipped automatically.
        </Notice>
      )}
      {data.draftCount > 0 && <Notice tone="info" title={`${count(data.draftCount)} draft invoice${data.draftCount === 1 ? '' : 's'} waiting to be finalized`}>Drafts are not yet in the subscriber ledgers.</Notice>}
      <Card className="grid grid-cols-5 divide-x divide-line">
        {[
          <Stat label="Billable accounts" value={count(data.activeAccounts)} sub={`${count(data.billedAccounts)} billed`} />,
          <Stat label="Total billed" value={peso(data.totalBilled)} />,
          <Stat label="Collected on these invoices" value={peso(data.totalCollected)} sub={`${rate.toFixed(1)}% of billed`} tone="success" />,
          <Stat label="Still outstanding" value={peso(data.totalOutstanding)} tone={data.totalOutstanding > 0 ? 'warning' : undefined} />,
          <Stat label="Not yet billed" value={count(data.unbilledAccounts)} tone={data.unbilledAccounts > 0 ? 'danger' : undefined} />,
        ].map((stat, i) => (
          <div key={i} className="px-4 py-3">
            {stat}
          </div>
        ))}
      </Card>
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardHeader title="Invoices by status" description={periodLabel(data.period)} />
          <SimpleTable
            head={[{ label: 'Status' }, { label: 'Invoices', num: true }, { label: 'Amount', num: true }, { label: 'Balance', num: true }]}
            rows={data.byStatus.map((s) => [<StatusBadge status={s.status} />, count(s.count), <Money value={s.total} />, <Money value={s.balance} />])}
            empty="No invoices have been generated for this period."
          />
        </Card>
        <Card>
          <CardHeader title="Billing cycles" description="All periods that have been billed" />
          <SimpleTable
            head={[{ label: 'Period' }, { label: 'Invoices', num: true }, { label: 'Billed', num: true }, { label: 'Outstanding', num: true }, { label: 'Last run' }]}
            rows={cycles.map((c) => [periodLabel(c.period), `${count(c.invoiceCount)}${c.draftCount ? ` (+${c.draftCount} draft)` : ''}`, <Money value={c.totalBilled} />, <Money value={c.totalOutstanding} />, <span className="text-xs text-muted">{dateTime(c.lastGeneratedAt)}</span>])}
            empty="No billing runs yet."
          />
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Generate billing
export function GenerateBillingPage() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(periodOf(todayIso()));
  const [finalize, setFinalize] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<BillingRunResult | null>(null);
  const preview = useApi<BillingPreview>('/billing/preview', { period });
  const current = useApi<CurrentBilling>('/billing/current', { period }).data;

  const run = async (label: string, action: () => Promise<string>) => {
    setBusy(label);
    try {
      toast.success(await action());
      await queryClient.invalidateQueries();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const generate = () =>
    run('generate', async () => {
      const r = await api.post<BillingRunResult>('/billing/generate', { period, finalize });
      setResult(r);
      return `${count(r.created)} invoice${r.created === 1 ? '' : 's'} ${finalize ? 'generated and finalized' : 'created as drafts'} for ${periodLabel(period)}`;
    });

  const data = preview.data;
  return (
    <div className="space-y-3">
      <PageHeader title="Generate Billing" description="Creates one invoice per active service account for the selected month. Running it again never creates duplicates." />
      <Card>
        <div className="flex flex-wrap items-end gap-4 p-4">
          <Field label="Billing period" required className="w-52">
            <Select
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                setResult(null);
              }}
            >
              {periodChoices().map((p) => (
                <option key={p} value={p}>
                  {periodLabel(p)}
                </option>
              ))}
            </Select>
          </Field>
          <fieldset className="pb-1">
            <legend className="mb-1 text-xs font-medium text-slate-700">Mode</legend>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={finalize} onChange={() => setFinalize(true)} /> Generate and finalize
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={!finalize} onChange={() => setFinalize(false)} /> Create drafts for review
              </label>
            </div>
          </fieldset>
          <div className="ml-auto flex items-center gap-6">
            <Stat label="To be billed" value={data ? count(data.eligibleCount) : '…'} sub="service accounts" />
            <Stat label="Already billed" value={data ? count(data.alreadyBilledCount) : '…'} sub="will be skipped" />
            <Stat label="Amount to bill" value={data ? peso(data.totalAmount) : '…'} />
            <Button variant="primary" size="lg" onClick={() => void generate()} loading={busy === 'generate'} disabled={!data || data.eligibleCount === 0}>
              Generate {data ? count(data.eligibleCount) : ''} invoice{data?.eligibleCount === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      </Card>

      {result && (
        <Notice tone="success" title={`Billing run complete for ${periodLabel(result.period)}`}>
          {count(result.created)} created ({count(result.finalized)} finalized and posted to the ledger), {count(result.skippedAlreadyBilled)} skipped because they were already billed. Total billed {peso(result.totalBilled)}
          {result.creditApplied > 0 && `; ${peso(result.creditApplied)} of advance credit was applied automatically`}.
        </Notice>
      )}
      {current && current.draftCount > 0 && (
        <Notice tone="info" title={`${count(current.draftCount)} draft invoice${current.draftCount === 1 ? '' : 's'} for ${periodLabel(period)}`}>
          <p className="mb-2">Drafts have no invoice number and are not in the ledger until finalized.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" loading={busy === 'finalize'} onClick={() => void run('finalize', async () => `${(await api.post<{ finalized: number }>('/billing/finalize-drafts', { period })).finalized} draft(s) finalized`)}>
              Finalize drafts
            </Button>
            <Button size="sm" variant="danger-outline" loading={busy === 'discard'} onClick={() => void run('discard', async () => `${(await api.post<{ discarded: number }>('/billing/discard-drafts', { period })).discarded} draft(s) discarded`)}>
              Discard drafts
            </Button>
            <Link to={`/billing/invoices?status=DRAFT&period=${period}`}>
              <Button size="sm">Review drafts</Button>
            </Link>
          </div>
        </Notice>
      )}

      <Card className="flex min-h-0 flex-col">
        <CardHeader title="Preview" description={data ? `${count(data.rows.length)} of ${count(data.eligibleCount)} invoices shown` : undefined} />
        {!data && <Spinner />}
        {data && data.eligibleCount === 0 && <EmptyState title={`Nothing left to bill for ${periodLabel(period)}`} description="Every active service account already has an invoice for this period." />}
        {data && data.eligibleCount > 0 && (
          <SimpleTable
            head={[{ label: 'Service account' }, { label: 'Subscriber' }, { label: 'Line items' }, { label: 'Due date' }, { label: 'Total', num: true }]}
            rows={data.rows.map((r) => [
              r.serviceAccountNo,
              r.subscriberName,
              <span className="text-slate-600">{r.items.map((i) => `${i.description} ${peso(i.amount)}`).join(' · ')}</span>,
              date(r.dueDate),
              <Money value={r.total} />,
            ])}
            foot={['Total', '', '', '', <Money value={data.totalAmount} />]}
          />
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Invoice detail
function InvoiceSheet({ invoice }: { invoice: InvoiceDetail }) {
  return (
    <div>
      <PrintHeader title={invoice.status === 'VOID' ? 'Invoice (VOID)' : 'Invoice'} subtitle={`No. ${invoice.invoiceNo ?? 'DRAFT'}`} />
      <div className="mb-4 grid grid-cols-2 gap-x-8 gap-y-1">
        <p><span className="text-slate-500">Bill to: </span><strong>{invoice.subscriberName}</strong> ({invoice.subscriberAccountNo})</p>
        <p><span className="text-slate-500">Invoice date: </span>{date(invoice.invoiceDate)}</p>
        <p><span className="text-slate-500">Service address: </span>{invoice.address}</p>
        <p><span className="text-slate-500">Due date: </span><strong>{date(invoice.dueDate)}</strong></p>
        <p><span className="text-slate-500">Service account: </span>{invoice.serviceAccountNo} · {invoice.planName}</p>
        <p><span className="text-slate-500">Billing period: </span>{invoice.billingPeriod ? periodLabel(invoice.billingPeriod) : 'One-time charge'}</p>
      </div>
      <table>
        <thead>
          <tr><th>Description</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
        </thead>
        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id}><td>{item.description}</td><td className="num">{item.quantity}</td><td className="num">{peso(item.amount)}</td></tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={2}>Invoice total</td><td className="num">{peso(invoice.total)}</td></tr>
          {invoice.adjustmentsTotal !== 0 && <tr><td colSpan={2}>Adjustments</td><td className="num">{peso(invoice.adjustmentsTotal)}</td></tr>}
          <tr><td colSpan={2}>Payments applied</td><td className="num">{peso(-invoice.amountPaid)}</td></tr>
          <tr><td colSpan={2}>BALANCE DUE</td><td className="num text-sm">{peso(invoice.balance)}</td></tr>
        </tfoot>
      </table>
      <p className="mt-5 text-[10px] text-slate-500">Please pay on or before the due date at the office, through your assigned collector, or by GCash (send the proof to our Facebook Page).</p>
    </div>
  );
}

export function InvoiceDialog({ invoiceId, onClose }: { invoiceId: number | null; onClose: () => void }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const { data: invoice, error } = useApi<InvoiceDetail>(invoiceId ? `/invoices/${invoiceId}` : null);
  const [mode, setMode] = useState<'view' | 'void' | 'adjust' | 'print'>('view');
  const [adjType, setAdjType] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [adjAmount, setAdjAmount] = useState<number | undefined>();
  const [adjReason, setAdjReason] = useState('');
  const [busy, setBusy] = useState(false);
  const finalized = invoice && invoice.status !== 'DRAFT' && invoice.status !== 'VOID';

  if (mode === 'print' && invoice) {
    return (
      <PrintPreview title={`Invoice ${invoice.invoiceNo}`} fileName={`invoice-${invoice.invoiceNo}`} onClose={() => setMode('view')}>
        <InvoiceSheet invoice={invoice} />
      </PrintPreview>
    );
  }
  const postAdjustment = async () => {
    if (!invoice || !adjAmount) return;
    setBusy(true);
    try {
      await api.post('/adjustments', { invoiceId: invoice.id, type: adjType, amount: adjAmount, reason: adjReason.trim() });
      toast.success(`${adjType === 'CREDIT' ? 'Credit' : 'Debit'} adjustment posted to ${invoice.invoiceNo}`);
      setMode('view');
      setAdjAmount(undefined);
      setAdjReason('');
      await queryClient.invalidateQueries();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog
        open={invoiceId !== null && mode !== 'void'}
        onOpenChange={(open) => {
          if (!open) {
            setMode('view');
            onClose();
          }
        }}
        title={invoice ? `Invoice ${invoice.invoiceNo ?? '(draft)'}` : 'Invoice'}
        description={invoice ? `${invoice.subscriberName} · ${invoice.serviceAccountNo} · ${invoice.planName}` : undefined}
        size="lg"
        footer={
          invoice && (
            <>
              <div className="mr-auto flex gap-2">
                {finalized && can('invoice.void') && (
                  <Button variant="danger-outline" onClick={() => setMode('void')}>
                    <Ban /> Void
                  </Button>
                )}
                {finalized && can('adjustment.create') && (
                  <Button onClick={() => setMode(mode === 'adjust' ? 'view' : 'adjust')}>
                    <SlidersHorizontal /> Adjustment
                  </Button>
                )}
              </div>
              {invoice.status !== 'DRAFT' && (
                <Button onClick={() => setMode('print')}>
                  <Printer /> Print
                </Button>
              )}
              <Button variant="primary" onClick={onClose}>
                Close
              </Button>
            </>
          )
        }
      >
        {error && <EmptyState title="The invoice could not be loaded" description={error.message} />}
        {!invoice && !error && <Spinner />}
        {invoice && (
          <div className="space-y-4">
            {invoice.status === 'VOID' && <Notice tone="danger" title="This invoice is void">{invoice.voidReason} · {dateTime(invoice.voidedAt)}</Notice>}
            {invoice.status === 'DRAFT' && <Notice tone="info">Draft: not yet numbered or posted to the ledger. Finalize it from Generate Billing.</Notice>}
            <DescriptionList
              columns={3}
              items={[
                ['Status', <span className="flex items-center gap-1.5"><StatusBadge status={invoice.status} />{invoice.daysPastDue > 0 && <span className="text-xs text-danger">{invoice.daysPastDue} days past due</span>}</span>],
                ['Billing period', invoice.billingPeriod ? periodLabel(invoice.billingPeriod) : 'One-time charge'],
                ['Due date', date(invoice.dueDate)],
                ['Invoice total', peso(invoice.total)],
                ['Paid', peso(invoice.amountPaid)],
                ['Balance', <span className="text-base font-semibold">{peso(invoice.balance)}</span>],
              ]}
            />
            <div className="rounded-md border border-line">
              <SimpleTable
                head={[{ label: 'Line item' }, { label: 'Qty', num: true }, { label: 'Unit', num: true }, { label: 'Amount', num: true }]}
                rows={invoice.items.map((i) => [i.description, i.quantity, <Money value={i.unitAmount} />, <Money value={i.amount} />])}
                foot={['Total', '', '', <Money value={invoice.total} />]}
              />
            </div>
            {mode === 'adjust' && (
              <div className="rounded-md border border-accent/40 bg-accent-50/50 p-3">
                <p className="mb-2 text-sm font-medium">Post an adjustment</p>
                <div className="grid grid-cols-4 gap-3">
                  <Field label="Type" required>
                    <Select value={adjType} onChange={(e) => setAdjType(e.target.value as 'CREDIT' | 'DEBIT')}>
                      <option value="CREDIT">Credit (reduce balance)</option>
                      <option value="DEBIT">Debit (add charge)</option>
                    </Select>
                  </Field>
                  <Field label="Amount" required>
                    <MoneyInput value={adjAmount} onChange={setAdjAmount} />
                  </Field>
                  <Field label="Reason" required className="col-span-2">
                    <Textarea rows={1} value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
                  </Field>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-xs text-muted">The invoice lines stay unchanged; the adjustment is a separate ledger entry recorded in the audit trail.</p>
                  <Button variant="primary" size="sm" loading={busy} disabled={!adjAmount || adjReason.trim().length < 5} onClick={() => void postAdjustment()}>
                    Post adjustment
                  </Button>
                </div>
              </div>
            )}
            {invoice.adjustments.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Adjustments</p>
                <div className="rounded-md border border-line">
                  <SimpleTable
                    head={[{ label: 'No.' }, { label: 'Type' }, { label: 'Reason' }, { label: 'By' }, { label: 'Amount', num: true }]}
                    rows={invoice.adjustments.map((a) => [a.adjustmentNo, a.type === 'CREDIT' ? 'Credit' : 'Debit', a.reason, <span className="text-xs text-muted">{a.createdByName} · {dateTime(a.createdAt)}</span>, <Money value={a.type === 'CREDIT' ? -a.amount : a.amount} />])}
                  />
                </div>
              </div>
            )}
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Payments applied</p>
              <div className="rounded-md border border-line">
                <SimpleTable
                  head={[{ label: 'Receipt' }, { label: 'Date' }, { label: 'Method' }, { label: 'Amount', num: true }]}
                  rows={invoice.allocations.map((a) => [
                    <>{a.receiptNo}{a.isReversed && <span className="ml-1.5"><StatusBadge status="REVERSED" /></span>}</>,
                    date(a.paymentDate),
                    `${PAYMENT_METHOD_LABELS[a.method]}${a.type === 'CREDIT' ? ' (advance credit)' : ''}`,
                    <Money value={a.amount} className={a.isReversed ? 'text-muted line-through' : undefined} />,
                  ])}
                  empty="No payments applied yet."
                />
              </div>
            </div>
          </div>
        )}
      </Dialog>
      {invoice && (
        <ReasonDialog
          open={mode === 'void'}
          onOpenChange={(open) => setMode(open ? 'void' : 'view')}
          title={`Void invoice ${invoice.invoiceNo}?`}
          description={`${peso(invoice.balance)} · ${invoice.subscriberName}`}
          confirmLabel="Void invoice"
          danger
          onConfirm={async (reason) => {
            await api.post(`/invoices/${invoice.id}/void`, { reason });
            toast.success(`Invoice ${invoice.invoiceNo} voided`);
            await queryClient.invalidateQueries();
          }}
        >
          <Notice tone="warning">The invoice stays in history marked VOID and an offsetting ledger entry is posted. An invoice with payments applied cannot be voided until those payments are reversed.</Notice>
        </ReasonDialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Invoices list
export const invoiceColumns: Column<InvoiceRow>[] = [
  { accessorKey: 'invoiceNo', header: 'Invoice No.', cell: (c) => <span className="font-medium text-accent">{c.row.original.invoiceNo ?? '(draft)'}</span> },
  { accessorKey: 'subscriberName', header: 'Subscriber', cell: (c) => <>{c.row.original.subscriberName} <span className="text-xs text-muted">{c.row.original.subscriberAccountNo}</span></> },
  { id: 'service', header: 'Service', enableSorting: false, cell: (c) => <span className="text-slate-600">{c.row.original.planName}</span>, csv: (r) => r.planName },
  { accessorKey: 'billingPeriod', header: 'Period', cell: (c) => (c.row.original.billingPeriod ? periodLabel(c.row.original.billingPeriod) : 'One-time') },
  { accessorKey: 'dueDate', header: 'Due date', cell: (c) => <span className={c.row.original.daysPastDue > 0 ? 'whitespace-nowrap text-danger' : 'whitespace-nowrap'}>{date(c.row.original.dueDate)}{c.row.original.daysPastDue > 0 && ` · ${c.row.original.daysPastDue}d`}</span> },
  { accessorKey: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.row.original.status} /> },
  { accessorKey: 'total', header: 'Total', num: true, cell: (c) => <Money value={c.row.original.total + c.row.original.adjustmentsTotal} />, csv: (r) => ((r.total + r.adjustmentsTotal) / 100).toFixed(2) },
  { id: 'paid', header: 'Paid', num: true, enableSorting: false, cell: (c) => <Money value={c.row.original.amountPaid} zeroDash />, csv: (r) => (r.amountPaid / 100).toFixed(2) },
  { accessorKey: 'balance', header: 'Balance', num: true, cell: (c) => <Money value={c.row.original.balance} zeroDash className="font-medium" />, csv: (r) => (r.balance / 100).toFixed(2) },
];

export function InvoicesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [period, setPeriod] = useState(searchParams.get('period') ?? '');
  const openId = Number(searchParams.get('open')) || null;
  return (
    <>
      <PageHeader title="Invoices" description="Finalized invoices are immutable; corrections are made by adjustment or void." />
      <DataTable<InvoiceRow>
        endpoint="/invoices"
        columns={invoiceColumns}
        params={{ status, period }}
        searchPlaceholder="Invoice no., subscriber, account…"
        exportName="invoices"
        onRowClick={(row) => setSearchParams({ open: String(row.id) })}
        filters={
          <>
            <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'OPEN', label: 'All open (with balance)' }, { value: 'PAST_DUE', label: 'Past due' }, ...statusOptions(INVOICE_STATUSES)]} />
            <FilterSelect label="Period" value={period} onChange={setPeriod} options={periodChoices().map((p) => ({ value: p, label: periodLabel(p) }))} />
          </>
        }
      />
      <InvoiceDialog invoiceId={openId} onClose={() => setSearchParams({})} />
    </>
  );
}

