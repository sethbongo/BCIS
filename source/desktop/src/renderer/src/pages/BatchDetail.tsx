import { BATCH_STATUSES, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, statusLabel, type BatchAccountRow, type BatchDetail, type PaymentMethod } from '@bcis/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Lock, Printer, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { Money } from '../components/common';
import { Button, Card, CardHeader, cn, Dialog, EmptyState, Field, Input, MoneyInput, Notice, Select, SimpleTable, Spinner, Stat, StatusBadge, Textarea } from '../components/ui';
import { api, errorMessage, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, dateTime, peso } from '../lib/format';
import { RouteSheetPrint } from './Collections';

function Lifecycle({ status }: { status: BatchDetail['status'] }) {
  const current = BATCH_STATUSES.indexOf(status);
  return (
    <ol className="flex items-center gap-1 text-xs" aria-label="Batch lifecycle">
      {BATCH_STATUSES.map((step, i) => (
        <li key={step} className="flex items-center gap-1" aria-current={i === current ? 'step' : undefined}>
          <span className={cn('rounded px-2 py-0.5 font-medium', i < current ? 'bg-emerald-50 text-emerald-800' : i === current ? 'bg-navy text-white' : 'bg-slate-100 text-slate-500')}>
            {i < current && '✓ '}
            {statusLabel(step)}
          </span>
          {i < BATCH_STATUSES.length - 1 && <span className="text-slate-300">›</span>}
        </li>
      ))}
    </ol>
  );
}

function CollectDialog({ batch, account, onClose }: { batch: BatchDetail; account: BatchAccountRow | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState<number | undefined>();
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [referenceNo, setReferenceNo] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState('');
  useEffect(() => {
    if (account) {
      setAmount(Math.max(account.totalDue - account.collectedAmount, 0) || undefined);
      setMethod('CASH');
      setReferenceNo('');
      setNotes('');
      setKey(crypto.randomUUID());
    }
  }, [account]);
  if (!account) return null;
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/batches/${batch.id}/collections`, { subscriberId: account.subscriberId, amount, method, referenceNo: referenceNo.trim() || undefined, notes: notes.trim() || undefined, idempotencyKey: key });
      toast.success(`${peso(amount)} collected from ${account.fullName}`);
      await queryClient.invalidateQueries();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Record collection · ${account.fullName}`}
      description={`${account.accountNo} · total due ${peso(account.totalDue)}${account.collectedAmount ? ` · already collected ${peso(account.collectedAmount)}` : ''}`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!amount || (method !== 'CASH' && !referenceNo.trim())} onClick={() => void submit()}>
            Post collection
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount collected" required>
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        <Field label="Method" required>
          <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        {method !== 'CASH' && (
          <Field label="Reference number" required className="col-span-2" hint="Non-cash collections are reported on the batch but are not part of the cash to remit.">
            <Input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
          </Field>
        )}
        <Field label="Notes" className="col-span-2">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <p className="col-span-2 text-xs text-muted">Posts a payment dated {date(batch.collectionDate)}, issues a receipt and applies it to the oldest unpaid invoices first.</p>
      </div>
    </Dialog>
  );
}

