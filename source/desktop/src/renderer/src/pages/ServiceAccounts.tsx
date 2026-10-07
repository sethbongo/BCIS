import { SERVICE_ACCOUNT_STATUSES, SERVICE_TYPE_CODES, statusLabel, type AddressRow, type ServiceAccountRow } from '@bcis/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Money, ReasonDialog, statusOptions, useLookups } from '../components/common';
import { DataTable, FilterSelect, type Column } from '../components/DataTable';
import { Button, Dialog, Field, Input, MoneyInput, Notice, PageHeader, Select, StatusBadge, Textarea } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, peso, todayIso } from '../lib/format';

// ---------------------------------------------------------------- Add service account
export function AddServiceDialog({ open, onOpenChange, subscriberId, addresses, defaultDueDay }: { open: boolean; onOpenChange: (open: boolean) => void; subscriberId: number; addresses: AddressRow[]; defaultDueDay: number }) {
  const queryClient = useQueryClient();
  const { plans } = useLookups();
  const [planId, setPlanId] = useState('');
  const [addressId, setAddressId] = useState('');
  const [newAddress, setNewAddress] = useState({ line1: '', barangay: '', city: 'Malaybalay City', province: 'Bukidnon' });
  const [activationDate, setActivationDate] = useState(todayIso());
  const [billingStartDate, setBillingStartDate] = useState(todayIso());
  const [dueDay, setDueDay] = useState(defaultDueDay);
  const [discount, setDiscount] = useState<number | undefined>(0);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setPlanId('');
      setAddressId(String(addresses.find((a) => a.isPrimary)?.id ?? addresses[0]?.id ?? 'new'));
      setActivationDate(todayIso());
      setBillingStartDate(todayIso());
      setDueDay(defaultDueDay);
      setDiscount(0);
      setNotes('');
    }
  }, [open, addresses, defaultDueDay]);
  const plan = plans.find((p) => p.id === Number(planId));
  const usingNew = addressId === 'new';
  const valid = plan && (usingNew ? newAddress.line1.trim() && newAddress.barangay.trim() : addressId) && dueDay >= 1 && dueDay <= 28 && discount !== undefined;

  const submit = async () => {
    setBusy(true);
    try {
      const account = await api.post<ServiceAccountRow>('/service-accounts', {
        subscriberId,
        planId: Number(planId),
        addressId: usingNew ? null : Number(addressId),
        newAddress: usingNew ? { ...newAddress, label: 'Service address' } : undefined,
        activationDate,
        billingStartDate,
        dueDay,
        monthlyDiscount: discount ?? 0,
        notes: notes.trim() || undefined,
      });
      toast.success(`Service account ${account.accountNo} created`);
      await queryClient.invalidateQueries();
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add service account"
      description="One subscriber can hold several services, each at its own installation address."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!valid} loading={busy} onClick={() => void submit()}>
            Create service account
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Plan" required className="col-span-2">
          <Select value={planId} onChange={(e) => setPlanId(e.target.value)} autoFocus>
            <option value="">Select a plan…</option>
            {SERVICE_TYPE_CODES.map((type) => (
              <optgroup key={type} label={statusLabel(type)}>
                {plans.filter((p) => p.isActive && p.serviceType === type).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {peso(p.monthlyPrice)}/month
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        {plan && (
          <Notice tone="info" className="col-span-2">
            Monthly rate {peso(plan.monthlyPrice)}
            {plan.installationFee > 0 && ` · installation fee ${peso(plan.installationFee)} is added to the first invoice`}
            {plan.speedMbps && ` · ${plan.speedMbps} Mbps`}
            {plan.channelCount && ` · ${plan.channelCount} channels`}
          </Notice>
        )}
        <Field label="Installation address" required className="col-span-2">
          <Select value={addressId} onChange={(e) => setAddressId(e.target.value)}>
            {addresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.formatted}
              </option>
            ))}
            <option value="new">Another address…</option>
          </Select>
        </Field>
        {usingNew && (
          <>
            <Field label="House no. / street / purok" required className="col-span-2">
              <Input value={newAddress.line1} onChange={(e) => setNewAddress({ ...newAddress, line1: e.target.value })} />
            </Field>
            <Field label="Barangay" required>
              <Input value={newAddress.barangay} onChange={(e) => setNewAddress({ ...newAddress, barangay: e.target.value })} />
            </Field>
            <Field label="City / municipality" required>
              <Input value={newAddress.city} onChange={(e) => setNewAddress({ ...newAddress, city: e.target.value })} />
            </Field>
          </>
        )}
        <Field label="Activation date" required>
          <Input type="date" value={activationDate} onChange={(e) => setActivationDate(e.target.value)} />
        </Field>
        <Field label="Billing start date" required hint="Billed from the month containing this date">
          <Input type="date" value={billingStartDate} min={activationDate} onChange={(e) => setBillingStartDate(e.target.value)} />
        </Field>
        <Field label="Due day of the month" required hint="1 to 28">
          <Input type="number" min={1} max={28} value={dueDay} onChange={(e) => setDueDay(Number(e.target.value))} />
        </Field>
        <Field label="Monthly discount">
          <MoneyInput value={discount} onChange={setDiscount} />
        </Field>
        <Field label="Notes" className="col-span-2">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Suspend / reconnect / terminate / change plan
export type ServiceAction = { kind: 'suspend' | 'reconnect' | 'terminate' | 'plan'; account: ServiceAccountRow } | null;

export function ServiceActionDialogs({ action, onClose }: { action: ServiceAction; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { plans, technicians } = useLookups();
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [technicianId, setTechnicianId] = useState('');
  const [waiveFee, setWaiveFee] = useState(false);
  const [notes, setNotes] = useState('');
  const [planId, setPlanId] = useState('');
  const [busy, setBusy] = useState(false);
  const account = action?.account;
  useEffect(() => {
    setEffectiveDate(todayIso());
    setTechnicianId('');
    setWaiveFee(false);
    setNotes('');
    setPlanId('');
  }, [action]);
  if (!account) return null;
  const done = async (message: string) => {
    toast.success(message);
    await queryClient.invalidateQueries();
  };
  const currentPlan = plans.find((p) => p.id === account.planId);
  const submit = async (run: () => Promise<void>) => {
    setBusy(true);
    try {
      await run();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ReasonDialog
        open={action.kind === 'suspend'}
        onOpenChange={(open) => !open && onClose()}
        title={`Suspend ${account.accountNo}?`}
        description={`${account.subscriberName} · ${account.planName} · balance ${peso(account.balance)}`}
        confirmLabel="Suspend service"
        danger
        reasonLabel="Reason for suspension"
        onConfirm={async (reason) => {
          await api.post(`/service-accounts/${account.id}/suspend`, { reason, effectiveDate });
          await done(`${account.accountNo} suspended`);
        }}
      >
        <Field label="Effective date" required>
          <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </Field>
        <Notice tone="info">Suspended accounts are not billed. Your name is recorded as the approver, with the arrears at the time of suspension.</Notice>
      </ReasonDialog>

      <ReasonDialog
        open={action.kind === 'terminate'}
        onOpenChange={(open) => !open && onClose()}
        title={`Terminate ${account.accountNo}?`}
        description={`${account.subscriberName} · ${account.planName}`}
        confirmLabel="Terminate service"
        danger
        reasonLabel="Reason for termination"
        onConfirm={async (reason) => {
          await api.post(`/service-accounts/${account.id}/terminate`, { reason, effectiveDate });
          await done(`${account.accountNo} terminated`);
        }}
      >
        <Field label="Effective date" required>
          <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </Field>
        <Notice tone="warning">Termination is permanent. The account, its invoices and its history remain on record; unpaid balances stay collectible.</Notice>
      </ReasonDialog>

      <Dialog
        open={action.kind === 'reconnect'}
        onOpenChange={(open) => !open && onClose()}
        title={`Request reconnection for ${account.accountNo}`}
        description={`${account.subscriberName} · ${account.planName}`}
        size="sm"
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() =>
                void submit(async () => {
                  await api.post(`/service-accounts/${account.id}/reconnection`, { technicianUserId: technicianId ? Number(technicianId) : null, waiveFee, notes: notes.trim() || undefined });
                  await done(`Reconnection requested for ${account.accountNo}`);
                })
              }
            >
              Create reconnection request
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Notice tone="info">The account qualifies only after its overdue invoices are settled. {currentPlan && currentPlan.reconnectionFee > 0 && !waiveFee ? `A reconnection fee of ${peso(currentPlan.reconnectionFee)} will be billed as a one-time invoice.` : 'No reconnection fee will be billed.'}</Notice>
          <Field label="Assign technician">
            <Select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
              <option value="">Unassigned</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          {currentPlan && currentPlan.reconnectionFee > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={waiveFee} onChange={(e) => setWaiveFee(e.target.checked)} /> Waive the reconnection fee
            </label>
          )}
          <Field label="Notes">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={action.kind === 'plan'}
        onOpenChange={(open) => !open && onClose()}
        title={`Change plan for ${account.accountNo}`}
        description={`Currently ${account.planName} at ${peso(account.currentRate)}/month`}
        size="sm"
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!planId || Number(planId) === account.planId}
              loading={busy}
              onClick={() =>
                void submit(async () => {
                  await api.patch(`/service-accounts/${account.id}`, { planId: Number(planId), reason: notes.trim() || undefined });
                  await done(`Plan changed for ${account.accountNo}`);
                })
              }
            >
              Change plan
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="New plan" required>
            <Select value={planId} onChange={(e) => setPlanId(e.target.value)} autoFocus>
              <option value="">Select a plan…</option>
              {plans.filter((p) => p.isActive && p.id !== account.planId).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {peso(p.monthlyPrice)}/month
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason / notes">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Notice tone="info">The new rate applies to future billing only. Invoices already generated keep the rate they were billed at.</Notice>
        </div>
      </Dialog>
    </>
  );
}

/** Row action buttons for a service account, limited to what its status and the user's role allow. */
export function ServiceActions({ account, onAction }: { account: ServiceAccountRow; onAction: (action: ServiceAction) => void }) {
  const { can } = useAuth();
  const stop = (kind: NonNullable<ServiceAction>['kind']) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onAction({ kind, account });
  };
  return (
    <span className="flex justify-end gap-1">
      {account.status === 'ACTIVE' && can('service.manage') && <Button size="sm" variant="ghost" onClick={stop('plan')}>Change plan</Button>}
      {account.status === 'ACTIVE' && can('service.suspend') && <Button size="sm" variant="ghost" onClick={stop('suspend')}>Suspend</Button>}
      {account.status === 'SUSPENDED' && can('service.suspend') && <Button size="sm" variant="ghost" onClick={stop('reconnect')}>Reconnect</Button>}
      {account.status !== 'TERMINATED' && can('service.manage') && <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={stop('terminate')}>Terminate</Button>}
    </span>
  );
}

export function ServiceAccountsPage() {
  const navigate = useNavigate();
  const { plans, areas } = useLookups();
  const [status, setStatus] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [planId, setPlanId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [action, setAction] = useState<ServiceAction>(null);
  const columns: Column<ServiceAccountRow>[] = [
    { accessorKey: 'accountNo', header: 'Service Account', cell: (c) => <span className="font-medium text-accent">{c.row.original.accountNo}</span> },
    { accessorKey: 'subscriberName', header: 'Subscriber', cell: (c) => <>{c.row.original.subscriberName} <span className="text-xs text-muted">{c.row.original.subscriberAccountNo}</span></> },
    { accessorKey: 'planName', header: 'Plan', cell: (c) => <>{c.row.original.planName} <span className="text-xs text-muted">{statusLabel(c.row.original.serviceType)}</span></> },
    { accessorKey: 'address', header: 'Installation address', enableSorting: false, cell: (c) => <span className="text-slate-600">{c.row.original.address}</span> },
    { accessorKey: 'activationDate', header: 'Activated', cell: (c) => <span className="whitespace-nowrap">{date(c.row.original.activationDate)}</span> },
    { accessorKey: 'dueDay', header: 'Due day', num: true, enableSorting: false },
    { accessorKey: 'currentRate', header: 'Monthly rate', num: true, cell: (c) => <Money value={c.row.original.currentRate - c.row.original.monthlyDiscount} />, csv: (r) => ((r.currentRate - r.monthlyDiscount) / 100).toFixed(2) },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.row.original.status} /> },
    { accessorKey: 'balance', header: 'Balance', num: true, cell: (c) => <Money value={c.row.original.balance} zeroDash />, csv: (r) => (r.balance / 100).toFixed(2) },
    { id: 'actions', header: '', enableSorting: false, cell: (c) => <ServiceActions account={c.row.original} onAction={setAction} /> },
  ];
  return (
    <>
      <PageHeader title="Service Accounts" description="Internet, Cable and Combo services. New services are added from the subscriber profile." />
      <DataTable<ServiceAccountRow>
        endpoint="/service-accounts"
        columns={columns}
        params={{ status, serviceType, planId, areaId }}
        searchPlaceholder="Service account, subscriber, plan, address…"
        exportName="service-accounts"
        onRowClick={(row) => navigate(`/subscribers/${row.subscriberId}?tab=services`)}
        filters={
          <>
            <FilterSelect label="Status" value={status} onChange={setStatus} options={statusOptions(SERVICE_ACCOUNT_STATUSES)} />
            <FilterSelect label="Service" value={serviceType} onChange={setServiceType} options={statusOptions(SERVICE_TYPE_CODES)} />
            <FilterSelect label="Plan" value={planId} onChange={setPlanId} options={plans.map((p) => ({ value: p.id, label: p.name }))} />
            <FilterSelect label="Area" value={areaId} onChange={setAreaId} options={areas.map((a) => ({ value: a.id, label: a.name }))} />
          </>
        }
      />
      <ServiceActionDialogs action={action} onClose={() => setAction(null)} />
    </>
  );
}
