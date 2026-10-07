/** Design-system primitives in the shadcn/ui style: Radix behaviour + Tailwind tokens, owned by this codebase. */
import { parseMoney, centavosToDecimalString, statusLabel } from '@bcis/shared';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

// ---------------------------------------------------------------- Button
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white hover:bg-accent-600',
        navy: 'bg-navy text-white hover:bg-navy-600',
        secondary: 'border border-line-strong bg-surface text-ink hover:bg-slate-50',
        ghost: 'text-slate-600 hover:bg-slate-100 hover:text-ink',
        danger: 'bg-danger text-white hover:bg-red-700',
        'danger-outline': 'border border-red-200 bg-surface text-danger hover:bg-red-50',
      },
      size: { sm: 'h-7 px-2.5 text-xs', md: 'h-8.5 px-3.5 text-sm', lg: 'h-10 px-5 text-sm' },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, disabled, type = 'button', ...props }, ref) => (
  <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
    {loading && <Loader2 className="animate-spin" />}
    {children}
  </button>
));
Button.displayName = 'Button';

// ---------------------------------------------------------------- Form controls
const control = 'h-8.5 w-full rounded-md border border-line-strong bg-surface px-2.5 text-sm text-ink placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-muted aria-[invalid=true]:border-danger';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} className={cn(control, className)} {...props} />);
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(control, 'pr-7', className)} {...props}>
    {children}
  </select>
));
Select.displayName = 'Select';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(control, 'h-auto min-h-16 py-1.5', className)} {...props} />
));
Textarea.displayName = 'Textarea';

/** Labelled field with a required marker and inline validation message. */
export function Field({ label, required, error, hint, children, className }: { label: string; required?: boolean; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-xs font-medium text-slate-700">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" title="Required">
            *
          </span>
        )}
      </span>
      {children}
      {error ? (
        <span role="alert" className="mt-1 block text-xs text-danger">
          {error}
        </span>
      ) : (
        hint && <span className="mt-1 block text-xs text-muted">{hint}</span>
      )}
    </label>
  );
}

/**
 * Peso amount input. The user types pesos ("999.50"); the form value is integer
 * centavos (99950) or undefined while the text is not a valid amount.
 */
export function MoneyInput({ value, onChange, className, autoFocus, disabled, invalid, id }: { value: number | undefined | null; onChange: (centavos: number | undefined) => void; className?: string; autoFocus?: boolean; disabled?: boolean; invalid?: boolean; id?: string }) {
  const [text, setText] = useState(value || value === 0 ? centavosToDecimalString(value) : '');
  useEffect(() => {
    const current = parseMoney(text);
    if ((value ?? null) !== (current ?? null)) setText(value || value === 0 ? centavosToDecimalString(value) : '');
    // Only react to outside changes of the form value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted">₱</span>
      <input
        id={id}
        inputMode="decimal"
        autoFocus={autoFocus}
        disabled={disabled}
        aria-invalid={invalid}
        className={cn(control, 'num pl-6', className)}
        value={text}
        placeholder="0.00"
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseMoney(e.target.value);
          onChange(parsed === null || parsed < 0 ? undefined : parsed);
        }}
        onBlur={() => {
          const parsed = parseMoney(text);
          if (parsed !== null && parsed >= 0) setText(centavosToDecimalString(parsed));
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- Surfaces
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('rounded-lg border border-line bg-surface', className)}>{children}</section>;
}

export function CardHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
        {description && <p className="truncate text-xs text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold leading-tight text-ink">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const noticeStyles = {
  info: { box: 'border-blue-200 bg-accent-50 text-slate-800', icon: <Info className="text-accent" /> },
  success: { box: 'border-emerald-200 bg-emerald-50 text-slate-800', icon: <CheckCircle2 className="text-success" /> },
  warning: { box: 'border-amber-200 bg-amber-50 text-slate-800', icon: <AlertTriangle className="text-warning" /> },
  danger: { box: 'border-red-200 bg-red-50 text-slate-800', icon: <XCircle className="text-danger" /> },
};
export function Notice({ tone = 'info', title, children, className }: { tone?: keyof typeof noticeStyles; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-2.5 rounded-md border px-3 py-2 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0', noticeStyles[tone].box, className)}>
      {noticeStyles[tone].icon}
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? 'text-slate-600' : ''}>{children}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Status badge (text + colour, never colour alone)
type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const TONES: Record<Tone, string> = {
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-600/25',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/30',
  danger: 'bg-red-50 text-red-700 ring-red-600/25',
  info: 'bg-accent-50 text-blue-800 ring-blue-600/25',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-500/25',
};
const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'success', PAID: 'success', POSTED: 'success', ISSUED: 'success', VERIFIED: 'success', COMPLETED: 'success', CLOSED: 'neutral', BALANCED: 'success', COLLECTED: 'success', RECONCILED: 'success',
  UNPAID: 'info', OPEN: 'info', IN_PROGRESS: 'info', SUBMITTED: 'info', REMITTED: 'info', REQUESTED: 'info', DRAFT: 'neutral', PENDING: 'warning', PARTIALLY_PAID: 'warning', PARTIAL: 'warning', PROMISED: 'warning', NOT_HOME: 'warning', OVERAGE: 'warning', SUSPENDED: 'warning',
  OVERDUE: 'danger', REVERSED: 'danger', REJECTED: 'danger', FAILED: 'danger', SHORTAGE: 'danger', REFUSED: 'danger', DISCONNECTED: 'danger',
  VOID: 'neutral', CREDITED: 'neutral', INACTIVE: 'neutral', TERMINATED: 'neutral', ARCHIVED: 'neutral', CANCELLED: 'neutral', LIFTED: 'neutral',
};
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium leading-4 ring-1 ring-inset', TONES[tone], className)}>{children}</span>;
}
export function StatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  if (!status) return <span className="text-muted">—</span>;
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{label ?? statusLabel(status)}</Badge>;
}

