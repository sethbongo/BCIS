import type { ReportData, ReportDefinition } from '@bcis/shared';
import { audit } from '../../lib/audit';
import { can, type Ctx } from '../../lib/context';
import { forbidden, invalid, notFound } from '../../lib/errors';
import { getSettings } from '../../lib/settings';
import { defaultParams, REPORTS, type ReportQuery } from './definitions';
import { renderCsv, renderPdf, renderXlsx } from './render';

export function listReports(): ReportDefinition[] {
  return REPORTS.map(({ build: _build, ...definition }) => definition);
}

export async function buildReport({ db, actor }: Ctx, key: string, query: ReportQuery): Promise<ReportData> {
  const definition = REPORTS.find((r) => r.key === key);
  if (!definition) throw notFound('Report');
  if (definition.category === 'Audit & Control' && !can(actor, 'audit.view')) throw forbidden('Audit reports require the audit.view permission.');
  const params = defaultParams(query);
  if (params.from > params.to) throw invalid('The start date must be on or before the end date.', { from: 'After end date' });
  if (definition.params.includes('subscriberId') && !params.subscriberId) throw invalid('Select a subscriber for this report.', { subscriberId: 'Required' });
  const built = await definition.build(db, params);
  const settings = await getSettings(db);
  return {
    key,
    title: definition.title,
    generatedAt: new Date().toISOString(),
    generatedBy: actor.fullName,
    company: String(settings['company.name']),
    landscape: definition.landscape ?? false,
    header: [],
    notes: [],
    ...built,
  };
}

export interface ReportFile {
  data: Buffer;
  contentType: string;
  fileName: string;
}

export async function exportReport(ctx: Ctx, key: string, query: ReportQuery): Promise<ReportFile> {
  if (!can(ctx.actor, 'report.export')) throw forbidden('You do not have permission to export reports.');
  const report = await buildReport(ctx, key, query);
  const stem = `${key}-${report.generatedAt.slice(0, 10)}`;
  await audit(ctx.db, ctx.actor, { action: 'report.export', entityType: 'report', entityId: key, newValues: { format: query.format, rows: report.rows.length } });
  if (query.format === 'xlsx') {
    return { data: await renderXlsx(report), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: `${stem}.xlsx` };
  }
  if (query.format === 'pdf') return { data: await renderPdf(report), contentType: 'application/pdf', fileName: `${stem}.pdf` };
  return { data: renderCsv(report), contentType: 'text/csv; charset=utf-8', fileName: `${stem}.csv` };
}
