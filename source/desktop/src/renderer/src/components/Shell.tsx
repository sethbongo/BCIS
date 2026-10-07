import { ROLES, type Permission, type SearchResult } from '@bcis/shared';
import { BarChart3, Cable, FileText, KeyRound, LayoutDashboard, Lock, LogOut, Route as RouteIcon, Scale, Search, Settings, Users, Wallet, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, cn, Field, Input, Notice, StatusBadge } from './ui';

interface NavItem {
  label: string;
  to: string;
  permissions: Permission[];
}
interface NavGroup {
  label: string;
  icon: LucideIcon;
  to?: string;
  permissions?: Permission[];
  children?: NavItem[];
}

/** Navigation tree from section 4.2 of the brief. Items the user cannot use are not shown. */
export const NAVIGATION: NavGroup[] = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard', permissions: ['dashboard.view'] },
  {
    label: 'Subscribers',
    icon: Users,
    children: [
      { label: 'All Subscribers', to: '/subscribers', permissions: ['subscriber.view'] },
      { label: 'New Subscriber', to: '/subscribers/new', permissions: ['subscriber.create'] },
      { label: 'Service Accounts', to: '/service-accounts', permissions: ['service.view'] },
    ],
  },
  {
    label: 'Billing',
    icon: FileText,
    children: [
      { label: 'Current Billing', to: '/billing/current', permissions: ['billing.view'] },
      { label: 'Generate Billing', to: '/billing/generate', permissions: ['billing.generate'] },
      { label: 'Invoices', to: '/billing/invoices', permissions: ['billing.view'] },
    ],
  },
  {
    label: 'Payments',
    icon: Wallet,
    children: [
      { label: 'Receive Payment', to: '/payments/receive', permissions: ['payment.create'] },
      { label: 'Payment History', to: '/payments/history', permissions: ['payment.view'] },
      { label: 'GCash Verification', to: '/payments/gcash', permissions: ['gcash.submit', 'gcash.verify'] },
    ],
  },
  {
    label: 'Collections',
    icon: RouteIcon,
    children: [
      { label: 'Collectors', to: '/collections/collectors', permissions: ['collection.view'] },
      { label: 'Areas & Routes', to: '/collections/areas', permissions: ['collection.view'] },
      { label: 'Collection Batches', to: '/collections/batches', permissions: ['collection.view'] },
      { label: 'Remittance', to: '/collections/remittance', permissions: ['collection.view'] },
    ],
  },
  {
    label: 'Receivables',
    icon: Scale,
    children: [
      { label: 'Outstanding', to: '/receivables/outstanding', permissions: ['receivable.view'] },
      { label: 'Overdue', to: '/receivables/overdue', permissions: ['receivable.view'] },
      { label: 'Aging', to: '/receivables/aging', permissions: ['receivable.view'] },
      { label: 'Suspension Candidates', to: '/receivables/suspension', permissions: ['receivable.view'] },
    ],
  },
  { label: 'Services', icon: Cable, to: '/services', permissions: ['service.view', 'plan.view'] },
  { label: 'Reports', icon: BarChart3, to: '/reports', permissions: ['report.view'] },
  { label: 'Administration', icon: Settings, to: '/admin', permissions: ['user.manage', 'settings.manage', 'audit.view', 'backup.create'] },
];

