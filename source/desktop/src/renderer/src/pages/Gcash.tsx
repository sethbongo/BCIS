import type { DuplicateReference, Paged, ProofRow, SubscriberRow } from '@bcis/shared';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ImagePlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Money, ReasonDialog, SubscriberPicker } from '../components/common';
import { Button, Card, cn, DescriptionList, Dialog, EmptyState, Field, Input, MoneyInput, Notice, PageHeader, Spinner, StatusBadge, Textarea } from '../components/ui';
import { api, errorMessage, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, dateTime, peso, todayIso } from '../lib/format';
import { fileToUpload } from './Payments';

/** Loads the proof image through the main process (the renderer has no network access). */
function ProofImage({ proof }: { proof: ProofRow }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setError(null);
    void window.bcis.api.blob({ path: `/gcash/proofs/${proof.id}/file` }).then((result) => {
      if (cancelled) return;
      if (!result.ok) return setError(result.error.message);
      objectUrl = URL.createObjectURL(new Blob([result.data.data], { type: result.data.contentType }));
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [proof.id]);
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!url) return <Spinner label="Loading proof…" />;
  if (proof.mimeType === 'application/pdf') return <Notice tone="info">The proof is a PDF document ({proof.fileName}). Open it from the server attachments folder to review.</Notice>;
  return <img src={url} alt={`Payment proof submitted for reference ${proof.referenceNo}`} className="mx-auto max-h-[58vh] rounded border border-line object-contain" />;
}

function DuplicateWarning({ duplicates }: { duplicates: DuplicateReference[] }) {
  if (!duplicates.length) return null;
  const posted = duplicates.some((d) => d.kind === 'PAYMENT' && d.status === 'POSTED');
  return (
    <Notice tone={posted ? 'danger' : 'warning'} title={posted ? 'This reference number already backs a posted payment' : 'Possible duplicate reference'}>
      <ul className="mt-1 space-y-0.5">
        {duplicates.map((d) => (
          <li key={`${d.kind}-${d.id}`}>
            {d.kind === 'PAYMENT' ? `Receipt ${d.receiptNo}` : `Proof #${d.id}`} · {d.subscriberName} · {peso(d.amount)} · {date(d.date)} · <span className="font-medium">{d.status.toLowerCase()}</span>
          </li>
        ))}
      </ul>
      {posted && <p className="mt-1 font-medium">Verification is blocked. Reject this proof unless the earlier payment is reversed first.</p>}
    </Notice>
  );
}

function SubmitProofDialog({ open, onOpenChange, onSubmitted }: { open: boolean; onOpenChange: (open: boolean) => void; onSubmitted: (proof: ProofRow) => void }) {
  const [subscriber, setSubscriber] = useState<SubscriberRow | null>(null);
  const [referenceNo, setReferenceNo] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderNumber, setSenderNumber] = useState('');
  const [amount, setAmount] = useState<number | undefined>();
  const [transactionDate, setTransactionDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const ref = referenceNo.trim();
  const duplicates = useApi<DuplicateReference[]>(ref.length >= 6 ? '/gcash/check-reference' : null, { referenceNo: ref }).data ?? [];

  useEffect(() => {
    if (open) {
      setSubscriber(null);
      setReferenceNo('');
      setSenderName('');
      setSenderNumber('');
      setAmount(undefined);
      setTransactionDate(todayIso());
      setNotes('');
      setFile(null);
      setFieldErrors({});
    }
  }, [open]);

  const valid = subscriber && ref && senderName.trim() && senderNumber.trim() && amount && file;
  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setFieldErrors({});
    try {
      const proof = await api.post<ProofRow>('/gcash/proofs', { subscriberId: subscriber.id, referenceNo: ref, senderName: senderName.trim(), senderNumber: senderNumber.trim(), amount, transactionDate, notes: notes.trim() || undefined, file: await fileToUpload(file) });
      toast.success('GCash proof recorded for verification', { description: 'No payment has been posted yet.' });
      onSubmitted(proof);
      onOpenChange(false);
    } catch (err) {
      setFieldErrors((err as { fields?: Record<string, string> }).fields ?? {});
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record GCash proof"
      description="Enter the details from the screenshot the customer sent to the Facebook Page."
      size="md"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!valid} loading={busy} onClick={() => void submit()}>
            Submit for verification
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Notice tone="info">A screenshot is evidence to review. The account is credited only after an authorized verifier confirms the transaction.</Notice>
        <Field label="Subscriber" required>
          {subscriber ? (
            <div className="flex items-center justify-between rounded-md border border-line bg-slate-50 px-3 py-1.5 text-sm">
              <span>
                <strong>{subscriber.fullName}</strong> · {subscriber.accountNo} · balance {peso(subscriber.balance)}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setSubscriber(null)}>
                Change
              </Button>
            </div>
          ) : (
            <SubscriberPicker autoFocus onSelect={(s) => { setSubscriber(s); setSenderName((n) => n || s.fullName.split(', ').reverse().join(' ')); setSenderNumber((n) => n || s.phone); }} />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="GCash reference number" required error={fieldErrors.referenceNo}>
            <Input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} spellCheck={false} />
          </Field>
          <Field label="Amount" required error={fieldErrors.amount}>
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="Sender name" required error={fieldErrors.senderName}>
            <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} />
          </Field>
          <Field label="Sender GCash number" required error={fieldErrors.senderNumber}>
            <Input value={senderNumber} onChange={(e) => setSenderNumber(e.target.value)} />
          </Field>
          <Field label="Transaction date" required error={fieldErrors.transactionDate}>
            <Input type="date" max={todayIso()} value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} />
          </Field>
          <Field label="Proof image" required error={fieldErrors.file} hint="PNG, JPEG, WEBP or PDF up to 5 MB">
            <Input type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" className="py-1" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <DuplicateWarning duplicates={duplicates} />
      </div>
    </Dialog>
  );
}

