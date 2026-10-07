import { SUBSCRIBER_STATUSES, SubscriberInput, type ServiceAccountRow, type SubscriberDetail, type SubscriberRow } from '@bcis/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Money, statusOptions, useLookups } from '../components/common';
import { DataTable, FilterSelect, type Column } from '../components/DataTable';
import { Button, Card, CardHeader, Field, Input, PageHeader, Select, StatusBadge, Textarea } from '../components/ui';
import { api, handleError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { todayIso } from '../lib/format';

const columns: Column<SubscriberRow>[] = [
  { accessorKey: 'accountNo', header: 'Account No.', cell: (c) => <span className="font-medium text-accent">{c.row.original.accountNo}</span> },
  { accessorKey: 'fullName', header: 'Subscriber', cell: (c) => <span className="font-medium">{c.row.original.fullName}</span> },
  { accessorKey: 'phone', header: 'Contact No.', enableSorting: false },
  { accessorKey: 'address', header: 'Address', enableSorting: false, cell: (c) => <span className="text-slate-600">{c.row.original.address}</span> },
  { accessorKey: 'areaName', header: 'Area' },
  { accessorKey: 'collectorName', header: 'Collector' },
  { accessorKey: 'serviceCount', header: 'Services', num: true },
  { accessorKey: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.row.original.status} /> },
  { accessorKey: 'balance', header: 'Balance', num: true, cell: (c) => <Money value={c.row.original.balance} />, csv: (r) => (r.balance / 100).toFixed(2) },
];

export function SubscribersPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { areas, collectors } = useLookups();
  const [status, setStatus] = useState('');
  const [areaId, setAreaId] = useState('');
  const [collectorId, setCollectorId] = useState('');
  return (
    <>
      <PageHeader
        title="All Subscribers"
        description="Search by account number, name, contact number or address."
        actions={
          can('subscriber.create') && (
            <Button variant="primary" onClick={() => navigate('/subscribers/new')}>
              <UserPlus /> New Subscriber
            </Button>
          )
        }
      />
      <DataTable<SubscriberRow>
        endpoint="/subscribers"
        columns={columns}
        params={{ status, areaId, collectorId }}
        searchPlaceholder="Search subscribers…"
        exportName="subscribers"
        onRowClick={(row) => navigate(`/subscribers/${row.id}`)}
        filters={
          <>
            <FilterSelect label="Status" value={status} onChange={setStatus} options={statusOptions(SUBSCRIBER_STATUSES)} />
            <FilterSelect label="Area" value={areaId} onChange={setAreaId} options={areas.map((a) => ({ value: a.id, label: a.name }))} />
            <FilterSelect label="Collector" value={collectorId} onChange={setCollectorId} options={collectors.map((c) => ({ value: c.id, label: c.fullName }))} />
          </>
        }
      />
    </>
  );
}

const optionalId = { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v)) };

