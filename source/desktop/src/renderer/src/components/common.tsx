import { statusLabel, type AreaRow, type CollectorRow, type NamedRef, type PlanRow, type SettingsMap, type SubscriberRow, type Paged } from '@bcis/shared';
import { Printer, Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { useApi } from '../lib/api';
import { peso } from '../lib/format';
import { Button, cn, Dialog, Field, Input, StatusBadge, Textarea } from './ui';

export interface Lookups {
  plans: PlanRow[];
  areas: AreaRow[];
  collectors: CollectorRow[];
  technicians: NamedRef[];
}
/** Dropdown data shared by most screens; cached for a minute. */
export function useLookups(): Lookups {
  const { data } = useApi<Lookups>('/lookups', undefined, { staleTime: 60_000 });
  return data ?? { plans: [], areas: [], collectors: [], technicians: [] };
}
export function useSettings(): SettingsMap | undefined {
  return useApi<SettingsMap>('/settings', undefined, { staleTime: 60_000 }).data;
}

export const Money = ({ value, className, zeroDash }: { value: number | null | undefined; className?: string; zeroDash?: boolean }) => (
  <span className={cn('num', value !== null && value !== undefined && value < 0 && 'text-success', className)}>{zeroDash && !value ? '—' : peso(value)}</span>
);

export const statusOptions = (statuses: readonly string[]) => statuses.map((s) => ({ value: s, label: statusLabel(s) }));

// ---------------------------------------------------------------- Subscriber search box
export function SubscriberPicker({ onSelect, autoFocus, placeholder = 'Search by name, account no., contact no. or address' }: { onSelect: (subscriber: SubscriberRow) => void; autoFocus?: boolean; placeholder?: string }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const term = text.trim();
  const { data } = useApi<Paged<SubscriberRow>>(term.length >= 2 ? '/subscribers' : null, { q: term, pageSize: 8 });
  const results = term.length >= 2 ? (data?.rows ?? []) : [];
  useEffect(() => {
    setActive(0);
  }, [term]);

  const choose = (subscriber: SubscriberRow) => {
    onSelect(subscriber);
    setText('');
    setOpen(false);
  };
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <Input
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        className="pl-8"
        aria-label="Find subscriber"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter' && results[active]) {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === 'Escape') setOpen(false);
          else return;
          if (e.key !== 'Enter') e.preventDefault();
        }}
      />
      {open && term.length >= 2 && (
        <ul className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-md border border-line bg-surface py-1 shadow-lg" role="listbox">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">{data ? 'No subscriber matches.' : 'Searching…'}</li>}
          {results.map((s, i) => (
            <li
              key={s.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(s)}
              onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm', i === active && 'bg-accent-50')}
            >
              <span className="min-w-0">
                <span className="font-medium">{s.fullName}</span> <span className="text-muted">{s.accountNo}</span>
                <span className="block truncate text-xs text-muted">
                  {s.phone} · {s.address}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="num block">{peso(s.balance)}</span>
                <StatusBadge status={s.status} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Confirmation with a mandatory reason
export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel, danger, reasonLabel = 'Reason', minLength = 5, onConfirm, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: ReactNode; confirmLabel: string; danger?: boolean; reasonLabel?: string; minLength?: number; onConfirm: (reason: string) => Promise<void>; children?: ReactNode }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const valid = reason.trim().length >= minLength;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={!valid}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(reason.trim());
                onOpenChange(false);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'The action failed.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {children}
        <Field label={reasonLabel} required hint={minLength > 0 ? 'Recorded in the audit trail.' : undefined}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus rows={3} />
        </Field>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Print preview
/**
 * Dedicated print layout. The sheet is rendered in a full-window overlay outside the
 * application shell; print CSS hides everything else, so paper never shows navigation.
 */
export function PrintPreview({ title, fileName, landscape, onClose, onPrinted, children }: { title: string; fileName: string; landscape?: boolean; onClose: () => void; onPrinted?: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="print-overlay fixed inset-0 z-[60] overflow-auto bg-slate-700/80 p-6" role="dialog" aria-label={title}>
      <div className="no-print sticky top-0 z-10 mx-auto mb-4 flex max-w-[210mm] items-center justify-between rounded-md bg-navy px-4 py-2 text-white shadow-lg">
        <span className="text-sm font-medium">{title}</span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              await window.bcis.print.print();
              onPrinted?.();
            }}
          >
            <Printer /> Print
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              const result = await window.bcis.print.savePdf({ suggestedName: fileName, landscape });
              if (result.saved) toast.success('PDF saved', { description: result.filePath });
              else if (result.error) toast.error(result.error);
            }}
          >
            Save as PDF
          </Button>
          <Button ref={closeRef} size="sm" variant="ghost" className="text-white hover:bg-white/15 hover:text-white" onClick={onClose} aria-label="Close preview">
            <X />
          </Button>
        </div>
      </div>
      <div className={cn('print-sheet mx-auto min-h-[120mm] p-[12mm] shadow-xl', landscape ? 'w-[297mm]' : 'w-[210mm]')}>{children}</div>
    </div>,
    document.body,
  );
}

export function PrintHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  const settings = useSettings();
  return (
    <header className="mb-4 flex items-start justify-between border-b-2 border-navy pb-2">
      <div>
        <p className="text-base font-bold text-navy">{String(settings?.['company.name'] ?? 'Bukidnon Cable and Internet Services')}</p>
        <p className="text-[10px] text-slate-600">
          {String(settings?.['company.address'] ?? '')} · {String(settings?.['company.phone'] ?? '')}
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-bold uppercase tracking-wide">{title}</p>
        {subtitle && <p className="text-[10px] text-slate-600">{subtitle}</p>}
        {right}
      </div>
    </header>
  );
}
