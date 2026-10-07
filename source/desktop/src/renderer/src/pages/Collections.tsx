import { BATCH_STATUSES, type AreaRow, type BatchDetail, type BatchRow, type CollectorRow, type RouteSheet } from '@bcis/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Money, PrintHeader, PrintPreview, statusOptions, useLookups } from '../components/common';
import { DataTable, FilterSelect, type Column } from '../components/DataTable';
import { Button, Card, Dialog, Field, Input, Notice, PageHeader, Select, SimpleTable, StatusBadge, Textarea } from '../components/ui';
import { api, errorMessage, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { count, date, peso, todayIso } from '../lib/format';

// ---------------------------------------------------------------- Route sheet (printable)
export function RouteSheetPrint({ sheet, title, onClose }: { sheet: RouteSheet; title?: string; onClose: () => void }) {
  return (
    <PrintPreview title={title ?? `Route sheet · ${sheet.areaName}`} fileName={`route-sheet-${sheet.areaName}-${sheet.asOf}`} landscape onClose={onClose}>
      <PrintHeader title="Collection Route Sheet" subtitle={`${sheet.areaName} · ${date(sheet.asOf)}`} right={<p className="text-[10px] text-slate-600">Collector: {sheet.collectorName}</p>} />
      <table>
        <thead>
          <tr>
            <th style={{ width: 24 }}>#</th>
            <th>Account</th>
            <th>Subscriber</th>
            <th>Address / contact</th>
            <th>Services</th>
            <th style={{ textAlign: 'right' }}>Current bill</th>
            <th style={{ textAlign: 'right' }}>Arrears</th>
            <th style={{ textAlign: 'right' }}>Total due</th>
            <th style={{ width: 90 }}>Collected</th>
            <th style={{ width: 110 }}>Receipt / remarks</th>
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((row, i) => (
            <tr key={row.subscriberId}>
              <td>{i + 1}</td>
              <td>{row.accountNo}</td>
              <td>{row.fullName}</td>
              <td>
                {row.address}
                <br />
                {row.phone}
              </td>
              <td>{row.services}</td>
              <td className="num">{peso(row.currentBill)}</td>
              <td className="num">{row.arrears ? peso(row.arrears) : ''}</td>
              <td className="num font-semibold">{peso(row.totalDue)}</td>
              <td />
              <td />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>{sheet.rows.length} accounts · expected receivable</td>
            <td className="num">{peso(sheet.totals.currentBill)}</td>
            <td className="num">{peso(sheet.totals.arrears)}</td>
            <td className="num">{peso(sheet.totals.totalDue)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
      <div className="mt-8 grid grid-cols-3 gap-10 text-center text-[10px]">
        {['Collector signature', 'Total cash turned over', 'Received by (office)'].map((label) => (
          <p key={label} className="border-t border-slate-400 pt-1">
            {label}
          </p>
        ))}
      </div>
    </PrintPreview>
  );
}

// ---------------------------------------------------------------- Collectors
export function CollectorsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const collectors = useApi<CollectorRow[]>('/collectors').data ?? [];
  const { areas } = useLookups();
  const [editing, setEditing] = useState<CollectorRow | 'new' | null>(null);
  const [form, setForm] = useState({ code: '', fullName: '', phone: '', isActive: true, areaIds: [] as number[] });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (editing === 'new') setForm({ code: '', fullName: '', phone: '', isActive: true, areaIds: [] });
    else if (editing) setForm({ code: editing.code, fullName: editing.fullName, phone: editing.phone ?? '', isActive: editing.isActive, areaIds: editing.areas.map((a) => a.id) });
  }, [editing]);
  const save = async () => {
    setBusy(true);
    try {
      if (editing === 'new') await api.post('/collectors', form);
      else if (editing) await api.patch(`/collectors/${editing.id}`, form);
      toast.success('Collector saved');
      await queryClient.invalidateQueries();
      setEditing(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Collectors"
        description="Field collectors and the areas assigned to them."
        actions={can('collection.manage') && <Button variant="primary" onClick={() => setEditing('new')}><Plus /> New Collector</Button>}
      />
      <Card>
        <SimpleTable
          head={[{ label: 'Code' }, { label: 'Collector' }, { label: 'Contact no.' }, { label: 'Assigned areas' }, { label: 'Subscribers', num: true }, { label: 'Status' }, { label: '' }]}
          rows={collectors.map((c) => [
            c.code,
            <span className="font-medium">{c.fullName}</span>,
            c.phone,
            c.areas.map((a) => a.name).join(', ') || <span className="text-muted">None</span>,
            count(c.subscriberCount),
            <StatusBadge status={c.isActive ? 'ACTIVE' : 'INACTIVE'} />,
            can('collection.manage') && <Button size="sm" variant="ghost" onClick={() => setEditing(c)}><Pencil /> Edit</Button>,
          ])}
          empty="No collectors yet."
        />
      </Card>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === 'new' ? 'New collector' : 'Edit collector'}
        size="sm"
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!form.code.trim() || !form.fullName.trim()} onClick={() => void save()}>Save</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Code" required><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} disabled={editing !== 'new'} /></Field>
            <Field label="Full name" required className="col-span-2"><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
          </div>
          <Field label="Contact number"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-slate-700">Assigned collection areas</legend>
            <div className="space-y-1 rounded-md border border-line p-2">
              {areas.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.areaIds.includes(a.id)} onChange={(e) => setForm({ ...form, areaIds: e.target.checked ? [...form.areaIds, a.id] : form.areaIds.filter((id) => id !== a.id) })} />
                  {a.name} <span className="text-xs text-muted">{a.code}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">Ended assignments are closed with an end date, not deleted.</p>
          </fieldset>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
        </div>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------- Areas & routes
export function AreasPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const areas = useApi<AreaRow[]>('/areas').data ?? [];
  const [editing, setEditing] = useState<AreaRow | 'new' | null>(null);
  const [form, setForm] = useState({ code: '', name: '', description: '', routeNotes: '', isActive: true });
  const [busy, setBusy] = useState(false);
  const [sheetFor, setSheetFor] = useState<{ areaId: number; collectorId: number } | null>(null);
  const sheet = useApi<RouteSheet>(sheetFor ? '/collections/route-sheet' : null, sheetFor ?? undefined).data;
  useEffect(() => {
    if (editing === 'new') setForm({ code: '', name: '', description: '', routeNotes: '', isActive: true });
    else if (editing) setForm({ code: editing.code, name: editing.name, description: editing.description ?? '', routeNotes: editing.routeNotes ?? '', isActive: editing.isActive });
  }, [editing]);
  const save = async () => {
    setBusy(true);
    try {
      if (editing === 'new') await api.post('/areas', form);
      else if (editing) await api.patch(`/areas/${editing.id}`, form);
      toast.success('Collection area saved');
      await queryClient.invalidateQueries();
      setEditing(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Areas & Routes"
        description="Collection areas, their route notes and printable route sheets."
        actions={can('collection.manage') && <Button variant="primary" onClick={() => setEditing('new')}><Plus /> New Area</Button>}
      />
      <Card>
        <SimpleTable
          head={[{ label: 'Code' }, { label: 'Area' }, { label: 'Route notes' }, { label: 'Collectors' }, { label: 'Subscribers', num: true }, { label: 'Status' }, { label: '' }]}
          rows={areas.map((a) => [
            a.code,
            <><span className="font-medium">{a.name}</span>{a.description && <span className="block text-xs text-muted">{a.description}</span>}</>,
            <span className="text-slate-600">{a.routeNotes}</span>,
            a.collectors.map((c) => c.name).join(', ') || <span className="text-muted">Unassigned</span>,
            count(a.subscriberCount),
            <StatusBadge status={a.isActive ? 'ACTIVE' : 'INACTIVE'} />,
            <span className="flex justify-end gap-1">
              {a.collectors.map((c) => (
                <Button key={c.id} size="sm" variant="ghost" onClick={() => setSheetFor({ areaId: a.id, collectorId: c.id })} title={`Route sheet for ${c.name}`}><Printer /> Route sheet</Button>
              ))}
              {can('collection.manage') && <Button size="sm" variant="ghost" onClick={() => setEditing(a)}><Pencil /> Edit</Button>}
            </span>,
          ])}
          empty="No collection areas yet."
        />
      </Card>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === 'new' ? 'New collection area' : 'Edit collection area'}
        size="sm"
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!form.code.trim() || !form.name.trim()} onClick={() => void save()}>Save</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Code" required><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} disabled={editing !== 'new'} /></Field>
            <Field label="Area name" required className="col-span-2"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          </div>
          <Field label="Description"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Route notes" hint="Printed guidance for the collector, e.g. where to start"><Textarea rows={3} value={form.routeNotes} onChange={(e) => setForm({ ...form, routeNotes: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
        </div>
      </Dialog>
      {sheetFor && sheet && <RouteSheetPrint sheet={sheet} onClose={() => setSheetFor(null)} />}
    </>
  );
}

// ---------------------------------------------------------------- Batches
const batchColumns: Column<BatchRow>[] = [
  { accessorKey: 'batchNo', header: 'Batch No.', cell: (c) => <span className="font-medium text-accent">{c.row.original.batchNo}</span> },
  { accessorKey: 'collectionDate', header: 'Date', cell: (c) => <span className="whitespace-nowrap">{date(c.row.original.collectionDate)}</span> },
  { accessorKey: 'collectorName', header: 'Collector' },
  { accessorKey: 'areaName', header: 'Area', enableSorting: false },
  { accessorKey: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.row.original.status} /> },
  { id: 'accounts', header: 'Collected / accounts', num: true, enableSorting: false, cell: (c) => `${c.row.original.collectedCount} / ${c.row.original.accountCount}`, csv: (r) => `${r.collectedCount}/${r.accountCount}` },
  { accessorKey: 'expectedTotal', header: 'Expected', num: true, cell: (c) => <Money value={c.row.original.expectedTotal} />, csv: (r) => (r.expectedTotal / 100).toFixed(2) },
  { id: 'cash', header: 'Cash collected', num: true, enableSorting: false, cell: (c) => <Money value={c.row.original.cashCollected} zeroDash />, csv: (r) => (r.cashCollected / 100).toFixed(2) },
  { id: 'noncash', header: 'Non-cash', num: true, enableSorting: false, cell: (c) => <Money value={c.row.original.nonCashCollected} zeroDash />, csv: (r) => (r.nonCashCollected / 100).toFixed(2) },
  { id: 'remitted', header: 'Cash remitted', num: true, enableSorting: false, cell: (c) => <Money value={c.row.original.cashRemitted} zeroDash />, csv: (r) => (r.cashRemitted / 100).toFixed(2) },
  {
    id: 'variance',
    header: 'Result',
    enableSorting: false,
    cell: (c) => {
      const b = c.row.original;
      if (b.varianceType) return <StatusBadge status={b.varianceType} label={b.varianceType === 'BALANCED' ? 'Balanced' : `${b.varianceType === 'SHORTAGE' ? 'Shortage' : 'Overage'} ${peso(Math.abs(b.difference))}`} />;
      if (b.status === 'REMITTED' && b.difference !== 0) return <StatusBadge status={b.difference < 0 ? 'SHORTAGE' : 'OVERAGE'} label={`${b.difference < 0 ? 'Short' : 'Over'} ${peso(Math.abs(b.difference))} · unreconciled`} />;
      return <span className="text-muted">—</span>;
    },
    csv: (r) => r.varianceType ?? '',
  },
];

function NewBatchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { collectors } = useLookups();
  const [collectorId, setCollectorId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [collectionDate, setCollectionDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const collector = collectors.find((c) => c.id === Number(collectorId));
  const sheet = useApi<RouteSheet>(collectorId && areaId ? '/collections/route-sheet' : null, { collectorId, areaId, asOf: collectionDate });
  useEffect(() => {
    if (open) {
      setCollectorId('');
      setAreaId('');
      setCollectionDate(todayIso());
      setNotes('');
    }
  }, [open]);
  useEffect(() => {
    setAreaId(collector?.areas.length === 1 ? String(collector.areas[0].id) : '');
  }, [collector]);
  const create = async () => {
    setBusy(true);
    try {
      const batch = await api.post<BatchDetail>('/batches', { collectorId: Number(collectorId), areaId: Number(areaId), collectionDate, notes: notes.trim() || undefined });
      toast.success(`Batch ${batch.batchNo} created with ${batch.accountCount} accounts`);
      await queryClient.invalidateQueries();
      onOpenChange(false);
      navigate(`/collections/batches/${batch.id}`);
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
      title="New collection batch"
      description="Loads every assigned subscriber in the area who has an amount due."
      size="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!collectorId || !areaId || !sheet.data?.rows.length} onClick={() => void create()}>Create batch</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Collector" required>
          <Select value={collectorId} onChange={(e) => setCollectorId(e.target.value)} autoFocus>
            <option value="">Select a collector…</option>
            {collectors.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
          </Select>
        </Field>
        <Field label="Collection area" required>
          <Select value={areaId} onChange={(e) => setAreaId(e.target.value)} disabled={!collector}>
            <option value="">Select an area…</option>
            {collector?.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Collection date" required><Input type="date" value={collectionDate} max={todayIso()} onChange={(e) => setCollectionDate(e.target.value)} /></Field>
        <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {sheet.data && (
          <Notice tone={sheet.data.rows.length ? 'info' : 'warning'}>
            {sheet.data.rows.length ? `${sheet.data.rows.length} accounts · expected receivable ${peso(sheet.data.totals.totalDue)} (current ${peso(sheet.data.totals.currentBill)}, arrears ${peso(sheet.data.totals.arrears)})` : 'No assigned subscriber in this area has an amount due.'}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}

export function BatchesPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { collectors, areas } = useLookups();
  const [status, setStatus] = useState('');
  const [collectorId, setCollectorId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Collection Batches"
        description="House-to-house collection runs: Open → In progress → Submitted → Remitted → Reconciled → Closed."
        actions={can('collection.manage') && <Button variant="primary" onClick={() => setCreating(true)}><Plus /> New Batch</Button>}
      />
      <DataTable<BatchRow>
        endpoint="/batches"
        columns={batchColumns}
        params={{ status, collectorId, areaId }}
        searchPlaceholder="Batch no., collector, area…"
        exportName="collection-batches"
        onRowClick={(row) => navigate(`/collections/batches/${row.id}`)}
        filters={
          <>
            <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'ACTIVE', label: 'Not yet closed' }, ...statusOptions(BATCH_STATUSES)]} />
            <FilterSelect label="Collector" value={collectorId} onChange={setCollectorId} options={collectors.map((c) => ({ value: c.id, label: c.fullName }))} />
            <FilterSelect label="Area" value={areaId} onChange={setAreaId} options={areas.map((a) => ({ value: a.id, label: a.name }))} />
          </>
        }
      />
      <NewBatchDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

/** Batches whose cash still has to be turned over, counted or confirmed. */
export function RemittancePage() {
  const navigate = useNavigate();
  const { collectors } = useLookups();
  const [collectorId, setCollectorId] = useState('');
  const [status, setStatus] = useState('FOR_REMITTANCE');
  return (
    <>
      <PageHeader title="Remittance" description="Record the cash each collector turns over, reconcile it against cash collected, and close the batch. Open a batch to reconcile it." />
      <DataTable<BatchRow>
        endpoint="/batches"
        columns={batchColumns}
        params={{ status, collectorId }}
        exportName="remittance"
        searchPlaceholder="Batch no., collector, area…"
        onRowClick={(row) => navigate(`/collections/batches/${row.id}`)}
        emptyTitle="No batches are waiting for remittance or reconciliation"
        filters={
          <>
            <Select aria-label="Stage" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
              <option value="FOR_REMITTANCE">Waiting: submitted, remitted or reconciled</option>
              <option value="SUBMITTED">Submitted · awaiting cash</option>
              <option value="REMITTED">Remitted · awaiting reconciliation</option>
              <option value="RECONCILED">Reconciled · awaiting closing</option>
              <option value="CLOSED">Closed</option>
            </Select>
            <FilterSelect label="Collector" value={collectorId} onChange={setCollectorId} options={collectors.map((c) => ({ value: c.id, label: c.fullName }))} />
          </>
        }
      />
    </>
  );
}