/** First screen the signed-in user is allowed to open. */
export function homePath(can: (...p: Permission[]) => boolean): string {
  // Cashiers go straight to their main task.
  if (!can('dashboard.view') && can('payment.create')) return '/payments/receive';
  for (const group of NAVIGATION) {
    if (group.to && can(...(group.permissions ?? []))) return group.to;
    const child = group.children?.find((c) => can(...c.permissions));
    if (child) return child.to;
  }
  return '/account';
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn('flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors', isActive ? 'bg-white/12 font-medium text-white' : 'text-slate-300 hover:bg-white/6 hover:text-white');

function Sidebar() {
  const { can } = useAuth();
  return (
    <aside className="flex w-56 shrink-0 flex-col bg-navy text-white">
      <div className="flex h-12 items-center gap-2.5 border-b border-white/10 px-4">
        <span className="flex size-7 items-center justify-center rounded bg-accent text-[11px] font-bold tracking-tight">BC</span>
        <div className="leading-tight">
          <p className="text-sm font-semibold">BCIS</p>
          <p className="text-[10px] text-slate-300">Billing &amp; Collection</p>
        </div>
      </div>
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-3" aria-label="Main navigation">
        {NAVIGATION.map((group) => {
          const Icon = group.icon;
          if (group.to) {
            if (!can(...(group.permissions ?? []))) return null;
            return (
              <NavLink key={group.label} to={group.to} className={linkClass}>
                <Icon className="size-4 shrink-0" /> {group.label}
              </NavLink>
            );
          }
          const children = group.children!.filter((c) => can(...c.permissions));
          if (!children.length) return null;
          return (
            <div key={group.label} className="pt-2">
              <p className="flex items-center gap-2 px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <Icon className="size-3.5" /> {group.label}
              </p>
              {children.map((child) => (
                <NavLink key={child.to} to={child.to} end={child.to === '/subscribers'} className={(s) => cn(linkClass(s), 'ml-3.5 border-l border-white/10 pl-3')}>
                  {child.label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <ServerStatus />
    </aside>
  );
}

function ServerStatus() {
  const [server, setServer] = useState('');
  useEffect(() => {
    void window.bcis.config.get().then((c) => setServer(c.serverUrl.replace(/^https?:\/\//, '')));
  }, []);
  return (
    <div className="border-t border-white/10 px-4 py-2 text-[11px] text-slate-400">
      <p className="truncate">Server: {server}</p>
    </div>
  );
}

const RESULT_LABEL: Record<SearchResult['kind'], string> = { SUBSCRIBER: 'Subscriber', SERVICE_ACCOUNT: 'Service account', INVOICE: 'Invoice', RECEIPT: 'Receipt', GCASH: 'GCash reference' };

/** Global search: account no., name, contact, address, receipt no., invoice no. and GCash reference. Ctrl+K focuses it. */
function GlobalSearch() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const term = text.trim();
  const { data, isFetching } = useApi<SearchResult[]>(term.length >= 2 ? '/search' : null, { q: term });
  const results = term.length >= 2 ? (data ?? []) : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    setActive(0);
  }, [term]);

  const go = (r: SearchResult) => {
    if (r.kind === 'SUBSCRIBER') navigate(`/subscribers/${r.id}`);
    else if (r.kind === 'SERVICE_ACCOUNT') navigate(`/subscribers/${r.subscriberId}?tab=services`);
    else if (r.kind === 'INVOICE') navigate(`/billing/invoices?open=${r.id}`);
    else navigate(`/payments/history?open=${r.id}`);
    setText('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="relative w-[26rem]">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <Input
        ref={inputRef}
        value={text}
        placeholder="Search account, name, contact, address, invoice, receipt, GCash ref…"
        aria-label="Global search"
        className="bg-slate-50 pl-8 pr-14"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter' && results[active]) go(results[active]);
          else if (e.key === 'Escape') inputRef.current?.blur();
          else return;
          e.preventDefault();
        }}
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line bg-surface px-1 text-[10px] text-muted">Ctrl K</kbd>
      {open && term.length >= 2 && (
        <ul className="absolute z-40 mt-1 max-h-[28rem] w-full overflow-auto rounded-md border border-line bg-surface py-1 shadow-lg" role="listbox">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">{isFetching ? 'Searching…' : 'Nothing matches that search.'}</li>}
          {results.map((r, i) => (
            <li
              key={`${r.kind}-${r.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(r)}
              onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5', i === active && 'bg-accent-50')}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{r.title}</span>
                <span className="block truncate text-xs text-muted">
                  {RESULT_LABEL[r.kind]} · {r.subtitle}
                </span>
              </span>
              <StatusBadge status={r.badge} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TopBar() {
  const { user, logout, lock } = useAuth();
  const navigate = useNavigate();
  const roleNames = user?.roles.map((code) => ROLES.find((r) => r.code === code)?.name ?? code).join(', ');
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-4">
      <GlobalSearch />
      <div className="flex items-center gap-1">
        <div className="mr-2 text-right leading-tight">
          <p className="text-sm font-medium text-ink">{user?.fullName}</p>
          <p className="text-[11px] text-muted">{roleNames}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/account')} title="Change password">
          <KeyRound /> Account
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void lock()} title="Lock this session">
          <Lock /> Lock
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void logout()} title="Sign out">
          <LogOut /> Sign out
        </Button>
      </div>
    </header>
  );
}

function LockScreen() {
  const { user, unlock, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(await unlock(password));
    setPassword('');
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-navy-900/95" role="dialog" aria-label="Session locked">
      <form onSubmit={submit} className="w-80 rounded-lg bg-surface p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-accent-50 text-accent">
            <Lock className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">Session locked</p>
            <p className="text-xs text-muted">{user?.fullName}</p>
          </div>
        </div>
        <Field label="Password" required>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
        </Field>
        {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
        <div className="mt-4 flex gap-2">
          <Button type="submit" variant="primary" className="flex-1" loading={busy} disabled={!password}>
            Unlock
          </Button>
          <Button onClick={() => void logout()}>Sign out</Button>
        </div>
      </form>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { locked } = useAuth();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // scrollTo() returns a Promise in current Chromium; an effect must not return it.
    void mainRef.current?.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main ref={mainRef} className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
          {children}
        </main>
      </div>
      {locked && <LockScreen />}
    </div>
  );
}

/** Page-level guard. The API enforces the same permission; this only avoids showing a broken screen. */
export function Guard({ permissions, children }: { permissions: Permission[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(...permissions)) {
    return (
      <Notice tone="warning" title="You do not have access to this screen">
        Your role does not include the permission required here. Ask the owner if you need access.
      </Notice>
    );
  }
  return <>{children}</>;
}
