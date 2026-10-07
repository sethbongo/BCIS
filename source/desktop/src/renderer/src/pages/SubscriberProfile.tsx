import { statusLabel, SUBSCRIBER_STATUSES, SubscriberInput, type AuditRow, type InvoiceRow, type LedgerResult, type Paged, type PaymentRow, type ProofRow, type ServiceAccountRow, type ServiceEventRow, type SubscriberDetail } from '@bcis/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileDown, Pencil, Plus, Printer, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Money, PrintHeader, PrintPreview } from '../components/common';
import { DataTable, type Column } from '../components/DataTable';
import { Button, Card, DescriptionList, Dialog, EmptyState, Field, Input, Notice, Select, SimpleTable, Spinner, Stat, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui';
import { api, handleError, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, dateTime, peso, todayIso } from '../lib/format';
import { InvoiceDialog, invoiceColumns } from './Billing';
import { PaymentDialog, paymentColumns } from './Payments';
import { AddServiceDialog, ServiceActionDialogs, ServiceActions, type ServiceAction } from './ServiceAccounts';
import { SubscriberFields } from './Subscribers';

function EditSubscriberDialog({ subscriber, open, onOpenChange }: { subscriber: SubscriberDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const primary = subscriber.addresses.find((a) => a.isPrimary) ?? subscriber.addresses[0];
  const form = useForm<SubscriberInput>({ resolver: zodResolver(SubscriberInput) });
  const [status, setStatus] = useState(subscriber.status);
  const [statusReason, setStatusReason] = useState('');
  useEffect(() => {
    if (!open) return;
    form.reset({
      firstName: subscriber.firstName,
      lastName: subscriber.lastName,
      phone: subscriber.phone,
      altPhone: subscriber.altPhone ?? '',
      email: subscriber.email ?? '',
      dueDay: subscriber.dueDay,
      collectionAreaId: subscriber.collectionAreaId,
      collectorId: subscriber.collectorId,
      routeSequence: subscriber.routeSequence,
      notes: subscriber.notes ?? '',
      // The address is managed separately; these values only satisfy the shared schema.
      address: { line1: primary?.line1 ?? '-', barangay: primary?.barangay ?? '-', city: primary?.city ?? '-', province: primary?.province ?? '-' },
    });
    setStatus(subscriber.status);
    setStatusReason('');
  }, [open, subscriber, primary, form]);

  const submit = form.handleSubmit(async ({ address: _address, ...values }) => {
    try {
      await api.patch(`/subscribers/${subscriber.id}`, { ...values, ...(status !== subscriber.status ? { status, statusReason } : {}) });
      toast.success('Subscriber updated');
      await queryClient.invalidateQueries();
      onOpenChange(false);
    } catch (err) {
      handleError(err, form.setError);
    }
  });
  const statusChanged = status !== subscriber.status;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${subscriber.fullName}`}
      description={subscriber.accountNo}
      size="lg"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={form.formState.isSubmitting} disabled={statusChanged && statusReason.trim().length < 3} onClick={() => void submit()}>
            Save changes
          </Button>
        </>
      }
    >
      <form className="space-y-5" onSubmit={submit} noValidate>
        <SubscriberFields form={form} />
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Account status</legend>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status" hint="Subscribers are never deleted; closed accounts stay on record.">
              <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                {SUBSCRIBER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </Select>
            </Field>
            {statusChanged && (
              <Field label="Reason for status change" required>
                <Input value={statusReason} onChange={(e) => setStatusReason(e.target.value)} />
              </Field>
            )}
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Ledger tab and Statement of Account
function LedgerTable({ ledger, print }: { ledger: LedgerResult; print?: boolean }) {
  const head = ['Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'];
  return (
    <table className={print ? undefined : 'w-full text-sm'}>
      <thead>
        <tr className={print ? undefined : 'border-b border-line bg-slate-50 text-left text-xs text-slate-600'}>
          {head.map((h, i) => (
            <th key={h} className={print ? undefined : 'px-3 py-2 font-medium'} style={i > 2 ? { textAlign: 'right' } : undefined}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ledger.from && (
          <tr className={print ? undefined : 'border-b border-line text-muted'}>
            <td className={print ? undefined : 'px-3 py-1.5'}>{date(ledger.from)}</td>
            <td />
            <td className={print ? undefined : 'px-3 py-1.5'}>Balance brought forward</td>
            <td />
            <td />
            <td className={print ? 'num' : 'num px-3 py-1.5'}>{peso(ledger.openingBalance)}</td>
          </tr>
        )}
        {ledger.rows.map((row) => (
          <tr key={row.id} className={print ? undefined : 'border-b border-line'}>
            <td className={print ? undefined : 'whitespace-nowrap px-3 py-1.5'}>{date(row.entryDate)}</td>
            <td className={print ? undefined : 'whitespace-nowrap px-3 py-1.5 font-medium'}>{row.referenceNo}</td>
            <td className={print ? undefined : 'px-3 py-1.5'}>{row.description}</td>
            <td className={print ? 'num' : 'num px-3 py-1.5'}>{row.debit ? peso(row.debit) : ''}</td>
            <td className={print ? 'num' : 'num px-3 py-1.5'}>{row.credit ? peso(row.credit) : ''}</td>
            <td className={print ? 'num' : 'num px-3 py-1.5 font-medium'}>{peso(row.balance)}</td>
          </tr>
        ))}
        {ledger.rows.length === 0 && (
          <tr>
            <td colSpan={6} className="px-3 py-6 text-center text-muted">
              No ledger entries in this date range.
            </td>
          </tr>
        )}
      </tbody>
      <tfoot>
        <tr className={print ? undefined : 'border-t border-line-strong bg-slate-50 font-semibold'}>
          <td colSpan={3} className={print ? undefined : 'px-3 py-2'}>
            Closing balance
          </td>
          <td className={print ? 'num' : 'num px-3 py-2'}>{peso(ledger.totalDebit)}</td>
          <td className={print ? 'num' : 'num px-3 py-2'}>{peso(ledger.totalCredit)}</td>
          <td className={print ? 'num' : 'num px-3 py-2'}>{peso(ledger.closingBalance)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function LedgerTab({ subscriber }: { subscriber: SubscriberDetail }) {
  const { can } = useAuth();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [printing, setPrinting] = useState(false);
  const { data: ledger } = useApi<LedgerResult>(`/subscribers/${subscriber.id}/ledger`, { from, to });
  const exportSoa = (format: 'pdf' | 'xlsx') => api.download('/reports/subscriber-soa', { subscriberId: subscriber.id, from: from || '2000-01-01', to: to || todayIso(), format });
  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </Field>
        {(from || to) && (
          <Button variant="ghost" onClick={() => { setFrom(''); setTo(''); }}>
            Show all
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button onClick={() => setPrinting(true)} disabled={!ledger}>
            <Printer /> Statement of Account
          </Button>
          {can('report.export') && (
            <>
              <Button onClick={() => void exportSoa('pdf')}>
                <FileDown /> PDF
              </Button>
              <Button onClick={() => void exportSoa('xlsx')}>
                <FileDown /> XLSX
              </Button>
            </>
          )}
        </div>
      </div>
      {!ledger ? <Spinner /> : <LedgerTable ledger={ledger} />}
      <p className="border-t border-line px-4 py-2 text-xs text-muted">The running balance is recomputed from the permanent debit and credit entries each time. A negative balance is advance credit.</p>
      {printing && ledger && (
        <PrintPreview title={`Statement of Account · ${subscriber.accountNo}`} fileName={`soa-${subscriber.accountNo}`} onClose={() => setPrinting(false)}>
          <PrintHeader title="Statement of Account" subtitle={`${ledger.from ? date(ledger.from) : 'Beginning'} to ${date(ledger.to ?? todayIso())}`} />
          <div className="mb-4 grid grid-cols-2 gap-x-8 gap-y-1">
            <p><span className="text-slate-500">Subscriber: </span><strong>{subscriber.fullName}</strong></p>
            <p><span className="text-slate-500">Account no.: </span>{subscriber.accountNo}</p>
            <p><span className="text-slate-500">Address: </span>{subscriber.address}</p>
            <p><span className="text-slate-500">Contact no.: </span>{subscriber.phone}</p>
          </div>
          <LedgerTable ledger={ledger} print />
          <p className="mt-4 text-sm font-semibold">
            {ledger.closingBalance > 0 ? `Amount due: ${peso(ledger.closingBalance)}` : ledger.closingBalance < 0 ? `Advance credit: ${peso(-ledger.closingBalance)}` : 'No amount due.'}
          </p>
          <p className="mt-1 text-[10px] text-slate-500">Printed {dateTime(new Date().toISOString())}. Please report any discrepancy to the office within 15 days.</p>
        </PrintPreview>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Profile page
const proofColumns: Column<ProofRow>[] = [
  { accessorKey: 'referenceNo', header: 'GCash reference', enableSorting: false },
  { accessorKey: 'transactionDate', header: 'Transaction date', enableSorting: false, cell: (c) => date(c.row.original.transactionDate) },
  { accessorKey: 'fileName', header: 'Proof file', enableSorting: false },
  { accessorKey: 'status', header: 'Status', enableSorting: false, cell: (c) => <StatusBadge status={c.row.original.status} /> },
  { id: 'reviewed', header: 'Reviewed by', enableSorting: false, cell: (c) => (c.row.original.reviewedByName ? `${c.row.original.reviewedByName} · ${dateTime(c.row.original.reviewedAt)}` : '—') },
  { accessorKey: 'receiptNo', header: 'Receipt', enableSorting: false },
  { accessorKey: 'amount', header: 'Amount', num: true, cell: (c) => <Money value={c.row.original.amount} /> },
];
const auditColumns: Column<AuditRow>[] = [
  { accessorKey: 'at', header: 'Date / time', cell: (c) => <span className="whitespace-nowrap">{dateTime(c.row.original.at)}</span> },
  { accessorKey: 'actorUsername', header: 'User' },
  { accessorKey: 'action', header: 'Action', cell: (c) => <span className="font-mono text-xs">{c.row.original.action}</span> },
  { id: 'record', header: 'Record', enableSorting: false, cell: (c) => `${c.row.original.entityType} #${c.row.original.entityId ?? ''}` },
  { accessorKey: 'reason', header: 'Reason', enableSorting: false },
];

const TABS = ['overview', 'services', 'billing', 'payments', 'ledger', 'collection', 'history', 'documents', 'audit'] as const;

export function SubscriberProfilePage() {
  const { id } = useParams();
  const subscriberId = Number(id);
  const navigate = useNavigate();
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.find((t) => t === searchParams.get('tab')) ?? 'overview';
  const [editing, setEditing] = useState(false);
  const [addingService, setAddingService] = useState(false);
  const [serviceAction, setServiceAction] = useState<ServiceAction>(null);
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [paymentId, setPaymentId] = useState<number | null>(null);

  const { data: subscriber, error } = useApi<SubscriberDetail>(`/subscribers/${subscriberId}`);
  const services = useApi<Paged<ServiceAccountRow>>(can('service.view') ? '/service-accounts' : null, { subscriberId, pageSize: 100 }).data?.rows ?? [];
  const events = useApi<ServiceEventRow[]>(tab === 'history' && can('service.view') ? `/subscribers/${subscriberId}/service-events` : null).data;
  const collections = useApi<{ batchId: number; batchNo: string; collectionDate: string; collectorName: string; areaName: string; status: string; totalDue: number; collectedAmount: number; outcome: string; notes: string | null }[]>(
    tab === 'collection' && can('collection.view') ? `/subscribers/${subscriberId}/collections` : null,
  ).data;

  if (error) return <EmptyState title="Subscriber not found" description={error.message} action={<Button onClick={() => navigate('/subscribers')}>Back to subscribers</Button>} />;
  if (!subscriber) return <Spinner />;

  const restricted = <Notice tone="info">Your role does not include access to this information.</Notice>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to="/subscribers" className="mb-1 inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
            <ArrowLeft className="size-3" /> All subscribers
          </Link>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            {subscriber.fullName} <StatusBadge status={subscriber.status} />
          </h1>
          <p className="truncate text-sm text-muted">
            {subscriber.accountNo} · {subscriber.phone} · {subscriber.address}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {can('subscriber.update') && (
            <Button onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
          )}
          {can('payment.create') && (
            <Button variant="primary" onClick={() => navigate(`/payments/receive?subscriberId=${subscriber.id}`)}>
              <Wallet /> Receive Payment
            </Button>
          )}
        </div>
      </div>

      <Card className="mb-3 grid grid-cols-5 divide-x divide-line">
        {[
          <Stat label="Account balance" value={subscriber.balance < 0 ? `${peso(-subscriber.balance)} credit` : peso(subscriber.balance)} tone={subscriber.balance < 0 ? 'success' : undefined} />,
          <Stat label="Total due (open invoices)" value={peso(subscriber.outstanding)} />,
          <Stat label="Overdue" value={peso(subscriber.overdue)} tone={subscriber.overdue > 0 ? 'danger' : undefined} />,
          <Stat label="Advance credit" value={peso(subscriber.credit)} tone={subscriber.credit > 0 ? 'success' : undefined} />,
          <Stat label="Last payment" value={subscriber.lastPaymentAmount ? peso(subscriber.lastPaymentAmount) : '—'} sub={subscriber.lastPaymentDate ? date(subscriber.lastPaymentDate) : 'No payments yet'} />,
        ].map((stat, i) => (
          <div key={i} className="px-4 py-3">
            {stat}
          </div>
        ))}
      </Card>

      <Tabs value={tab} onValueChange={(value) => setSearchParams({ tab: value }, { replace: true })} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mb-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="services">Services ({services.length})</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="collection">Collection</TabsTrigger>
          <TabsTrigger value="history">Service History</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold">Subscriber details</h2>
              <DescriptionList
                items={[
                  ['Account number', subscriber.accountNo],
                  ['Registered', dateTime(subscriber.createdAt)],
                  ['Contact number', subscriber.phone],
                  ['Alternate contact', subscriber.altPhone],
                  ['Email', subscriber.email],
                  ['Due day', `Every ${subscriber.dueDay} of the month`],
                  ['Collection area', subscriber.areaName],
                  ['Assigned collector', subscriber.collectorName],
                  ['Route sequence', subscriber.routeSequence],
                  ['Notes', subscriber.notes],
                ]}
              />
            </Card>
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold">Addresses</h2>
              <ul className="space-y-2">
                {subscriber.addresses.map((a) => (
                  <li key={a.id} className="rounded-md border border-line px-3 py-2 text-sm">
                    <p className="font-medium">
                      {a.label} {a.isPrimary && <StatusBadge status="ACTIVE" label="Primary" />}
                    </p>
                    <p className="text-slate-600">{a.formatted}</p>
                    {a.landmark && <p className="text-xs text-muted">Landmark: {a.landmark}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="services">
          {!can('service.view') ? restricted : (
            <Card>
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <h2 className="text-sm font-semibold">Service accounts</h2>
                {can('service.manage') && subscriber.status === 'ACTIVE' && (
                  <Button size="sm" variant="primary" onClick={() => setAddingService(true)}>
                    <Plus /> Add service
                  </Button>
                )}
              </div>
              <SimpleTable
                head={[{ label: 'Service account' }, { label: 'Plan' }, { label: 'Installation address' }, { label: 'Activated' }, { label: 'Monthly rate', num: true }, { label: 'Status' }, { label: 'Balance', num: true }, { label: '' }]}
                rows={services.map((s) => [
                  <span className="font-medium">{s.accountNo}</span>,
                  <>{s.planName} <span className="text-xs text-muted">{statusLabel(s.serviceType)}</span></>,
                  <span className="text-slate-600">{s.address}</span>,
                  date(s.activationDate),
                  <Money value={s.currentRate - s.monthlyDiscount} />,
                  <StatusBadge status={s.status} />,
                  <Money value={s.balance} zeroDash />,
                  <ServiceActions account={s} onAction={setServiceAction} />,
                ])}
                empty="This subscriber has no service account yet."
              />
            </Card>
          )}
        </TabsContent>

        <TabsContent value="billing" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          {!can('billing.view') ? restricted : <DataTable<InvoiceRow> endpoint="/invoices" params={{ subscriberId }} columns={invoiceColumns.filter((c) => !('accessorKey' in c && c.accessorKey === 'subscriberName'))} onRowClick={(row) => setInvoiceId(row.id)} exportName={`invoices-${subscriber.accountNo}`} emptyTitle="No invoices yet" />}
        </TabsContent>

        <TabsContent value="payments" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          {!can('payment.view') ? restricted : <DataTable<PaymentRow> endpoint="/payments" params={{ subscriberId }} columns={paymentColumns.filter((c) => !('accessorKey' in c && c.accessorKey === 'subscriberName'))} onRowClick={(row) => setPaymentId(row.id)} exportName={`payments-${subscriber.accountNo}`} emptyTitle="No payments yet" />}
        </TabsContent>

        <TabsContent value="ledger">{!can('billing.view') ? restricted : <LedgerTab subscriber={subscriber} />}</TabsContent>

        <TabsContent value="collection">
          {!can('collection.view') ? restricted : (
            <Card>
              <SimpleTable
                head={[{ label: 'Batch' }, { label: 'Date' }, { label: 'Collector' }, { label: 'Area' }, { label: 'Outcome' }, { label: 'Notes' }, { label: 'Total due', num: true }, { label: 'Collected', num: true }]}
                rows={(collections ?? []).map((c) => [
                  <Link to={`/collections/batches/${c.batchId}`} className="font-medium text-accent hover:underline">{c.batchNo}</Link>,
                  date(c.collectionDate),
                  c.collectorName,
                  c.areaName,
                  <StatusBadge status={c.outcome} />,
                  <span className="text-slate-600">{c.notes}</span>,
                  <Money value={c.totalDue} />,
                  <Money value={c.collectedAmount} zeroDash />,
                ])}
                empty={collections ? 'This subscriber has not been included in a collection batch.' : 'Loading…'}
              />
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history">
          {!can('service.view') ? restricted : (
            <Card>
              <SimpleTable
                head={[{ label: 'Effective date' }, { label: 'Service account' }, { label: 'Event' }, { label: 'Status change' }, { label: 'Description' }, { label: 'Recorded by' }]}
                rows={(events ?? []).map((e) => [
                  <span className="whitespace-nowrap">{date(e.effectiveDate)}</span>,
                  e.serviceAccountNo,
                  <StatusBadge status={e.eventType} label={statusLabel(e.eventType)} />,
                  e.toStatus ? `${e.fromStatus ? statusLabel(e.fromStatus) : '—'} → ${statusLabel(e.toStatus)}` : '',
                  e.description,
                  <span className="text-xs text-muted">{e.createdByName} · {dateTime(e.createdAt)}</span>,
                ])}
                empty={events ? 'No service events recorded.' : 'Loading…'}
              />
            </Card>
          )}
        </TabsContent>

        <TabsContent value="documents" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          {!can('payment.view', 'gcash.submit', 'gcash.verify') ? restricted : <DataTable<ProofRow> endpoint="/gcash/proofs" params={{ subscriberId }} columns={proofColumns} emptyTitle="No payment proofs on file" />}
        </TabsContent>

        <TabsContent value="audit" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          {!can('audit.view') ? restricted : <DataTable<AuditRow> endpoint="/audit-logs" params={{ subscriberId }} columns={auditColumns} emptyTitle="No audit entries" />}
        </TabsContent>
      </Tabs>

      <EditSubscriberDialog subscriber={subscriber} open={editing} onOpenChange={setEditing} />
      <AddServiceDialog open={addingService} onOpenChange={setAddingService} subscriberId={subscriber.id} addresses={subscriber.addresses} defaultDueDay={subscriber.dueDay} />
      <ServiceActionDialogs action={serviceAction} onClose={() => setServiceAction(null)} />
      <InvoiceDialog invoiceId={invoiceId} onClose={() => setInvoiceId(null)} />
      <PaymentDialog paymentId={paymentId} onClose={() => setPaymentId(null)} />
    </div>
  );
}