const TABS = [
  { status: 'PENDING', label: 'Pending' },
  { status: 'VERIFIED', label: 'Verified' },
  { status: 'REJECTED', label: 'Rejected' },
];

/** Two-pane verification queue: list on the left, proof preview and decision on the right. */
export function GcashPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('PENDING');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [verifyNotes, setVerifyNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const queue = useApi<Paged<ProofRow>>('/gcash/proofs', { status, pageSize: 100 }, { refetchInterval: 30_000 });
  const rows = queue.data?.rows ?? [];
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null;
  useEffect(() => {
    setVerifyNotes('');
    setVerifyError(null);
  }, [selected?.id]);

  const blocked = !!selected?.duplicates.some((d) => d.kind === 'PAYMENT' && d.status === 'POSTED');
  const verify = async () => {
    if (!selected) return;
    setBusy(true);
    setVerifyError(null);
    try {
      const done = await api.post<ProofRow>(`/gcash/proofs/${selected.id}/verify`, { notes: verifyNotes.trim() || undefined });
      toast.success(`Verified and posted · Receipt ${done.receiptNo}`);
      await queryClient.invalidateQueries();
    } catch (err) {
      setVerifyError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="GCash Verification"
        description="Proofs are reviewed against the GCash transaction history before any payment is posted."
        actions={
          can('gcash.submit') && (
            <Button variant="primary" onClick={() => setSubmitting(true)}>
              <ImagePlus /> Record GCash proof
            </Button>
          )
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-5 gap-3">
        <Card className="col-span-2 flex min-h-0 flex-col">
          <div className="flex gap-1 border-b border-line p-2" role="tablist">
            {TABS.map((tab) => (
              <button
                key={tab.status}
                role="tab"
                aria-selected={status === tab.status}
                onClick={() => {
                  setStatus(tab.status);
                  setSelectedId(null);
                }}
                className={cn('rounded-md px-3 py-1 text-sm font-medium', status === tab.status ? 'bg-navy text-white' : 'text-slate-600 hover:bg-slate-100')}
              >
                {tab.label}
                {status === tab.status && queue.data ? ` (${queue.data.total})` : ''}
              </button>
            ))}
          </div>
          <ul className="min-h-0 flex-1 overflow-auto">
            {!queue.data && <Spinner />}
            {queue.data && rows.length === 0 && <EmptyState title={`No ${status.toLowerCase()} proofs`} description={status === 'PENDING' ? 'New proofs appear here as staff record them.' : undefined} />}
            {rows.map((proof) => (
              <li key={proof.id}>
                <button
                  onClick={() => setSelectedId(proof.id)}
                  className={cn('flex w-full items-start justify-between gap-3 border-b border-line px-3 py-2 text-left hover:bg-slate-50', selected?.id === proof.id && 'bg-accent-50 hover:bg-accent-50')}
                  aria-current={selected?.id === proof.id}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{proof.subscriberName}</span>
                    <span className="block truncate text-xs text-muted">
                      Ref {proof.referenceNo} · {date(proof.transactionDate)}
                    </span>
                    {proof.duplicates.length > 0 && (
                      <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-warning">
                        <AlertTriangle className="size-3" /> Duplicate reference
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <Money value={proof.amount} className="block font-semibold" />
                    <StatusBadge status={proof.status} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="col-span-3 flex min-h-0 flex-col">
          {!selected ? (
            <EmptyState title="Select a proof to review" />
          ) : (
            <>
              <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
                <div>
                  <h2 className="text-sm font-semibold">
                    {selected.subscriberName} <span className="font-normal text-muted">{selected.subscriberAccountNo}</span>
                  </h2>
                  <p className="text-xs text-muted">
                    Current balance {peso(selected.subscriberBalance)} ·{' '}
                    <Link to={`/subscribers/${selected.subscriberId}`} className="text-accent hover:underline">
                      Open profile
                    </Link>
                  </p>
                </div>
                <StatusBadge status={selected.status} />
              </header>
              <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 overflow-auto p-4">
                <div className="rounded-md bg-slate-100 p-2">
                  <ProofImage proof={selected} />
                </div>
                <div className="space-y-3">
                  <DescriptionList
                    columns={2}
                    items={[
                      ['Reference number', <span className="font-mono text-[13px]">{selected.referenceNo}</span>],
                      ['Amount claimed', <span className="text-base font-semibold">{peso(selected.amount)}</span>],
                      ['Sender name', selected.senderName],
                      ['Sender number', selected.senderNumber],
                      ['Transaction date', date(selected.transactionDate)],
                      ['Recorded by', `${selected.submittedByName ?? '—'} · ${dateTime(selected.submittedAt)}`],
                      ['Notes', selected.notes],
                      ['Proof file', selected.fileName],
                    ]}
                  />
                  <DuplicateWarning duplicates={selected.duplicates} />
                  {selected.status === 'VERIFIED' && (
                    <Notice tone="success" title={`Verified by ${selected.reviewedByName}`}>
                      {dateTime(selected.reviewedAt)} · posted as receipt {selected.receiptNo}
                    </Notice>
                  )}
                  {selected.status === 'REJECTED' && (
                    <Notice tone="danger" title={`Rejected by ${selected.reviewedByName}`}>
                      {dateTime(selected.reviewedAt)} · {selected.rejectionReason}
                    </Notice>
                  )}
                  {selected.status === 'PENDING' &&
                    (can('gcash.verify') ? (
                      <div className="space-y-2 rounded-md border border-line p-3">
                        <p className="text-sm font-medium">Verification</p>
                        <p className="text-xs text-muted">Confirm in the GCash app or merchant history that the reference number, amount and date match before verifying.</p>
                        <Field label="Verification notes">
                          <Input value={verifyNotes} onChange={(e) => setVerifyNotes(e.target.value)} placeholder="e.g. Matched in GCash transaction history" />
                        </Field>
                        {verifyError && <Notice tone="danger">{verifyError}</Notice>}
                        <div className="flex gap-2">
                          <Button variant="primary" className="flex-1" loading={busy} disabled={blocked} onClick={() => void verify()}>
                            <Check /> Verify and post {peso(selected.amount)}
                          </Button>
                          <Button variant="danger-outline" onClick={() => setRejecting(true)}>
                            <X /> Reject
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Notice tone="info">Waiting for an authorized verifier. Your role can record proofs but cannot verify them.</Notice>
                    ))}
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      <SubmitProofDialog
        open={submitting}
        onOpenChange={setSubmitting}
        onSubmitted={(proof) => {
          setStatus('PENDING');
          setSelectedId(proof.id);
          void queryClient.invalidateQueries();
        }}
      />
      {selected && (
        <ReasonDialog
          open={rejecting}
          onOpenChange={setRejecting}
          title="Reject this GCash proof?"
          description={`Ref ${selected.referenceNo} · ${peso(selected.amount)} · ${selected.subscriberName}`}
          confirmLabel="Reject proof"
          danger
          reasonLabel="Reason for rejection"
          onConfirm={async (reason) => {
            await api.post(`/gcash/proofs/${selected.id}/reject`, { reason });
            toast.success('Proof rejected. No payment was posted.');
            await queryClient.invalidateQueries();
          }}
        />
      )}
    </>
  );
}