// ---------------------------------------------------------------- Dialog
export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md' }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="no-print fixed inset-0 z-40 bg-slate-900/40" />
        <DialogPrimitive.Content className={cn('no-print fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line bg-surface shadow-xl', width)}>
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold text-ink">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className={cn('text-sm text-muted', !description && 'sr-only')}>{description ?? title}</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="rounded p-1 text-muted hover:bg-slate-100 hover:text-ink" aria-label="Close">
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex items-center justify-end gap-2 border-t border-line bg-slate-50/60 px-5 py-3">{footer}</footer>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------------------------------------------------------------- Tabs
export const Tabs = TabsPrimitive.Root;
export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return <TabsPrimitive.List className={cn('flex gap-1 border-b border-line', className)}>{children}</TabsPrimitive.List>;
}
export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted hover:text-ink data-[state=active]:border-accent data-[state=active]:text-accent"
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}
export const TabsContent = TabsPrimitive.Content;

// ---------------------------------------------------------------- Small display helpers
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'danger' | 'success' | 'warning' }) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-ink';
  return (
    <div className="min-w-0">
      <p className="truncate text-xs font-medium text-muted">{label}</p>
      <p className={cn('mt-0.5 truncate text-lg font-semibold leading-6', color)}>{value}</p>
      {sub && <p className="truncate text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function DescriptionList({ items, columns = 2 }: { items: [string, ReactNode][]; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-2.5', columns === 3 ? 'grid-cols-3' : columns === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
      {items.map(([term, value]) => (
        <div key={term} className="min-w-0">
          <dt className="text-xs text-muted">{term}</dt>
          <dd className="break-words text-sm text-ink">{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Simple static table for detail views (server-paged lists use DataTable). */
export function SimpleTable({ head, rows, empty = 'No records.', foot }: { head: { label: string; num?: boolean; className?: string }[]; rows: ReactNode[][]; empty?: string; foot?: ReactNode[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-slate-50 text-left text-xs font-medium text-slate-600">
            {head.map((h) => (
              <th key={h.label} className={cn('px-3 py-2 font-medium', h.num && 'text-right', h.className)}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={head.length} className="px-3 py-6 text-center text-muted">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {row.map((cell, j) => (
                <td key={j} className={cn('px-3 py-1.5 align-top', head[j]?.num && 'num')}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot && (
          <tfoot>
            <tr className="border-t border-line-strong bg-slate-50 font-semibold">
              {foot.map((cell, j) => (
                <td key={j} className={cn('px-3 py-2', head[j]?.num && 'num')}>
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