/** Collector reconciliation: expected cash, remitted cash, difference, non-cash totals, accounts collected and exceptions. */
function Reconciliation({ batch }: { batch: BatchDetail }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState<number | undefined>();
  const [remitNotes, setRemitNotes] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setAmount(batch.status === 'SUBMITTED' ? batch.cashCollected : undefined);
    setError(null);
    setConfirmed(false);
  }, [batch.id, batch.status, batch.cashCollected]);

  const act = async (label: string, run: () => Promise<unknown>, success: string) => {
    setBusy(label);
    setError(null);
    try {
      await run();
      toast.success(success);
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const hasRemittance = batch.remittances.length > 0;
  const diff = batch.difference;
  const variance = !hasRemittance ? null : diff === 0 ? 'BALANCED' : diff < 0 ? 'SHORTAGE' : 'OVERAGE';

  return (
    <Card>
      <CardHeader title="Remittance and reconciliation" description="Only cash is remitted. GCash and other non-cash collections are reported separately." />
      <div className="grid grid-cols-4 divide-x divide-line border-b border-line">
        <div className="px-4 py-3"><Stat label="Expected cash (cash collected)" value={peso(batch.cashCollected)} /></div>
        <div className="px-4 py-3"><Stat label="Cash remitted" value={hasRemittance ? peso(batch.cashRemitted) : '—'} sub={hasRemittance ? `${batch.remittances.length} remittance record${batch.remittances.length === 1 ? '' : 's'}` : 'Nothing turned over yet'} /></div>
        <div className={cn('px-4 py-3', variance === 'SHORTAGE' && 'bg-red-50', variance === 'OVERAGE' && 'bg-amber-50')}>
          <Stat
            label="Difference (remitted − collected)"
            value={variance ? `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${peso(Math.abs(diff))}` : '—'}
            tone={variance === 'SHORTAGE' ? 'danger' : variance === 'OVERAGE' ? 'warning' : variance === 'BALANCED' ? 'success' : undefined}
            sub={variance && <StatusBadge status={variance} label={variance === 'BALANCED' ? 'Balanced' : `${statusLabel(variance)} of ${peso(Math.abs(diff))}`} />}
          />
        </div>
        <div className="px-4 py-3"><Stat label="Non-cash collected" value={peso(batch.nonCashCollected)} sub="GCash, bank transfer, cheque" /></div>
      </div>

      <div className="grid grid-cols-2 gap-4 p-4">
        <div className="space-y-3">
          <div className="rounded-md border border-line">
            <SimpleTable
              head={[{ label: 'Remittance no.' }, { label: 'Received' }, { label: 'Received by' }, { label: 'Notes' }, { label: 'Amount', num: true }]}
              rows={batch.remittances.map((r) => [r.remittanceNo, <span className="whitespace-nowrap">{dateTime(r.remittedAt)}</span>, r.receivedByName, r.notes, <Money value={r.amount} />])}
              empty="No cash remittance recorded yet."
              foot={hasRemittance ? ['Total remitted', '', '', '', <Money value={batch.cashRemitted} />] : undefined}
            />
          </div>
          {batch.exceptions.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Exceptions ({batch.exceptions.length})</p>
              <ul className="space-y-1 text-sm">
                {batch.exceptions.map((e, i) => (
                  <li key={i} className="rounded border border-line px-2.5 py-1">
                    <span className="font-medium">{e.subscriberName}</span> <span className="text-xs text-muted">{e.accountNo}</span> — {e.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {error && <Notice tone="danger">{error}</Notice>}
          {(batch.status === 'OPEN' || batch.status === 'IN_PROGRESS') && <Notice tone="info">Submit the batch when the collector has finished. Remittance is recorded after submission.</Notice>}

          {(batch.status === 'SUBMITTED' || batch.status === 'REMITTED') &&
            (can('collection.remit') ? (
              <div className="space-y-2 rounded-md border border-line p-3">
                <p className="text-sm font-medium">{hasRemittance ? 'Record additional cash turned over' : 'Record cash turned over'}</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Cash amount counted" required>
                    <MoneyInput value={amount} onChange={setAmount} />
                  </Field>
                  <Field label="Notes">
                    <Input value={remitNotes} onChange={(e) => setRemitNotes(e.target.value)} />
                  </Field>
                </div>
                <Button variant={hasRemittance ? 'secondary' : 'primary'} loading={busy === 'remit'} disabled={amount === undefined} onClick={() => void act('remit', () => api.post(`/batches/${batch.id}/remittances`, { amount, notes: remitNotes.trim() || undefined }), 'Remittance recorded').then(() => { setAmount(undefined); setRemitNotes(''); })}>
                  Record remittance
                </Button>
              </div>
            ) : (
              <Notice tone="info">Waiting for the cash remittance to be recorded.</Notice>
            ))}

          {batch.status === 'REMITTED' &&
            (can('collection.reconcile') ? (
              <div className="space-y-2 rounded-md border border-line p-3">
                <p className="text-sm font-medium">Reconcile</p>
                {variance === 'BALANCED' ? (
                  <Notice tone="success">Remitted cash equals cash collected. The batch can be reconciled as balanced.</Notice>
                ) : (
                  <>
                    <Notice tone={variance === 'SHORTAGE' ? 'danger' : 'warning'} title={`${statusLabel(variance ?? '')} of ${peso(Math.abs(diff))}`}>
                      The difference will be recorded on the batch exactly as it is. Explain it to continue.
                    </Notice>
                    <Field label={`Reason for the ${variance === 'SHORTAGE' ? 'shortage' : 'overage'}`} required>
                      <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </Field>
                  </>
                )}
                <Button variant="primary" loading={busy === 'reconcile'} disabled={variance !== 'BALANCED' && reason.trim().length < 5} onClick={() => void act('reconcile', () => api.post(`/batches/${batch.id}/reconcile`, { varianceReason: reason.trim() || undefined }), 'Batch reconciled')}>
                  <Check /> Reconcile{variance && variance !== 'BALANCED' ? ` with ${variance.toLowerCase()}` : ' as balanced'}
                </Button>
              </div>
            ) : (
              <Notice tone="info">Waiting for a collection supervisor to reconcile.</Notice>
            ))}

          {(batch.status === 'RECONCILED' || batch.status === 'CLOSED') && (
            <Notice tone={batch.varianceType === 'BALANCED' ? 'success' : batch.varianceType === 'SHORTAGE' ? 'danger' : 'warning'} title={`Reconciled: ${batch.varianceType === 'BALANCED' ? 'balanced' : `${statusLabel(batch.varianceType ?? '')} of ${peso(Math.abs(batch.difference))}`}`}>
              By {batch.reconciledByName} on {dateTime(batch.reconciledAt)}.{batch.varianceReason && ` Reason: ${batch.varianceReason}`}
            </Notice>
          )}
          {batch.status === 'RECONCILED' &&
            (can('collection.close') ? (
              <div className="space-y-2 rounded-md border border-line p-3">
                <p className="text-sm font-medium">Close batch</p>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  <span>
                    I confirm the reconciliation result{batch.varianceType !== 'BALANCED' && <> including the recorded <strong>{batch.varianceType?.toLowerCase()} of {peso(Math.abs(batch.difference))}</strong></>}. A closed batch cannot be changed.
                  </span>
                </label>
                <Button variant="navy" loading={busy === 'close'} disabled={!confirmed} onClick={() => void act('close', () => api.post(`/batches/${batch.id}/close`, { confirm: true }), 'Batch closed')}>
                  <Lock /> Close batch
                </Button>
              </div>
            ) : (
              <Notice tone="info">Reconciled. Waiting for an administrator or the owner to confirm and close the batch.</Notice>
            ))}
          {batch.status === 'CLOSED' && <p className="text-sm text-muted">Closed by {batch.closedByName} on {dateTime(batch.closedAt)}.</p>}
        </div>
      </div>
    </Card>
  );
}

export function BatchDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const { data: batch, error } = useApi<BatchDetail>(`/batches/${Number(id)}`);
  const [collecting, setCollecting] = useState<BatchAccountRow | null>(null);
  const [printing, setPrinting] = useState(false);
  const [busy, setBusy] = useState(false);
  if (error) return <EmptyState title="Batch not found" description={error.message} />;
  if (!batch) return <Spinner />;

  const editable = batch.status === 'OPEN' || batch.status === 'IN_PROGRESS';
  const canRecord = editable && can('collection.record');
  const action = async (path: string, body: unknown, message: string) => {
    setBusy(true);
    try {
      await api.post(`/batches/${batch.id}/${path}`, body);
      toast.success(message);
      await queryClient.invalidateQueries();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link to="/collections/batches" className="mb-1 inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
            <ArrowLeft className="size-3" /> Collection batches
          </Link>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            Batch {batch.batchNo} <StatusBadge status={batch.status} />
          </h1>
          <p className="text-sm text-muted">
            {batch.collectorName} · {batch.areaName} · {date(batch.collectionDate)} · created by {batch.createdByName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setPrinting(true)}>
            <Printer /> Route sheet
          </Button>
          {batch.status === 'OPEN' && can('collection.record', 'collection.manage') && (
            <Button loading={busy} onClick={() => void action('start', {}, 'Batch started')}>
              Start collection
            </Button>
          )}
          {canRecord && (
            <Button variant="primary" loading={busy} onClick={() => void action('submit', {}, 'Batch submitted for remittance')}>
              <Send /> Submit batch
            </Button>
          )}
        </div>
      </div>
      <Lifecycle status={batch.status} />

      <Card className="grid grid-cols-5 divide-x divide-line">
        <div className="px-4 py-3"><Stat label="Expected receivable" value={peso(batch.expectedTotal)} sub={`${batch.accountCount} accounts`} /></div>
        <div className="px-4 py-3"><Stat label="Cash collected" value={peso(batch.cashCollected)} /></div>
        <div className="px-4 py-3"><Stat label="GCash / non-cash collected" value={peso(batch.nonCashCollected)} /></div>
        <div className="px-4 py-3"><Stat label="Uncollected" value={peso(batch.uncollected)} tone={batch.uncollected > 0 ? 'warning' : undefined} /></div>
        <div className="px-4 py-3"><Stat label="Accounts collected" value={`${batch.collectedCount} of ${batch.accountCount}`} sub={`${batch.exceptions.length} exception${batch.exceptions.length === 1 ? '' : 's'}`} /></div>
      </Card>

      {batch.status !== 'OPEN' && batch.status !== 'IN_PROGRESS' && <Reconciliation batch={batch} />}

      <Card>
        <CardHeader title="Accounts on this route" description="Amounts due were fixed when the batch was created." />
        <SimpleTable
          head={[{ label: '#' }, { label: 'Account' }, { label: 'Subscriber' }, { label: 'Address' }, { label: 'Current', num: true }, { label: 'Arrears', num: true }, { label: 'Total due', num: true }, { label: 'Collected', num: true }, { label: 'Outcome' }, { label: 'Receipts / notes' }, ...(canRecord ? [{ label: '' }] : [])]}
          rows={batch.accounts.map((a) => [
            a.sequence,
            <Link to={`/subscribers/${a.subscriberId}`} className="whitespace-nowrap font-medium text-accent hover:underline">{a.accountNo}</Link>,
            a.fullName,
            <span className="text-slate-600">{a.address}</span>,
            <Money value={a.currentBill} zeroDash />,
            <Money value={a.arrears} zeroDash className={a.arrears > 0 ? 'text-danger' : undefined} />,
            <Money value={a.totalDue} className="font-medium" />,
            <Money value={a.collectedAmount} zeroDash className="font-semibold" />,
            <StatusBadge status={a.outcome} />,
            <span className="text-xs text-slate-600">
              {a.payments.map((p) => `${p.receiptNo} (${PAYMENT_METHOD_LABELS[p.method]}${p.status === 'REVERSED' ? ', reversed' : ''})`).join(', ')}
              {a.notes && ` ${a.notes}`}
            </span>,
            ...(canRecord
              ? [
                  <span className="flex justify-end gap-1">
                    <Button size="sm" variant="primary" onClick={() => setCollecting(a)}>
                      Collect
                    </Button>
                    {a.collectedAmount === 0 && (
                      <Select
                        aria-label={`Visit outcome for ${a.fullName}`}
                        className="h-7 w-32 text-xs"
                        value=""
                        onChange={(e) => e.target.value && void action('outcomes', { subscriberId: a.subscriberId, outcome: e.target.value }, 'Visit outcome recorded')}
                      >
                        <option value="">No payment…</option>
                        <option value="NOT_HOME">Not at home</option>
                        <option value="PROMISED">Promised to pay</option>
                        <option value="REFUSED">Refused</option>
                      </Select>
                    )}
                  </span>,
                ]
              : []),
          ])}
          foot={['', '', '', 'Totals', <Money value={batch.accounts.reduce((s, a) => s + a.currentBill, 0)} />, <Money value={batch.accounts.reduce((s, a) => s + a.arrears, 0)} />, <Money value={batch.expectedTotal} />, <Money value={batch.accounts.reduce((s, a) => s + a.collectedAmount, 0)} />, '', '', ...(canRecord ? [''] : [])]}
        />
      </Card>

      {(batch.status === 'OPEN' || batch.status === 'IN_PROGRESS') && <Reconciliation batch={batch} />}
      <CollectDialog batch={batch} account={collecting} onClose={() => setCollecting(null)} />
      {printing && (
        <RouteSheetPrint
          title={`Route sheet · ${batch.batchNo}`}
          onClose={() => setPrinting(false)}
          sheet={{
            areaName: `${batch.areaName} (${batch.batchNo})`,
            collectorName: batch.collectorName,
            asOf: batch.collectionDate,
            rows: batch.accounts,
            totals: { currentBill: batch.accounts.reduce((s, a) => s + a.currentBill, 0), arrears: batch.accounts.reduce((s, a) => s + a.arrears, 0), totalDue: batch.expectedTotal },
          }}
        />
      )}
    </div>
  );
}
