import { formatDate, formatMoney, type ReportColumn, type ReportData } from '@bcis/shared';
import ExcelJS from 'exceljs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import pdfmake from 'pdfmake';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { config } from '../../config';

const NAVY = '0F2747';
/** Byte-order mark so spreadsheet programs open UTF-8 CSV files correctly. */
const BOM = String.fromCharCode(0xfeff);
type Cell = string | number | null | undefined;

function display(value: Cell, type: ReportColumn['type']): string {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'money') return typeof value === 'number' ? formatMoney(value) : String(value);
  if (type === 'percent') return typeof value === 'number' ? `${value.toFixed(1)}%` : String(value);
  if (type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? formatDate(String(value)) : String(value);
  if (type === 'int') return typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
  return String(value);
}

const generatedLine = (report: ReportData) =>
  `Generated ${new Date(report.generatedAt).toLocaleString('en-PH', { timeZone: config.timeZone, dateStyle: 'medium', timeStyle: 'short' })} by ${report.generatedBy}`;

// ------------------------------------------------------------------ XLSX
export async function renderXlsx(report: ReportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BCIS Billing and Collection System';
  workbook.created = new Date(report.generatedAt);
  const sheet = workbook.addWorksheet(report.title.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31), {
    pageSetup: { orientation: report.landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });

  sheet.addRow([report.company]).font = { bold: true, size: 14, color: { argb: `FF${NAVY}` } };
  sheet.addRow([report.title]).font = { bold: true, size: 12 };
  sheet.addRow([report.subtitle]);
  for (const line of report.header) sheet.addRow([`${line.label}: ${line.value}`]);
  sheet.addRow([generatedLine(report)]).font = { italic: true, color: { argb: 'FF64748B' } };
  sheet.addRow([]);

  const headerRow = sheet.addRow(report.columns.map((c) => c.header));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${NAVY}` } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  sheet.views = [{ state: 'frozen', ySplit: headerRow.number }];

  // Spreadsheet cells hold pesos as decimals for display; the authoritative centavo values stay in the database.
  const toCell = (value: Cell, type: ReportColumn['type']): ExcelJS.CellValue => {
    if (value === null || value === undefined) return null;
    if (type === 'money' && typeof value === 'number') return value / 100;
    if (type === 'percent' && typeof value === 'number') return value / 100;
    return value;
  };
  const addDataRow = (row: Record<string, Cell>, bold = false) => {
    const added = sheet.addRow(report.columns.map((c) => toCell(row[c.key], c.type)));
    report.columns.forEach((c, i) => {
      const cell = added.getCell(i + 1);
      if (c.type === 'money') cell.numFmt = '#,##0.00;[Red]-#,##0.00';
      if (c.type === 'percent') cell.numFmt = '0.0%';
      if (c.type === 'int') cell.numFmt = '#,##0';
      if (c.type !== 'text' && c.type !== 'date') cell.alignment = { horizontal: 'right' };
      if (bold) {
        cell.font = { bold: true };
        cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
      }
    });
  };
  report.rows.forEach((row) => addDataRow(row));
  if (report.totals) addDataRow(report.totals, true);
  if (report.rows.length) sheet.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: report.columns.length } };

  report.columns.forEach((c, i) => {
    const longest = Math.max(c.header.length, ...report.rows.slice(0, 500).map((r) => display(r[c.key], c.type).length));
    sheet.getColumn(i + 1).width = Math.min(Math.max(longest + 3, 11), 48);
  });
  if (report.notes.length) {
    sheet.addRow([]);
    for (const note of report.notes) sheet.addRow([note]).font = { italic: true, color: { argb: 'FF64748B' } };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ------------------------------------------------------------------ PDF
let fontsReady = false;
function preparePdfmake(): void {
  if (fontsReady) return;
  const fontDir = join(dirname(createRequire(import.meta.url).resolve('pdfmake/package.json')), 'fonts', 'Roboto');
  pdfmake.setFonts({
    Roboto: {
      normal: join(fontDir, 'Roboto-Regular.ttf'),
      bold: join(fontDir, 'Roboto-Medium.ttf'),
      italics: join(fontDir, 'Roboto-Italic.ttf'),
      bolditalics: join(fontDir, 'Roboto-MediumItalic.ttf'),
    },
  });
  // Reports never load remote resources, and only the bundled fonts may be read from disk.
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy((path: string) => path.startsWith(fontDir));
  fontsReady = true;
}

export async function renderPdf(report: ReportData): Promise<Buffer> {
  preparePdfmake();
  const numeric = (c: ReportColumn) => c.type === 'money' || c.type === 'int' || c.type === 'percent';
  const fontSize = report.columns.length > 9 ? 7 : 8;
  const cells = (row: Record<string, Cell>, bold: boolean): TableCell[] =>
    report.columns.map((c) => ({ text: display(row[c.key], c.type), alignment: numeric(c) ? 'right' : 'left', bold, fontSize }));

  const body: TableCell[][] = [
    report.columns.map((c) => ({ text: c.header, bold: true, color: 'white', fillColor: `#${NAVY}`, alignment: numeric(c) ? 'right' : 'left', fontSize })),
    ...report.rows.map((row) => cells(row, false)),
  ];
  if (!report.rows.length) body.push([{ text: 'No records for the selected parameters.', colSpan: report.columns.length, italics: true, color: '#64748B', margin: [0, 6, 0, 6] }, ...Array(report.columns.length - 1).fill({})]);
  if (report.totals) body.push(cells(report.totals, true).map((cell) => ({ ...(cell as object), fillColor: '#EEF2F7' }) as TableCell));

  const content: Content[] = [
    { text: report.company, fontSize: 13, bold: true, color: `#${NAVY}` },
    { text: report.title, fontSize: 11, bold: true, margin: [0, 2, 0, 0] },
    { text: report.subtitle, fontSize: 9, color: '#334155' },
    ...report.header.map((h): Content => ({ text: [{ text: `${h.label}: `, bold: true }, h.value], fontSize: 9, margin: [0, 1, 0, 0] })),
    { text: 'Amounts are in Philippine pesos (PHP).', fontSize: 7, color: '#64748B', margin: [0, 3, 0, 8] },
    {
      table: { headerRows: 1, widths: report.columns.map((c) => (c.width ? '*' : 'auto')), body },
      layout: {
        hLineWidth: (i: number) => (i === 0 || i === 1 ? 0 : 0.4),
        vLineWidth: () => 0,
        hLineColor: () => '#CBD5E1',
        paddingTop: () => 3,
        paddingBottom: () => 3,
        fillColor: (rowIndex: number) => (rowIndex > 0 && rowIndex % 2 === 0 ? '#F6F8FB' : null),
      },
    },
    ...report.notes.map((n): Content => ({ text: n, fontSize: 7, italics: true, color: '#64748B', margin: [0, 6, 0, 0] })),
  ];

  const doc: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: report.landscape ? 'landscape' : 'portrait',
    pageMargins: [28, 30, 28, 34],
    defaultStyle: { font: 'Roboto', fontSize: 8 },
    info: { title: `${report.title} - ${report.company}`, author: report.generatedBy },
    content,
    footer: (currentPage: number, pageCount: number) => ({
      margin: [28, 10, 28, 0],
      columns: [
        { text: generatedLine(report), fontSize: 7, color: '#64748B' },
        { text: `Page ${currentPage} of ${pageCount}`, alignment: 'right', fontSize: 7, color: '#64748B' },
      ],
    }),
  };
  return pdfmake.createPdf(doc).getBuffer();
}

// ------------------------------------------------------------------ CSV
export function renderCsv(report: ReportData): Buffer {
  const escape = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const plain = (value: Cell, type: ReportColumn['type']) => {
    if (value === null || value === undefined) return '';
    if (type === 'money' && typeof value === 'number') return formatMoney(value).replace(/,/g, '');
    // Neutralise spreadsheet formula injection in exported text.
    return typeof value === 'string' && /^[=+\-@]/.test(value) ? `'${value}` : String(value);
  };
  const lines = [report.columns.map((c) => escape(c.header)).join(',')];
  for (const row of report.rows) lines.push(report.columns.map((c) => escape(plain(row[c.key], c.type))).join(','));
  if (report.totals) lines.push(report.columns.map((c) => escape(plain(report.totals![c.key], c.type))).join(','));
  return Buffer.from(BOM + lines.join('\r\n') + '\r\n', 'utf8');
}
