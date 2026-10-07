import { formatDate, type ReportColumn, type ReportData, type ReportDefinition, type ReportParam, type SubscriberRow } from '@bcis/shared';
import { FileSpreadsheet, FileText, Play, Printer, Sheet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PrintPreview, SubscriberPicker, useLookups } from '../components/common';
import { Button, Card, cn, EmptyState, Field, Input, Notice, PageHeader, Select, Spinner } from '../components/ui';
import { api, errorMessage, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, money, todayIso } from '../lib/format';

function cellText(value: string | number | null | undefined, type: ReportColumn['type']): string {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'money') return typeof value === 'number' ? money(value) : String(value);
  if (type === 'percent') return typeof value === 'number' ? `${value.toFixed(1)}%` : String(value);
  if (type === 'int') return typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
  if (type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? formatDate(String(value)) : String(value);
  return String(value);
}
const isNumeric = (c: ReportColumn) => c.type === 'money' || c.type === 'int' || c.type === 'percent';

function ReportTable({ report, print }: { report: ReportData; print?: boolean }) {
  return (
    <table className={print ? undefined : 'w-full border-separate border-spacing-0 text-sm'}>
      <thead>
        <tr>
          {report.columns.map((c) => (
            <th key={c.key} style={isNumeric(c) ? { textAlign: 'right' } : undefined} className={print ? undefined : 'sticky top-0 border-b border-line bg-slate-50 px-3 py-2 text-left text-xs font-medium text-slate-600'}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {report.rows.map((row, i) => (
          <tr key={i}>
            {report.columns.map((c) => (
              <td key={c.key} className={cn(isNumeric(c) && 'num', !print && 'border-b border-line px-3 py-1.5')}>
                {cellText(row[c.key], c.type)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {report.totals && (
        <tfoot>
          <tr>
            {report.columns.map((c) => (
              <td key={c.key} className={cn(isNumeric(c) && 'num', !print && 'sticky bottom-0 border-t border-line-strong bg-slate-50 px-3 py-2 font-semibold')}>
                {cellText(report.totals![c.key], c.type)}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

const monthStart = () => `${todayIso().slice(0, 7)}-01`;

export function ReportsPage() {
  const { can } = useAuth();
  const { areas, collectors } = useLookups();
  const catalog = (useApi<ReportDefinition[]>('/reports').data ?? []).filter((r) => r.category !== 'Audit & Control' || can('audit.view'));
  const [key, setKey] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, string>>({ from: monthStart(), to: todayIso(), groupBy: 'day', dimension: 'plan', year: todayIso().slice(0, 4), collectorId: '', areaId: '', subscriberId: '' });
  const [subscriber, setSubscriber] = useState<SubscriberRow | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const definition = catalog.find((r) => r.key === key) ?? null;
  useEffect(() => {
    if (!key && catalog.length) setKey(catalog[0].key);
  }, [key, catalog]);
  useEffect(() => {
    setReport(null);
    setError(null);
  }, [key]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ReportDefinition[]>();
    for (const r of catalog) groups.set(r.category, [...(groups.get(r.category) ?? []), r]);
    return [...groups.entries()];
  }, [catalog]);

  const query = () => {
    const q: Record<string, string> = {};
    for (const p of definition?.params ?? []) if (params[p]) q[p] = params[p];
    return q;
  };
  const has = (p: ReportParam) => definition?.params.includes(p);
  const missingSubscriber = has('subscriberId') && !params.subscriberId;

  const run = async () => {
    if (!definition) return;
    setBusy('run');
    setError(null);
    try {
      setReport(await api.get<ReportData>(`/reports/${definition.key}`, query()));
    } catch (err) {
      setReport(null);
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const exportAs = async (format: 'pdf' | 'xlsx' | 'csv') => {
    if (!definition) return;
    setBusy(format);
    await api.download(`/reports/${definition.key}`, { ...query(), format });
    setBusy(null);
  };
  const set = (name: string) => (e: { target: { value: string } }) => setParams((p) => ({ ...p, [name]: e.target.value }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Reports" description="Run a report on screen, then print it or export to PDF, XLSX or CSV." />
      <div className="grid min-h-0 flex-1 grid-cols-[17rem_1fr] gap-3">
        <Card className="min-h-0 overflow-auto py-2">
          {grouped.map(([category, items]) => (
            <div key={category} className="mb-2">
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{category}</p>
              {items.map((r) => (
                <button key={r.key} onClick={() => setKey(r.key)} aria-current={r.key === key} className={cn('block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50', r.key === key && 'bg-accent-50 font-medium text-accent hover:bg-accent-50')}>
                  {r.title}
                </button>
              ))}
            </div>
          ))}
        </Card>

        <Card className="flex min-h-0 flex-col">
          {!definition ? (
            <Spinner />
          ) : (
            <>
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-base font-semibold">{definition.title}</h2>
                <p className="text-sm text-muted">{definition.description}</p>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  {has('subscriberId') && (
                    <Field label="Subscriber" required className="w-80">
                      {subscriber ? (
                        <div className="flex h-8.5 items-center justify-between rounded-md border border-line bg-slate-50 px-2.5 text-sm">
                          <span className="truncate">{subscriber.fullName} · {subscriber.accountNo}</span>
                          <button className="text-xs font-medium text-accent" onClick={() => { setSubscriber(null); setParams((p) => ({ ...p, subscriberId: '' })); }}>
                            Change
                          </button>
                        </div>
                      ) : (
                        <SubscriberPicker placeholder="Find subscriber…" onSelect={(s) => { setSubscriber(s); setParams((p) => ({ ...p, subscriberId: String(s.id) })); }} />
                      )}
                    </Field>
                  )}
                  {has('from') && <Field label="From"><Input type="date" value={params.from} onChange={set('from')} className="w-40" /></Field>}
                  {has('to') && <Field label="To"><Input type="date" value={params.to} onChange={set('to')} className="w-40" /></Field>}
                  {has('year') && (
                    <Field label="Year">
                      <Select value={params.year} onChange={set('year')} className="w-28">
                        {Array.from({ length: 5 }, (_, i) => String(Number(todayIso().slice(0, 4)) - i)).map((y) => <option key={y}>{y}</option>)}
                      </Select>
                    </Field>
                  )}
                  {has('groupBy') && (
                    <Field label="Group by">
                      <Select value={params.groupBy} onChange={set('groupBy')} className="w-36">
                        <option value="day">Day (daily)</option>
                        <option value="week">Week (weekly)</option>
                        <option value="month">Month (monthly)</option>
                        <option value="year">Year (annual)</option>
                      </Select>
                    </Field>
                  )}
                  {has('dimension') && (
                    <Field label="Revenue by">
                      <Select value={params.dimension} onChange={set('dimension')} className="w-40">
                        <option value="plan">Plan</option>
                        <option value="service">Service type</option>
                        <option value="area">Collection area</option>
                      </Select>
                    </Field>
                  )}
                  {has('collectorId') && (
                    <Field label="Collector">
                      <Select value={params.collectorId} onChange={set('collectorId')} className="w-44">
                        <option value="">All collectors</option>
                        {collectors.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
                      </Select>
                    </Field>
                  )}
                  {has('areaId') && (
                    <Field label="Area">
                      <Select value={params.areaId} onChange={set('areaId')} className="w-40">
                        <option value="">All areas</option>
                        {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </Select>
                    </Field>
                  )}
                  <Button variant="primary" onClick={() => void run()} loading={busy === 'run'} disabled={missingSubscriber}>
                    <Play /> Run report
                  </Button>
                  <div className="ml-auto flex gap-2">
                    <Button onClick={() => setPrinting(true)} disabled={!report}><Printer /> Print</Button>
                    {can('report.export') && (
                      <>
                        <Button onClick={() => void exportAs('pdf')} loading={busy === 'pdf'} disabled={missingSubscriber}><FileText /> PDF</Button>
                        <Button onClick={() => void exportAs('xlsx')} loading={busy === 'xlsx'} disabled={missingSubscriber}><FileSpreadsheet /> XLSX</Button>
                        <Button onClick={() => void exportAs('csv')} loading={busy === 'csv'} disabled={missingSubscriber}><Sheet /> CSV</Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {error && <div className="p-4"><Notice tone="danger">{error}</Notice></div>}
                {!report && !error && <EmptyState title="Set the parameters and run the report" description="Exports use the same parameters as the on-screen report." />}
                {report && (
                  <>
                    <div className="border-b border-line px-4 py-2 text-xs text-muted">
                      <span className="font-medium text-ink">{report.subtitle}</span> · {report.rows.length.toLocaleString()} row{report.rows.length === 1 ? '' : 's'} · generated {dateTime(report.generatedAt)}
                      {report.header.length > 0 && <span className="mt-0.5 block">{report.header.map((h) => `${h.label}: ${h.value}`).join(' · ')}</span>}
                    </div>
                    <ReportTable report={report} />
                    {report.rows.length === 0 && <EmptyState title="No records for the selected parameters" />}
                    {report.notes.map((n) => <p key={n} className="px-4 py-1.5 text-xs italic text-muted">{n}</p>)}
                  </>
                )}
              </div>
            </>
          )}
        </Card>
      </div>
      {printing && report && (
        <PrintPreview title={report.title} fileName={`${report.key}-${todayIso()}`} landscape={report.landscape} onClose={() => setPrinting(false)}>
          <header className="mb-3 border-b-2 border-navy pb-2">
            <p className="text-base font-bold text-navy">{report.company}</p>
            <p className="text-sm font-bold">{report.title}</p>
            <p className="text-[10px] text-slate-600">{report.subtitle}</p>
            {report.header.map((h) => <p key={h.label} className="text-[10px]"><strong>{h.label}:</strong> {h.value}</p>)}
          </header>
          <ReportTable report={report} print />
          {report.notes.map((n) => <p key={n} className="mt-2 text-[9px] italic text-slate-500">{n}</p>)}
          <p className="mt-3 text-[9px] text-slate-500">Generated {dateTime(report.generatedAt)} by {report.generatedBy}. Amounts in Philippine pesos.</p>
        </PrintPreview>
      )}
    </div>
  );
}