/** Identity, contact and collection fields shared by the registration form and the edit dialog. */
export function SubscriberFields({ form }: { form: UseFormReturn<SubscriberInput> }) {
  const { register, formState } = form;
  const e = formState.errors;
  const { areas, collectors } = useLookups();
  return (
    <>
      <fieldset>
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Identity and contact</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" required error={e.firstName?.message}>
            <Input {...register('firstName')} aria-invalid={!!e.firstName} autoFocus />
          </Field>
          <Field label="Last name" required error={e.lastName?.message}>
            <Input {...register('lastName')} aria-invalid={!!e.lastName} />
          </Field>
          <Field label="Contact number" required error={e.phone?.message}>
            <Input {...register('phone')} aria-invalid={!!e.phone} placeholder="0917 555 0100" />
          </Field>
          <Field label="Alternate contact number" error={e.altPhone?.message}>
            <Input {...register('altPhone')} aria-invalid={!!e.altPhone} />
          </Field>
          <Field label="Email" error={e.email?.message} className="col-span-2">
            <Input {...register('email')} aria-invalid={!!e.email} />
          </Field>
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Billing and collection</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due day of the month" required error={e.dueDay?.message} hint="1 to 28">
            <Input type="number" min={1} max={28} {...register('dueDay', { valueAsNumber: true })} aria-invalid={!!e.dueDay} />
          </Field>
          <Field label="Route sequence" error={e.routeSequence?.message} hint="Order of visit on the collector's route">
            <Input type="number" min={0} {...register('routeSequence', optionalId)} />
          </Field>
          <Field label="Collection area" error={e.collectionAreaId?.message}>
            <Select {...register('collectionAreaId', optionalId)}>
              <option value="">Not assigned</option>
              {areas.filter((a) => a.isActive).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Assigned collector" error={e.collectorId?.message}>
            <Select {...register('collectorId', optionalId)}>
              <option value="">Not assigned</option>
              {collectors.filter((c) => c.isActive).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes" error={e.notes?.message} className="col-span-2">
            <Textarea rows={2} {...register('notes')} />
          </Field>
        </div>
      </fieldset>
    </>
  );
}

export function AddressFields({ form, prefix }: { form: UseFormReturn<any>; prefix: string }) {
  const errors = (prefix.split('.').reduce<any>((acc, key) => acc?.[key], form.formState.errors) ?? {}) as Record<string, { message?: string }>;
  const name = (field: string) => `${prefix}.${field}`;
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="House no. / street / purok" required error={errors.line1?.message} className="col-span-2">
        <Input {...form.register(name('line1'))} aria-invalid={!!errors.line1} />
      </Field>
      <Field label="Barangay" required error={errors.barangay?.message}>
        <Input {...form.register(name('barangay'))} aria-invalid={!!errors.barangay} />
      </Field>
      <Field label="City / municipality" required error={errors.city?.message}>
        <Input {...form.register(name('city'))} aria-invalid={!!errors.city} />
      </Field>
      <Field label="Province" required error={errors.province?.message}>
        <Input {...form.register(name('province'))} aria-invalid={!!errors.province} />
      </Field>
      <Field label="Landmark" error={errors.landmark?.message}>
        <Input {...form.register(name('landmark'))} />
      </Field>
    </div>
  );
}

export function NewSubscriberPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { plans } = useLookups();
  const [planId, setPlanId] = useState('');
  const [activationDate, setActivationDate] = useState(todayIso());
  const form = useForm<SubscriberInput>({
    resolver: zodResolver(SubscriberInput),
    defaultValues: { firstName: '', lastName: '', phone: '', altPhone: '', email: '', dueDay: 15, collectionAreaId: null, collectorId: null, routeSequence: null, notes: '', address: { line1: '', barangay: '', city: 'Malaybalay City', province: 'Bukidnon', landmark: '' } },
  });

  const submit = form.handleSubmit(async (values) => {
    try {
      const subscriber = await api.post<SubscriberDetail>('/subscribers', values);
      if (planId) {
        try {
          const account = await api.post<ServiceAccountRow>('/service-accounts', { subscriberId: subscriber.id, planId: Number(planId), activationDate, billingStartDate: activationDate, dueDay: values.dueDay, monthlyDiscount: 0 });
          toast.success(`Subscriber ${subscriber.accountNo} registered with service ${account.accountNo}`);
        } catch (err) {
          toast.warning(`Subscriber ${subscriber.accountNo} was registered, but the service account was not created.`, { description: err instanceof Error ? err.message : undefined });
        }
      } else toast.success(`Subscriber ${subscriber.accountNo} registered`);
      await queryClient.invalidateQueries();
      navigate(`/subscribers/${subscriber.id}`);
    } catch (err) {
      handleError(err, form.setError);
    }
  });

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-4xl" noValidate>
      <PageHeader title="New Subscriber" description="The account number is assigned automatically when the subscriber is saved." />
      <Card>
        <CardHeader title="Subscriber details" description={<>Fields marked <span className="text-danger">*</span> are required.</>} />
        <div className="space-y-5 p-4">
          <SubscriberFields form={form} />
          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Home / billing address</legend>
            <AddressFields form={form} prefix="address" />
          </fieldset>
          {can('service.manage') && (
            <fieldset>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">First service account (optional)</legend>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Plan" hint="Installed at the address above. More services can be added from the subscriber profile.">
                  <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                    <option value="">Add later</option>
                    {plans.filter((p) => p.isActive).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — ₱{(p.monthlyPrice / 100).toFixed(2)}/month
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Activation and billing start date">
                  <Input type="date" value={activationDate} onChange={(e) => setActivationDate(e.target.value)} disabled={!planId} />
                </Field>
              </div>
            </fieldset>
          )}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-line bg-slate-50/60 px-4 py-3">
          <Link to="/subscribers">
            <Button>Cancel</Button>
          </Link>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
            Register subscriber
          </Button>
        </footer>
      </Card>
    </form>
  );
}
