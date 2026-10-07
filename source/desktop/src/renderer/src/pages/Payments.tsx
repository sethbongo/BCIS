import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  periodLabel,
  type AllocationPreview,
  type InvoiceRow,
  type Paged,
  type PaymentDetail,
  type PaymentMethod,
  type PaymentRow,
  type SubscriberDetail,
} from '@bcis/shared';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Printer, RotateCcw, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Money, PrintHeader, PrintPreview, ReasonDialog, statusOptions, SubscriberPicker } from '../components/common';
import { DataTable, FilterSelect, type Column } from '../components/DataTable';
import { Button, Card, CardHeader, DescriptionList, Dialog, EmptyState, Field, Input, MoneyInput, Notice, PageHeader, Select, SimpleTable, Spinner, Stat, StatusBadge } from '../components/ui';
import { api, ApiError, errorMessage, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, dateTime, peso, todayIso } from '../lib/format';

/** Reads a chosen file into the base64 upload shape the API expects. */
export function fileToUpload(file: File): Promise<{ fileName: string; dataBase64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ fileName: file.name, dataBase64: String(reader.result).split(',')[1] ?? '' });
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------- Receipt (print layout)
export function ReceiptSheet({ payment }: { payment: PaymentDetail }) {
  const active = payment.allocations.filter((a) => !a.isReversed || payment.status === 'REVERSED');
  return (
    <div className="relative">
      {payment.status === 'REVERSED' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-12 border-4 border-red-600 px-6 py-2 text-5xl font-black tracking-widest text-red-600 opacity-25">VOID</span>
        </div>
      )}
      <PrintHeader title="Official Receipt" subtitle={`No. ${payment.receiptNo}`} right={<p className="text-[10px] text-slate-600">{date(payment.paymentDate)}</p>} />
      <div className="mb-4 grid grid-cols-2 gap-x-8 gap-y-1">
        <p>
          <span className="text-slate-500">Received from: </span>
          <strong>{payment.subscriberName}</strong>
        </p>
        <p>
          <span className="text-slate-500">Account no.: </span>
          {payment.subscriberAccountNo}
        </p>
        <p>
          <span className="text-slate-500">Address: </span>
          {payment.address}
        </p>
        <p>
          <span className="text-slate-500">Payment method: </span>
          {PAYMENT_METHOD_LABELS[payment.method]}
          {payment.referenceNo && ` · Ref ${payment.referenceNo}`}
        </p>
      </div>
      <table>
        <thead>
          <tr>
            <th>Applied to</th>
            <th>Description</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {active.map((a) => (
            <tr key={a.id}>
              <td>{a.invoiceNo}</td>
              <td>
                {a.description}
                {a.type === 'CREDIT' && ' (advance credit applied)'}
              </td>
              <td className="num">{peso(a.amount)}</td>
            </tr>
          ))}
          {payment.unappliedAmount > 0 && (
            <tr>
              <td>—</td>
              <td>Advance payment (credit for future invoices)</td>
              <td className="num">{peso(payment.unappliedAmount)}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>TOTAL AMOUNT RECEIVED</td>
            <td className="num text-sm">{peso(payment.amount)}</td>
          </tr>
        </tfoot>
      </table>
      <div className="mt-4 flex items-end justify-between">
        <div>
          <p>
            <span className="text-slate-500">Account balance after this payment: </span>
            <strong>{payment.balanceAfter < 0 ? `${peso(-payment.balanceAfter)} advance credit` : peso(payment.balanceAfter)}</strong>
          </p>
          {payment.notes && <p className="text-slate-600">Note: {payment.notes}</p>}
          {payment.reversal && (
            <p className="mt-1 font-semibold text-red-700">
              VOID — reversed {dateTime(payment.reversal.reversedAt)} ({payment.reversal.reversalNo}): {payment.reversal.reason}
            </p>
          )}
        </div>
        <div className="w-56 text-center">
          <p className="border-b border-slate-400 pb-0.5 font-medium">{payment.collectorName ?? payment.receivedByName}</p>
          <p className="text-[10px] text-slate-500">{payment.collectorName ? 'Collector' : 'Received by'}</p>
        </div>
      </div>
      <p className="mt-6 text-center text-[10px] text-slate-500">Posted {dateTime(payment.paidAt)} · Thank you for your payment.</p>
    </div>
  );
}

function usePrintReceipt() {
  const [payment, setPayment] = useState<PaymentDetail | null>(null);
  const element = payment && (
    <PrintPreview title={`Receipt ${payment.receiptNo}`} fileName={`receipt-${payment.receiptNo}`} onClose={() => setPayment(null)} onPrinted={() => void api.post(`/payments/${payment.id}/printed`).catch(() => undefined)}>
      <ReceiptSheet payment={payment} />
    </PrintPreview>
  );
  return { print: setPayment, element };
}

// ---------------------------------------------------------------- Receive Payment
export function ReceivePaymentPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [subscriberId, setSubscriberId] = useState<number | null>(Number(searchParams.get('subscriberId')) || null);
  const [amount, setAmount] = useState<number | undefined>();
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [referenceNo, setReferenceNo] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [manual, setManual] = useState(false);
  const [manualAmounts, setManualAmounts] = useState<Record<number, number | undefined>>({});
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [posted, setPosted] = useState<PaymentDetail | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const receipt = usePrintReceipt();

  const subscriber = useApi<SubscriberDetail>(subscriberId ? `/subscribers/${subscriberId}` : null).data;
  const invoicePage = useApi<Paged<InvoiceRow>>(subscriberId ? '/invoices' : null, { subscriberId: subscriberId ?? undefined, status: 'OPEN', sort: 'dueDate', dir: 'asc', pageSize: 100 }).data;
  const invoices = useMemo(() => invoicePage?.rows ?? [], [invoicePage]);

  const allocations = useMemo(
    () => (manual ? invoices.filter((i) => (manualAmounts[i.id] ?? 0) > 0).map((i) => ({ invoiceId: i.id, amount: manualAmounts[i.id]! })) : undefined),
    [manual, manualAmounts, invoices],
  );
  const previewBody = subscriberId && amount ? { subscriberId, amount, allocations } : null;
  const [preview, setPreview] = useState<AllocationPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewKey = JSON.stringify(previewBody);
  useEffect(() => {
    if (!previewBody) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .post<AllocationPreview>('/payments/preview', previewBody)
        .then((p) => !cancelled && (setPreview(p), setPreviewError(null)))
        .catch((err) => !cancelled && (setPreview(null), setPreviewError(errorMessage(err))));
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  const reset = (keepSubscriber = false) => {
    if (!keepSubscriber) {
      setSubscriberId(null);
      setSearchParams({});
    }
    setAmount(undefined);
    setMethod('CASH');
    setReferenceNo('');
    setPaymentDate(todayIso());
    setNotes('');
    setProof(null);
    setManual(false);
    setManualAmounts({});
    setError(null);
    setPosted(null);
    idempotencyKey.current = crypto.randomUUID();
  };

  const needsReference = method !== 'CASH';
  const canPost = !!subscriberId && !!amount && amount > 0 && (!needsReference || referenceNo.trim().length > 0) && !previewError && !posting;

  const post = async () => {
    if (!canPost || !subscriberId || !amount) return;
    setPosting(true);
    setError(null);
    try {
      const payment = await api.post<PaymentDetail>('/payments', {
        subscriberId,
        amount,
        method,
        referenceNo: referenceNo.trim() || undefined,
        paymentDate,
        notes: notes.trim() || undefined,
        allocations,
        idempotencyKey: idempotencyKey.current,
        proof: proof ? await fileToUpload(proof) : undefined,
      });
      setPosted(payment);
      toast.success(`Payment posted · Receipt ${payment.receiptNo}`);
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(err as Error);
    } finally {
      setPosting(false);
    }
  };

  const methods = PAYMENT_METHODS.filter((m) => m !== 'GCASH' || can('gcash.verify'));

  if (posted) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title="Receive Payment" />
        <Card>
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-success" />
            <div>
              <h2 className="text-base font-semibold">Payment posted</h2>
              <p className="text-sm text-muted">
                Receipt <strong className="text-ink">{posted.receiptNo}</strong> for {peso(posted.amount)} from {posted.subscriberName} ({posted.subscriberAccountNo}).
              </p>
            </div>
          </div>
          <div className="space-y-4 p-5">
            <SimpleTable
              head={[{ label: 'Applied to' }, { label: 'Description' }, { label: 'Amount', num: true }]}
              rows={[
                ...posted.allocations.map((a) => [a.invoiceNo, a.description, <Money value={a.amount} />]),
                ...(posted.unappliedAmount > 0 ? [['—', 'Advance credit kept for future invoices', <Money value={posted.unappliedAmount} />]] : []),
              ]}
              foot={['Total received', '', <Money value={posted.amount} />]}
            />
            <p className="text-sm">
              Account balance after payment: <strong>{posted.balanceAfter < 0 ? `${peso(-posted.balanceAfter)} advance credit` : peso(posted.balanceAfter)}</strong>
            </p>
            <div className="flex gap-2">
              <Button variant="primary" size="lg" onClick={() => receipt.print(posted)} autoFocus>
                <Printer /> Print receipt
              </Button>
              <Button size="lg" onClick={() => reset()}>
                <RotateCcw /> New payment
              </Button>
              <Link to={`/subscribers/${posted.subscriberId}?tab=ledger`}>
                <Button size="lg" variant="ghost">
                  View ledger
                </Button>
              </Link>
            </div>
          </div>
        </Card>
        {receipt.element}
      </div>
    );
  }

  return (
    <div
      onKeyDown={(e) => {
        if (e.ctrlKey && e.key === 'Enter') void post();
      }}
    >
      <PageHeader title="Receive Payment" description="Find the subscriber, enter the amount, check the allocation, then post. Ctrl+Enter posts the payment." />
      <div className="grid grid-cols-5 gap-3">
        <div className="col-span-3 space-y-3">
          <Card>
            <CardHeader title="1 · Subscriber" actions={subscriber && <Button size="sm" variant="ghost" onClick={() => reset()}>Change</Button>} />
            <div className="p-4">
              {!subscriber ? (
                <SubscriberPicker
                  autoFocus
                  onSelect={(s) => {
                    reset(true);
                    setSubscriberId(s.id);
                  }}
                />
              ) : (
                <>
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-base font-semibold">
                        {subscriber.fullName} <StatusBadge status={subscriber.status} />
                      </p>
                      <p className="truncate text-sm text-muted">
                        {subscriber.accountNo} · {subscriber.phone} · {subscriber.address}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-6 text-right">
                      <Stat label="Total due" value={peso(subscriber.outstanding)} />
                      <Stat label="Overdue" value={peso(subscriber.overdue)} tone={subscriber.overdue > 0 ? 'danger' : undefined} />
                      <Stat label="Advance credit" value={peso(subscriber.credit)} tone={subscriber.credit > 0 ? 'success' : undefined} />
                    </div>
                  </div>
                  <SimpleTable
                    head={[{ label: 'Invoice' }, { label: 'Period' }, { label: 'Due date' }, { label: 'Status' }, { label: 'Balance', num: true }, ...(manual ? [{ label: 'Apply', num: true, className: 'w-36' }] : [])]}
                    rows={invoices.map((i) => [
                      i.invoiceNo,
                      i.billingPeriod ? periodLabel(i.billingPeriod) : 'One-time charge',
                      <span className={i.daysPastDue > 0 ? 'text-danger' : undefined}>
                        {date(i.dueDate)}
                        {i.daysPastDue > 0 && ` · ${i.daysPastDue}d late`}
                      </span>,
                      <StatusBadge status={i.status} />,
                      <Money value={i.balance} />,
                      ...(manual ? [<MoneyInput value={manualAmounts[i.id]} onChange={(v) => setManualAmounts((m) => ({ ...m, [i.id]: v }))} />] : []),
                    ])}
                    empty="No open invoices. A payment will be kept as advance credit."
                  />
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="2 · Payment" />
            <fieldset disabled={!subscriber} className="grid grid-cols-6 gap-3 p-4 disabled:opacity-60">
              <Field label="Amount received" required className="col-span-2">
                <MoneyInput key={subscriberId ?? 0} value={amount} onChange={setAmount} autoFocus={!!subscriber} className="h-10 text-base font-semibold" />
              </Field>
              <div className="col-span-4 flex items-end gap-2">
                <Button onClick={() => setAmount(subscriber?.outstanding)} disabled={!subscriber?.outstanding}>
                  Total due {subscriber ? peso(subscriber.outstanding) : ''}
                </Button>
                <Button onClick={() => setAmount(subscriber?.overdue)} disabled={!subscriber?.overdue}>
                  Overdue only {subscriber?.overdue ? peso(subscriber.overdue) : ''}
                </Button>
              </div>
              <Field label="Payment method" required className="col-span-2">
                <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  {methods.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reference number" required={needsReference} className="col-span-2" hint={needsReference ? 'Transaction / cheque / transfer reference' : 'Not needed for cash'}>
                <Input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} disabled={!needsReference} />
              </Field>
              <Field label="Payment date" required className="col-span-2">
                <Input type="date" value={paymentDate} max={todayIso()} onChange={(e) => setPaymentDate(e.target.value)} />
              </Field>
              <Field label="Notes" className="col-span-3">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
              </Field>
              <Field label="Proof attachment (optional)" className="col-span-3" hint="PNG, JPEG, WEBP or PDF up to 5 MB">
                <Input type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" className="py-1" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
              </Field>
              {!can('gcash.verify') && (
                <p className="col-span-6 text-xs text-muted">
                  GCash screenshots are recorded in <Link to="/payments/gcash" className="font-medium text-accent hover:underline">GCash Verification</Link> and posted only after an authorized verifier approves them.
                </p>
              )}
            </fieldset>
          </Card>
        </div>

        <div className="col-span-2">
          <Card className="sticky top-0">
            <CardHeader
              title="3 · Allocation preview"
              description={manual ? 'Manual allocation (authorized override)' : 'Oldest unpaid invoice first'}
              actions={
                can('payment.allocate_manual') &&
                invoices.length > 1 && (
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} /> Manual
                  </label>
                )
              }
            />
            <div className="space-y-3 p-4">
              {!subscriber && <p className="py-6 text-center text-sm text-muted">Select a subscriber to begin.</p>}
              {subscriber && !amount && <p className="py-6 text-center text-sm text-muted">Enter the amount received to see where it will be applied.</p>}
              {previewError && <Notice tone="danger">{previewError}</Notice>}
              {preview && (
                <>
                  <SimpleTable
                    head={[{ label: 'Invoice' }, { label: 'Balance', num: true }, { label: 'Applied', num: true }, { label: 'Remaining', num: true }]}
                    rows={preview.lines.map((l) => [
                      <>
                        {l.invoiceNo}
                        <span className="block text-xs text-muted">due {date(l.dueDate)}</span>
                      </>,
                      <Money value={l.balanceBefore} />,
                      <Money value={l.applied} className="font-semibold" />,
                      l.balanceAfter === 0 ? <StatusBadge status="PAID" /> : <Money value={l.balanceAfter} />,
                    ])}
                    empty="Nothing is applied to an invoice."
                  />
                  {preview.unapplied > 0 && (
                    <Notice tone="info" title={`${peso(preview.unapplied)} will be kept as advance credit`}>
                      It is applied automatically to the subscriber's next invoices. No amount is lost.
                    </Notice>
                  )}
                  <dl className="space-y-1 border-t border-line pt-3 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted">Total due before</dt>
                      <dd className="num">{peso(preview.outstandingBefore)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">Amount received</dt>
                      <dd className="num font-semibold">{peso(preview.amount)}</dd>
                    </div>
                    <div className="flex justify-between text-base font-semibold">
                      <dt>Remaining due after</dt>
                      <dd className="num">{peso(preview.outstandingAfter)}</dd>
                    </div>
                  </dl>
                </>
              )}
              {error && (
                <Notice tone="danger" title="The payment was not posted">
                  {error.message}
                </Notice>
              )}
              <Button variant="primary" size="lg" className="w-full" disabled={!canPost} loading={posting} onClick={() => void post()}>
                Post payment{amount ? ` · ${peso(amount)}` : ''}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Payment detail dialog (receipt, reversal)
export function PaymentDialog({ paymentId, onClose }: { paymentId: number | null; onClose: () => void }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const { data: payment, error } = useApi<PaymentDetail>(paymentId ? `/payments/${paymentId}` : null);
  const [reversing, setReversing] = useState(false);
  const receipt = usePrintReceipt();
  if (receipt.element) return receipt.element;
  return (
    <>
      <Dialog
        open={paymentId !== null && !reversing}
        onOpenChange={(open) => !open && onClose()}
        title={payment ? `Receipt ${payment.receiptNo}` : 'Payment'}
        description={payment ? `${payment.subscriberName} · ${payment.subscriberAccountNo}` : undefined}
        size="lg"
        footer={
          payment && (
            <>
              {payment.status === 'POSTED' && can('payment.reverse') && (
                <Button variant="danger-outline" className="mr-auto" onClick={() => setReversing(true)}>
                  <Undo2 /> Reverse payment
                </Button>
              )}
              <Button onClick={() => receipt.print(payment)}>
                <Printer /> Print receipt
              </Button>
              <Button variant="primary" onClick={onClose}>
                Close
              </Button>
            </>
          )
        }
      >
        {error && <EmptyState title="The payment could not be loaded" description={error.message} />}
        {!payment && !error && <Spinner />}
        {payment && (
          <div className="space-y-4">
            {payment.reversal && (
              <Notice tone="danger" title={`Reversed · ${payment.reversal.reversalNo}`}>
                {payment.reversal.reason} — by {payment.reversal.reversedByName} on {dateTime(payment.reversal.reversedAt)}. The original payment and its voided receipt number are kept for audit.
              </Notice>
            )}
            <DescriptionList
              columns={3}
              items={[
                ['Amount', <span className="text-base font-semibold">{peso(payment.amount)}</span>],
                ['Status', <span className="flex gap-1.5"><StatusBadge status={payment.status} /><StatusBadge status={payment.receiptStatus} label={`Receipt ${payment.receiptStatus === 'VOID' ? 'void' : 'issued'}`} /></span>],
                ['Payment date', date(payment.paymentDate)],
                ['Method', PAYMENT_METHOD_LABELS[payment.method]],
                ['Reference no.', payment.referenceNo],
                ['Posted', dateTime(payment.paidAt)],
                ['Received by', payment.receivedByName],
                ['Collector / batch', payment.collectorName ? `${payment.collectorName} · ${payment.batchNo}` : null],
                ['Notes', payment.notes],
              ]}
            />
            <div className="rounded-md border border-line">
              <SimpleTable
                head={[{ label: 'Invoice' }, { label: 'Description' }, { label: 'Type' }, { label: 'Amount', num: true }]}
                rows={[
                  ...payment.allocations.map((a) => [a.invoiceNo, a.description, <span className="text-xs text-muted">{a.type === 'CREDIT' ? 'Advance credit applied' : a.type === 'MANUAL' ? 'Manual' : 'Oldest first'}{a.isReversed && ' · reversed'}</span>, <Money value={a.amount} className={a.isReversed ? 'text-muted line-through' : undefined} />]),
                  ...(payment.unappliedAmount > 0 ? [['—', 'Unapplied advance credit', '', <Money value={payment.unappliedAmount} />]] : []),
                ]}
                empty="This payment is not applied to any invoice."
              />
            </div>
          </div>
        )}
      </Dialog>
      {payment && (
        <ReasonDialog
          open={reversing}
          onOpenChange={setReversing}
          title={`Reverse receipt ${payment.receiptNo}?`}
          description={`${peso(payment.amount)} from ${payment.subscriberName}`}
          confirmLabel="Reverse payment"
          danger
          reasonLabel="Reason for reversal"
          onConfirm={async (reason) => {
            await api.post(`/payments/${payment.id}/reverse`, { reason });
            toast.success(`Receipt ${payment.receiptNo} reversed`);
            await queryClient.invalidateQueries();
          }}
        >
          <Notice tone="warning">
            The payment is not deleted. It stays in history marked REVERSED, the receipt becomes VOID (its number is never reused), invoice balances are restored and the reversal is recorded in the audit trail.
          </Notice>
        </ReasonDialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Payment history
export const paymentColumns: Column<PaymentRow>[] = [
  { accessorKey: 'receiptNo', header: 'Receipt No.', cell: (c) => <span className="font-medium text-accent">{c.row.original.receiptNo}</span> },
  { accessorKey: 'paymentDate', header: 'Date', cell: (c) => <span className="whitespace-nowrap">{date(c.row.original.paymentDate)}</span> },
  {
    accessorKey: 'subscriberName',
    header: 'Subscriber',
    cell: (c) => (
      <>
        {c.row.original.subscriberName} <span className="text-xs text-muted">{c.row.original.subscriberAccountNo}</span>
      </>
    ),
  },
  { accessorKey: 'method', header: 'Method', cell: (c) => PAYMENT_METHOD_LABELS[c.row.original.method], csv: (r) => PAYMENT_METHOD_LABELS[r.method] },
  { accessorKey: 'referenceNo', header: 'Reference', enableSorting: false },
  { id: 'receivedBy', header: 'Received by', enableSorting: false, cell: (c) => c.row.original.collectorName ?? c.row.original.receivedByName, csv: (r) => r.collectorName ?? r.receivedByName },
  { accessorKey: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.row.original.status} /> },
  { accessorKey: 'amount', header: 'Amount', num: true, cell: (c) => <Money value={c.row.original.amount} className={c.row.original.status === 'REVERSED' ? 'text-muted line-through' : undefined} />, csv: (r) => (r.amount / 100).toFixed(2) },
];

export function PaymentHistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const openId = Number(searchParams.get('open')) || null;
  return (
    <>
      <PageHeader title="Payment History" description="Every receipt issued, including reversed payments and voided receipts." />
      <DataTable<PaymentRow>
        endpoint="/payments"
        columns={paymentColumns}
        params={{ method, status, from, to }}
        searchPlaceholder="Receipt no., reference, subscriber…"
        exportName="payments"
        onRowClick={(row) => setSearchParams({ open: String(row.id) })}
        filters={
          <>
            <FilterSelect label="Method" value={method} onChange={setMethod} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
            <FilterSelect label="Status" value={status} onChange={setStatus} options={statusOptions(PAYMENT_STATUSES)} />
            <Input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" />
            <span className="text-xs text-muted">to</span>
            <Input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" />
          </>
        }
      />
      <PaymentDialog paymentId={openId} onClose={() => setSearchParams({})} />
    </>
  );
}
