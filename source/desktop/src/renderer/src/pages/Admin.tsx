import { ALL_PERMISSIONS, PERMISSIONS, ROLES, SETTING_DEFS, type AuditRow, type BackupRow, type IntegrityReport, type RestoreResult, type RoleCode, type RoleRow, type SettingsMap, type UserRow } from '@bcis/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Check, DatabaseBackup, KeyRound, Minus, Pencil, Plus, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { DataTable, FilterSelect, type Column } from '../components/DataTable';
import { Button, Card, CardHeader, cn, Dialog, Field, Input, MoneyInput, Notice, PageHeader, SimpleTable, Spinner, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui';
import { api, ApiError, errorMessage, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';

// ---------------------------------------------------------------- Users
function UserDialog({ user, onClose }: { user: UserRow | 'new' | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ username: '', fullName: '', email: '', password: '', roleCodes: [] as RoleCode[], isActive: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const isNew = user === 'new';
  useEffect(() => {
    setErrors({});
    if (user === 'new') setForm({ username: '', fullName: '', email: '', password: '', roleCodes: [], isActive: true });
    else if (user) setForm({ username: user.username, fullName: user.fullName, email: user.email ?? '', password: '', roleCodes: user.roles, isActive: user.isActive });
  }, [user]);
  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      if (isNew) await api.post('/users', form);
      else if (user) await api.patch(`/users/${user.id}`, { fullName: form.fullName, email: form.email, roleCodes: form.roleCodes, isActive: form.isActive });
      toast.success(isNew ? `User ${form.username} created` : 'User updated');
      await queryClient.invalidateQueries();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={user !== null}
      onOpenChange={(open) => !open && onClose()}
      title={isNew ? 'New user' : `Edit ${form.username}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!form.fullName.trim() || !form.roleCodes.length || (isNew && (!form.username || !form.password))} onClick={() => void save()}>
            Save user
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Username" required error={errors.username}>
          <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} disabled={!isNew} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Full name" required error={errors.fullName}>
          <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </Field>
        <Field label="Email" error={errors.email}>
          <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        {isNew && (
          <Field label="Initial password" required error={errors.password} hint="At least 10 characters with upper-case, lower-case and a number">
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
          </Field>
        )}
        <fieldset className="col-span-2">
          <legend className="mb-1 text-xs font-medium text-slate-700">
            Roles <span className="text-danger">*</span>
          </legend>
          <div className="grid grid-cols-2 gap-1 rounded-md border border-line p-2">
            {ROLES.map((role) => (
              <label key={role.code} className="flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50" title={role.description}>
                <input type="checkbox" className="mt-0.5" checked={form.roleCodes.includes(role.code)} onChange={(e) => setForm({ ...form, roleCodes: e.target.checked ? [...form.roleCodes, role.code] : form.roleCodes.filter((c) => c !== role.code) })} />
                <span>
                  {role.name}
                  <span className="block text-xs text-muted">{role.description}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.roleCodes && <p className="mt-1 text-xs text-danger">{errors.roleCodes}</p>}
        </fieldset>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active (inactive users cannot sign in and are signed out immediately)
        </label>
      </div>
    </Dialog>
  );
}

function UsersTab() {
  const users = useApi<UserRow[]>('/users').data;
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const roleName = (code: RoleCode) => ROLES.find((r) => r.code === code)?.name ?? code;
  const reset = async () => {
    if (!resetting) return;
    setBusy(true);
    try {
      await api.post(`/users/${resetting.id}/reset-password`, { newPassword: password });
      toast.success(`Password reset for ${resetting.username}. Their sessions were signed out.`);
      setResetting(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Users" description="Accounts and their role assignments" actions={<Button size="sm" variant="primary" onClick={() => setEditing('new')}><Plus /> New User</Button>} />
      {!users ? <Spinner /> : (
        <SimpleTable
          head={[{ label: 'Username' }, { label: 'Full name' }, { label: 'Roles' }, { label: 'Last sign-in' }, { label: 'Status' }, { label: '' }]}
          rows={users.map((u) => [
            <span className="font-medium">{u.username}</span>,
            u.fullName,
            u.roles.map(roleName).join(', '),
            <span className="text-xs text-muted">{dateTime(u.lastLoginAt)}</span>,
            <span className="flex gap-1"><StatusBadge status={u.isActive ? 'ACTIVE' : 'INACTIVE'} />{u.lockedUntil && new Date(u.lockedUntil) > new Date() && <StatusBadge status="SUSPENDED" label="Locked out" />}</span>,
            <span className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(u)}><Pencil /> Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => { setResetting(u); setPassword(''); }}><KeyRound /> Reset password</Button>
            </span>,
          ])}
        />
      )}
      <UserDialog user={editing} onClose={() => setEditing(null)} />
      <Dialog
        open={resetting !== null}
        onOpenChange={(open) => !open && setResetting(null)}
        title={`Reset password for ${resetting?.username ?? ''}`}
        size="sm"
        footer={<><Button onClick={() => setResetting(null)}>Cancel</Button><Button variant="primary" loading={busy} disabled={password.length < 10} onClick={() => void reset()}>Reset password</Button></>}
      >
        <Field label="New password" required hint="At least 10 characters with upper-case, lower-case and a number. Tell the user in person; it is not shown again.">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="new-password" />
        </Field>
      </Dialog>
    </Card>
  );
}

function RolesTab() {
  const roles = useApi<RoleRow[]>('/roles').data;
  if (!roles) return <Spinner />;
  const modules = [...new Set(ALL_PERMISSIONS.map((p) => p.split('.')[0]))];
  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader title="Role and permission matrix" description="Enforced by the server on every request. The matrix is defined in code and loaded by the base seed." />
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 border-b border-line bg-slate-50 px-3 py-2 text-left text-xs font-medium text-slate-600">Permission</th>
              {roles.map((r) => (
                <th key={r.code} className="sticky top-0 z-10 border-b border-line bg-slate-50 px-2 py-2 text-center text-xs font-medium text-slate-600">
                  {r.name}
                  <span className="block font-normal text-muted">{r.userCount} user{r.userCount === 1 ? '' : 's'}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((module) => (
              <>
                <tr key={module}>
                  <td colSpan={roles.length + 1} className="border-b border-line bg-slate-50/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{module}</td>
                </tr>
                {ALL_PERMISSIONS.filter((p) => p.startsWith(`${module}.`)).map((permission) => (
                  <tr key={permission}>
                    <td className="sticky left-0 border-b border-line bg-surface px-3 py-1.5">
                      <span className="font-mono text-xs">{permission}</span>
                      <span className="block text-xs text-muted">{PERMISSIONS[permission]}</span>
                    </td>
                    {roles.map((r) => {
                      const allowed = r.permissions.includes(permission);
                      return (
                        <td key={r.code} className="border-b border-line px-2 py-1.5 text-center">
                          {allowed ? <Check className="mx-auto size-4 text-success" aria-label="Allowed" /> : <Minus className="mx-auto size-3.5 text-slate-300" aria-label="Not allowed" />}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Settings
function SettingsTab() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const settings = useApi<SettingsMap>('/settings').data;
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (settings) setValues(settings);
  }, [settings]);
  if (!settings) return <Spinner />;
  const editable = can('settings.manage');
  const groups = [...new Set(SETTING_DEFS.map((d) => d.group))];
  const dirty = SETTING_DEFS.some((d) => values[d.key] !== settings[d.key]);
  const save = async () => {
    setBusy(true);
    try {
      await api.put('/settings', { values: Object.fromEntries(SETTING_DEFS.filter((d) => values[d.key] !== settings[d.key]).map((d) => [d.key, values[d.key]])) });
      toast.success('Settings saved');
      await queryClient.invalidateQueries();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Application settings" description={editable ? 'Changes are audited and apply immediately on all office PCs.' : 'Only the owner can change settings.'} actions={editable && <Button variant="primary" size="sm" loading={busy} disabled={!dirty} onClick={() => void save()}>Save settings</Button>} />
      <fieldset disabled={!editable} className="divide-y divide-line">
        {groups.map((group) => (
          <div key={group} className="grid grid-cols-[12rem_1fr] gap-4 px-4 py-4">
            <h3 className="text-sm font-semibold">{group}</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {SETTING_DEFS.filter((d) => d.group === group).map((def) =>
                def.type === 'boolean' ? (
                  <label key={def.key} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5" checked={Boolean(values[def.key])} onChange={(e) => setValues({ ...values, [def.key]: e.target.checked })} />
                    <span>{def.label}<span className="block text-xs text-muted">{def.description}</span></span>
                  </label>
                ) : (
                  <Field key={def.key} label={def.label} hint={def.description}>
                    {def.type === 'money' ? (
                      <MoneyInput value={Number(values[def.key] ?? 0)} onChange={(v) => setValues({ ...values, [def.key]: v ?? 0 })} disabled={!editable} />
                    ) : def.type === 'int' ? (
                      <Input type="number" value={String(values[def.key] ?? '')} min={'min' in def ? def.min : undefined} max={'max' in def ? def.max : undefined} onChange={(e) => setValues({ ...values, [def.key]: Number(e.target.value) })} />
                    ) : (
                      <Input value={String(values[def.key] ?? '')} onChange={(e) => setValues({ ...values, [def.key]: e.target.value })} />
                    )}
                  </Field>
                ),
              )}
            </div>
          </div>
        ))}
      </fieldset>
    </Card>
  );
}

// ---------------------------------------------------------------- Audit log
function AuditTab() {
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const columns: Column<AuditRow>[] = [
    { accessorKey: 'at', header: 'Date / time', cell: (c) => <span className="whitespace-nowrap">{dateTime(c.row.original.at)}</span> },
    { accessorKey: 'actorUsername', header: 'User', cell: (c) => c.row.original.actorUsername ?? <span className="text-muted">(system)</span> },
    { accessorKey: 'action', header: 'Action', cell: (c) => <span className="font-mono text-xs">{c.row.original.action}</span> },
    { id: 'record', header: 'Record', enableSorting: false, cell: (c) => `${c.row.original.entityType}${c.row.original.entityId ? ` #${c.row.original.entityId}` : ''}`, csv: (r) => `${r.entityType} ${r.entityId ?? ''}` },
    { accessorKey: 'reason', header: 'Reason', enableSorting: false, cell: (c) => <span className="line-clamp-1">{c.row.original.reason}</span> },
    { accessorKey: 'ip', header: 'Client IP', enableSorting: false },
  ];
  return (
    <>
      <DataTable<AuditRow>
        endpoint="/audit-logs"
        columns={columns}
        params={{ entityType, from, to }}
        searchPlaceholder="Action, user, reason, record id…"
        exportName="audit-log"
        onRowClick={setDetail}
        filters={
          <>
            <FilterSelect label="Record type" value={entityType} onChange={setEntityType} options={['payment', 'invoice', 'payment_proof', 'collection_batch', 'subscriber', 'service_account', 'billing_cycle', 'user', 'setting', 'backup', 'report'].map((v) => ({ value: v, label: v.replace('_', ' ') }))} />
            <Input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" />
            <span className="text-xs text-muted">to</span>
            <Input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" />
          </>
        }
      />
      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)} title={detail?.action ?? ''} description={detail ? `${dateTime(detail.at)} · ${detail.actorUsername ?? '(system)'} · ${detail.entityType} #${detail.entityId ?? ''}` : undefined} size="lg">
        {detail && (
          <div className="space-y-3">
            {detail.reason && <Notice tone="info" title="Reason">{detail.reason}</Notice>}
            <div className="grid grid-cols-2 gap-3">
              {(['oldValues', 'newValues'] as const).map((side) => (
                <div key={side}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{side === 'oldValues' ? 'Before' : 'After'}</p>
                  <pre className="max-h-80 overflow-auto rounded-md border border-line bg-slate-50 p-2.5 text-xs">{detail[side] ? JSON.stringify(detail[side], null, 2) : '—'}</pre>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted">Audit records are append-only. They cannot be edited or deleted from the application, and the database rejects any attempt to change them.</p>
          </div>
        )}
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------- Backup, restore, integrity
function BackupTab() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const backups = useApi<BackupRow[]>('/backups').data;
  const [busy, setBusy] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<BackupRow | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);

  const run = async (label: string, action: () => Promise<string | void>) => {
    setBusy(label);
    try {
      const message = await action();
      if (message) toast.success(message);
      await queryClient.invalidateQueries();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const size = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  const shown = result?.integrity ?? integrity;

  return (
    <div className="space-y-3">
      {result && (
        <Notice tone={result.integrity.ok ? 'success' : 'danger'} title={`Database restored from ${result.restoredFrom}`}>
          Integrity check {result.integrity.ok ? 'passed' : 'FAILED'}. Other users must sign in again. A safety backup of the previous state was created automatically.
        </Notice>
      )}
      <Card>
        <CardHeader
          title="Backups"
          description="Each backup holds a PostgreSQL dump, a copy of the payment-proof attachments and a checksum manifest, stored on the server PC."
          actions={
            can('backup.create') && (
              <Button variant="primary" size="sm" loading={busy === 'create'} onClick={() => void run('create', async () => `Backup ${(await api.post<BackupRow>('/backups', {})).name} created`)}>
                <DatabaseBackup /> Create backup now
              </Button>
            )
          }
        />
        {!backups ? <Spinner /> : (
          <SimpleTable
            head={[{ label: 'Type' }, { label: 'Name' }, { label: 'Created' }, { label: 'By' }, { label: 'Size', num: true }, { label: 'Status' }, { label: 'Verification / result' }, { label: '' }]}
            rows={backups.map((b) => [
              b.kind === 'BACKUP' ? 'Backup' : 'Restore',
              <span className="font-mono text-xs">{b.name}</span>,
              <span className="whitespace-nowrap">{dateTime(b.createdAt)}</span>,
              b.createdByName,
              b.kind === 'BACKUP' ? size(b.sizeBytes) : '',
              <StatusBadge status={b.status} />,
              <span className="text-xs text-slate-600">{b.verificationResult ?? b.notes}</span>,
              b.kind === 'BACKUP' && b.available && (
                <span className="flex justify-end gap-1">
                  {can('backup.create') && <Button size="sm" variant="ghost" loading={busy === `verify-${b.id}`} onClick={() => void run(`verify-${b.id}`, async () => { const v = await api.post<BackupRow>(`/backups/${b.id}/verify`); return v.status === 'VERIFIED' ? 'Backup verified' : undefined; })}>Verify</Button>}
                  {can('backup.restore') && <Button size="sm" variant="danger-outline" onClick={() => { setRestoring(b); setConfirmation(''); setReason(''); }}>Restore…</Button>}
                </span>
              ),
            ])}
            empty="No backups yet. Create one before making major changes."
          />
        )}
      </Card>

      <Card>
        <CardHeader
          title="Financial integrity check"
          description="Independent cross-checks of invoices, payments, allocations, receipts and ledger balances."
          actions={<Button size="sm" loading={busy === 'integrity'} onClick={() => void run('integrity', async () => setIntegrity(await api.get<IntegrityReport>('/integrity-check')))}><ShieldCheck /> Run check</Button>}
        />
        {shown ? (
          <>
            <div className="px-4 pt-3">
              <Notice tone={shown.ok ? 'success' : 'danger'} title={shown.ok ? 'All checks passed' : 'One or more checks failed'}>Checked {dateTime(shown.checkedAt)}</Notice>
            </div>
            <SimpleTable
              head={[{ label: 'Check' }, { label: 'Rule' }, { label: 'Result' }, { label: 'Violations', num: true }]}
              rows={shown.checks.map((c) => [<span className="font-medium">{c.name}</span>, <span className="text-slate-600">{c.description}</span>, <StatusBadge status={c.ok ? 'VERIFIED' : 'FAILED'} label={c.ok ? 'Passed' : 'Failed'} />, c.violations])}
            />
          </>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted">Run the check to verify that every ledger balance reconciles to invoices and payments.</p>
        )}
      </Card>

      <Dialog
        open={restoring !== null}
        onOpenChange={(open) => !open && setRestoring(null)}
        title="Restore database from backup"
        description={restoring ? `${restoring.name} · created ${dateTime(restoring.createdAt)}` : undefined}
        size="sm"
        footer={
          <>
            <Button onClick={() => setRestoring(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={busy === 'restore'}
              disabled={confirmation !== 'RESTORE' || reason.trim().length < 5}
              onClick={() =>
                void run('restore', async () => {
                  const restored = await api.post<RestoreResult>(`/backups/${restoring!.id}/restore`, { confirmation, reason: reason.trim() });
                  setResult(restored);
                  setRestoring(null);
                  return 'Restore completed';
                })
              }
            >
              Restore database
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Notice tone="danger" title="This replaces all current data">
            Everything entered after this backup was taken will be removed from the live database. The backup is verified first, a safety backup of the current state is taken automatically, and the restore runs in a single transaction: it either completes fully or changes nothing.
          </Notice>
          <Field label="Reason for restoring" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
          <Field label="Type RESTORE to confirm" required>
            <Input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} spellCheck={false} />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

export function AdminPage() {
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabs = [
    { value: 'users', label: 'Users', show: can('user.manage') },
    { value: 'roles', label: 'Roles & Permissions', show: can('user.manage') },
    { value: 'settings', label: 'Settings', show: can('settings.manage') },
    { value: 'audit', label: 'Audit Log', show: can('audit.view') },
    { value: 'backup', label: 'Backup & Restore', show: can('backup.create', 'backup.restore') },
  ].filter((t) => t.show);
  const tab = tabs.find((t) => t.value === searchParams.get('tab'))?.value ?? tabs[0]?.value;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Administration" description="Users, configuration, audit trail and backups." />
      <Tabs value={tab} onValueChange={(value) => setSearchParams({ tab: value }, { replace: true })} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mb-3">
          {tabs.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
        </TabsList>
        {can('user.manage') && <TabsContent value="users"><UsersTab /></TabsContent>}
        {can('user.manage') && <TabsContent value="roles" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"><RolesTab /></TabsContent>}
        {can('settings.manage') && <TabsContent value="settings"><SettingsTab /></TabsContent>}
        {can('audit.view') && <TabsContent value="audit" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"><AuditTab /></TabsContent>}
        {can('backup.create', 'backup.restore') && <TabsContent value="backup"><BackupTab /></TabsContent>}
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------- My account
export function AccountPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) return setErrors({ confirm: 'The passwords do not match' });
    setBusy(true);
    setErrors({});
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      toast.success('Password changed. Other sessions of this account were signed out.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto w-full max-w-xl">
      <PageHeader title="My Account" description={`${user?.fullName} · ${user?.username}`} />
      <Card>
        <CardHeader title="Roles and permissions" />
        <div className="px-4 py-3 text-sm">
          <p className="mb-2">{user?.roles.map((code) => ROLES.find((r) => r.code === code)?.name ?? code).join(', ')}</p>
          <div className="flex flex-wrap gap-1">
            {user?.permissions.slice().sort().map((p) => <span key={p} className={cn('rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700')} title={PERMISSIONS[p]}>{p}</span>)}
          </div>
        </div>
      </Card>
      <Card className="mt-3">
        <CardHeader title="Change password" />
        <form onSubmit={submit} className="space-y-3 p-4">
          <Field label="Current password" required error={errors.currentPassword}>
            <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="New password" required error={errors.newPassword} hint="At least 10 characters with upper-case, lower-case and a number">
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password" required error={errors.confirm}>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
          <Button type="submit" variant="primary" loading={busy} disabled={!currentPassword || !newPassword || !confirm}>
            Change password
          </Button>
        </form>
      </Card>
    </div>
  );
}
