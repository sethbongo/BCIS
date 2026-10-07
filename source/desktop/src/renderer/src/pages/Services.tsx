import { PlanInput, SERVICE_TYPE_CODES, statusLabel, type PlanRow, type ReconnectionRow, type SuspensionRow } from '@bcis/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Money } from '../components/common';
import { DataTable, FilterSelect, type Column } from '../components/DataTable';
import { Button, Card, Dialog, Field, Input, MoneyInput, Notice, PageHeader, Select, SimpleTable, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '../components/ui';
import { api, errorMessage, handleError, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { count, date, todayIso } from '../lib/format';

const optionalNumber = { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v)) };

function PlanDialog({ plan, onClose }: { plan: PlanRow | 'new' | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<PlanInput>({ resolver: zodResolver(PlanInput) });
  const { register, control, formState } = form;
  const e = formState.errors;
  const isNew = plan === 'new';
  useEffect(() => {
    if (plan === 'new') form.reset({ code: '', name: '', serviceType: 'INTERNET', monthlyPrice: undefined as never, installationFee: 0, reconnectionFee: 0, speedMbps: null, channelCount: null, description: '', isActive: true });
    else if (plan) form.reset({ ...plan, description: plan.description ?? '' });
  }, [plan, form]);
  const type = form.watch('serviceType');

  const submit = form.handleSubmit(async (values) => {
    try {
      if (isNew) await api.post('/plans', values);
      else if (plan) {
        const { code: _code, serviceType: _type, ...changes } = values;
        await api.patch(`/plans/${plan.id}`, changes);
      }
      toast.success('Plan saved');
      await queryClient.invalidateQueries();
      onClose();
    } catch (err) {
      handleError(err, form.setError);
    }
  });
  const priceChanged = !isNew && plan && form.watch('monthlyPrice') !== plan.monthlyPrice;

  return (
    <Dialog
      open={plan !== null}
      onOpenChange={(open) => !open && onClose()}
      title={isNew ? 'New service plan' : `Edit plan ${plan ? plan.code : ''}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={formState.isSubmitting} onClick={() => void submit()}>
            Save plan
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid grid-cols-6 gap-3" noValidate>
        <Field label="Plan code" required error={e.code?.message} className="col-span-2">
          <Input {...register('code')} disabled={!isNew} aria-invalid={!!e.code} autoFocus={isNew} />
        </Field>
        <Field label="Plan name" required error={e.name?.message} className="col-span-4">
          <Input {...register('name')} aria-invalid={!!e.name} />
        </Field>
        <Field label="Service type" required error={e.serviceType?.message} className="col-span-2">
          <Select {...register('serviceType')} disabled={!isNew}>
            {SERVICE_TYPE_CODES.map((t) => (
              <option key={t} value={t}>
                {statusLabel(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Speed (Mbps)" error={e.speedMbps?.message} className="col-span-2" hint={type === 'CABLE' ? 'Not used for cable' : undefined}>
          <Input type="number" min={1} {...register('speedMbps', optionalNumber)} disabled={type === 'CABLE'} />
        </Field>
        <Field label="Channel count" error={e.channelCount?.message} className="col-span-2" hint={type === 'INTERNET' ? 'Not used for internet' : undefined}>
          <Input type="number" min={1} {...register('channelCount', optionalNumber)} disabled={type === 'INTERNET'} />
        </Field>
        <Field label="Monthly price" required error={e.monthlyPrice?.message} className="col-span-2">
          <Controller control={control} name="monthlyPrice" render={({ field }) => <MoneyInput value={field.value} onChange={field.onChange} invalid={!!e.monthlyPrice} />} />
        </Field>
        <Field label="Installation fee" error={e.installationFee?.message} className="col-span-2">
          <Controller control={control} name="installationFee" render={({ field }) => <MoneyInput value={field.value} onChange={field.onChange} />} />
        </Field>
        <Field label="Reconnection fee" error={e.reconnectionFee?.message} className="col-span-2">
          <Controller control={control} name="reconnectionFee" render={({ field }) => <MoneyInput value={field.value} onChange={field.onChange} />} />
        </Field>
        <Field label="Description" error={e.description?.message} className="col-span-6">
          <Textarea rows={2} {...register('description')} />
        </Field>
        <label className="col-span-6 flex items-center gap-2 text-sm">
          <input type="checkbox" {...register('isActive')} /> Active (can be assigned to new service accounts)
        </label>
        {priceChanged && (
          <Notice tone="warning" className="col-span-6" title="Price change applies to future billing only">
            Service accounts on this plan are billed at the new rate from their next invoice. Invoices already generated keep the rate they were billed at.
          </Notice>
        )}
      </form>
    </Dialog>
  );
}

function PlansTab() {
  const { can } = useAuth();
  const plans = useApi<PlanRow[]>('/plans').data ?? [];
  const [editing, setEditing] = useState<PlanRow | 'new' | null>(null);
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">Service plans</h2>
        {can('plan.manage') && (
          <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
            <Plus /> New Plan
          </Button>
        )}
      </div>
      <SimpleTable
        head={[{ label: 'Code' }, { label: 'Plan' }, { label: 'Service' }, { label: 'Attributes' }, { label: 'Monthly price', num: true }, { label: 'Installation', num: true }, { label: 'Reconnection', num: true }, { label: 'Accounts', num: true }, { label: 'Status' }, { label: '' }]}
        rows={plans.map((p) => [
          p.code,
          <><span className="font-medium">{p.name}</span>{p.description && <span className="block text-xs text-muted">{p.description}</span>}</>,
          statusLabel(p.serviceType),
          <span className="text-slate-600">{[p.speedMbps && `${p.speedMbps} Mbps`, p.channelCount && `${p.channelCount} channels`].filter(Boolean).join(' · ')}</span>,
          <Money value={p.monthlyPrice} className="font-medium" />,
          <Money value={p.installationFee} zeroDash />,
          <Money value={p.reconnectionFee} zeroDash />,
          count(p.activeAccounts),
          <StatusBadge status={p.isActive ? 'ACTIVE' : 'INACTIVE'} />,
          can('plan.manage') && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
              <Pencil /> Edit
            </Button>
          ),
        ])}
        empty="No plans yet."
      />
      <PlanDialog plan={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

const suspensionColumns: Column<SuspensionRow>[] = [
  { accessorKey: 'subscriberName', header: 'Subscriber', cell: (c) => <Link to={`/subscribers/${c.row.original.subscriberId}?tab=services`} className="font-medium text-accent hover:underline">{c.row.original.subscriberName}</Link> },
  { id: 'service', header: 'Service', enableSorting: false, cell: (c) => <>{c.row.original.planName} <span className="text-xs text-muted">{c.row.original.serviceAccountNo}</span></>, csv: (r) => `${r.planName} (${r.serviceAccountNo})` },
  { accessorKey: 'effectiveDate', header: 'Effective', cell: (c) => <span className="whitespace-nowrap">{date(c.row.original.effectiveDate)}</span> },
  { accessorKey: 'reason', header: 'Reason', enableSorting: false },
  { accessorKey: 'approvedByName', header: 'Approved by', enableSorting: false },
  { id: 'state', header: 'Status', enableSorting: false, cell: (c) => <StatusBadge status={c.row.original.isActive ? 'SUSPENDED' : 'LIFTED'} label={c.row.original.isActive ? 'Suspended' : `Lifted ${date(c.row.original.liftedAt?.slice(0, 10))}`} />, csv: (r) => (r.isActive ? 'Suspended' : 'Lifted') },
  { accessorKey: 'arrearsAtSuspension', header: 'Arrears at suspension', num: true, enableSorting: false, cell: (c) => <Money value={c.row.original.arrearsAtSuspension} />, csv: (r) => (r.arrearsAtSuspension / 100).toFixed(2) },
  { accessorKey: 'currentArrears', header: 'Arrears now', num: true, enableSorting: false, cell: (c) => <Money value={c.row.original.currentArrears} zeroDash className={c.row.original.currentArrears > 0 ? 'text-danger' : undefined} />, csv: (r) => (r.currentArrears / 100).toFixed(2) },
];

function ReconnectionsTab() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [completing, setCompleting] = useState<ReconnectionRow | null>(null);
  const [completionDate, setCompletionDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const columns: Column<ReconnectionRow>[] = [
    { accessorKey: 'subscriberName', header: 'Subscriber', cell: (c) => <Link to={`/subscribers/${c.row.original.subscriberId}?tab=history`} className="font-medium text-accent hover:underline">{c.row.original.subscriberName}</Link> },
    { id: 'service', header: 'Service', enableSorting: false, cell: (c) => <>{c.row.original.planName} <span className="text-xs text-muted">{c.row.original.serviceAccountNo}</span></>, csv: (r) => `${r.planName} (${r.serviceAccountNo})` },
    { accessorKey: 'address', header: 'Address', enableSorting: false, cell: (c) => <span className="text-slate-600">{c.row.original.address}</span> },
    { accessorKey: 'requestDate', header: 'Requested', cell: (c) => <span className="whitespace-nowrap">{date(c.row.original.requestDate)}</span> },
    { accessorKey: 'technicianName', header: 'Technician', enableSorting: false, cell: (c) => c.row.original.technicianName ?? <span className="text-muted">Unassigned</span> },
    { id: 'fee', header: 'Fee', num: true, enableSorting: false, cell: (c) => (c.row.original.feeAmount ? <><Money value={c.row.original.feeAmount} /> <span className="text-xs text-muted">{c.row.original.feeInvoiceNo}</span></> : <span className="text-muted">Waived / none</span>), csv: (r) => (r.feeAmount / 100).toFixed(2) },
    { accessorKey: 'status', header: 'Status', enableSorting: false, cell: (c) => <StatusBadge status={c.row.original.status} /> },
    { accessorKey: 'completionDate', header: 'Completed', enableSorting: false, cell: (c) => <span className="whitespace-nowrap">{date(c.row.original.completionDate)}</span> },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: (c) =>
        c.row.original.status === 'REQUESTED' &&
        can('service.reconnect') && (
          <Button size="sm" variant="primary" onClick={() => { setCompleting(c.row.original); setCompletionDate(todayIso()); setNotes(''); }}>
            Mark completed
          </Button>
        ),
    },
  ];
  const complete = async () => {
    if (!completing) return;
    setBusy(true);
    try {
      await api.post(`/reconnections/${completing.id}/complete`, { completionDate, notes: notes.trim() || undefined });
      toast.success(`${completing.serviceAccountNo} reconnected and active`);
      await queryClient.invalidateQueries();
      setCompleting(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <DataTable<ReconnectionRow>
        endpoint="/reconnections"
        columns={columns}
        params={{ status }}
        exportName="reconnections"
        emptyTitle="No reconnection requests"
        filters={<FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'REQUESTED', label: 'Requested (pending)' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'CANCELLED', label: 'Cancelled' }]} />}
      />
      <Dialog
        open={completing !== null}
        onOpenChange={(open) => !open && setCompleting(null)}
        title="Complete reconnection"
        description={completing ? `${completing.subscriberName} · ${completing.serviceAccountNo} · ${completing.address}` : undefined}
        size="sm"
        footer={
          <>
            <Button onClick={() => setCompleting(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => void complete()}>
              Mark completed
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Completion date" required>
            <Input type="date" value={completionDate} max={todayIso()} onChange={(e) => setCompletionDate(e.target.value)} />
          </Field>
          <Field label="Work notes">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Notice tone="info">The service account becomes Active again and the change is written to its service history.</Notice>
        </div>
      </Dialog>
    </>
  );
}

export function ServicesPage() {
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canPlans = can('plan.view', 'service.view');
  const tab = searchParams.get('tab') ?? (can('plan.view') ? 'plans' : 'reconnections');
  const [suspensionStatus, setSuspensionStatus] = useState('ACTIVE');
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Services" description="Service plans, suspensions and the reconnection work queue." />
      <Tabs value={tab} onValueChange={(value) => setSearchParams({ tab: value }, { replace: true })} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mb-3">
          {canPlans && <TabsTrigger value="plans">Plans</TabsTrigger>}
          <TabsTrigger value="suspensions">Suspensions</TabsTrigger>
          <TabsTrigger value="reconnections">Reconnections</TabsTrigger>
        </TabsList>
        {canPlans && (
          <TabsContent value="plans">
            <PlansTab />
          </TabsContent>
        )}
        <TabsContent value="suspensions" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <DataTable<SuspensionRow>
            endpoint="/suspensions"
            columns={suspensionColumns}
            params={{ status: suspensionStatus }}
            exportName="suspensions"
            emptyTitle="No suspension records"
            filters={<FilterSelect label="Status" value={suspensionStatus} onChange={setSuspensionStatus} options={[{ value: 'ACTIVE', label: 'Currently suspended' }, { value: 'LIFTED', label: 'Lifted' }]} />}
          />
        </TabsContent>
        <TabsContent value="reconnections" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <ReconnectionsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
