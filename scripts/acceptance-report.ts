/**
 * Builds tests/acceptance-test-report.pdf from real test output:
 *   tests/.tmp/vitest-results.json  (npm test -- --reporter=json --outputFile=tests/.tmp/vitest-results.json)
 *   tests/.tmp/e2e-results.json     (npm run test:e2e)
 * Usage: npm run test:report   (runs the suites first, then this script)
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pdfmake from 'pdfmake';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(root, 'tests', '.tmp');

interface Result {
  suite: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
}

const ACCEPTANCE: { id: string; scenario: string; expected: string }[] = [
  { id: 'AT-01', scenario: 'Exact payment (invoice 999.00, payment 999.00)', expected: 'Remaining 0.00; invoice PAID; ledger balanced; receipt created.' },
  { id: 'AT-02', scenario: 'Partial payment (invoice 999.00, payment 500.00)', expected: 'Remaining 499.00; PARTIALLY_PAID; allocation and ledger correct.' },
  { id: 'AT-03', scenario: 'Advance payment (monthly 1,000.00, payment 3,000.00)', expected: 'Excess kept as advance credit and applied to later invoices; no value lost.' },
  { id: 'AT-04', scenario: 'Oldest-first arrears (Aug 999.00 + Sep 999.00, payment 1,200.00)', expected: 'August 0.00; September 798.00 remaining.' },
  { id: 'AT-05', scenario: 'Duplicate GCash reference', expected: 'Flagged at submission; verification and posting blocked.' },
  { id: 'AT-06', scenario: 'Payment reversal', expected: 'Original visible; linked reversal; balances restored; actor and reason audited.' },
  { id: 'AT-07', scenario: 'Collector balanced remittance (20,000.00 / 20,000.00)', expected: 'Difference 0.00; batch reconciles and closes.' },
  { id: 'AT-08', scenario: 'Collector shortage (20,000.00 / 19,500.00)', expected: '500.00 shortage displayed; cannot be closed as balanced.' },
  { id: 'AT-09', scenario: 'Concurrent users (three clients)', expected: 'No corruption, duplicate numbering or cross-session effect.' },
  { id: 'AT-10', scenario: 'Authorization (cashier calls admin-only operations)', expected: 'Server rejects the operation even when the API is called directly.' },
  { id: 'AT-11', scenario: 'Duplicate billing (generation run twice)', expected: 'No duplicate finalized invoice per service account and period.' },
  { id: 'AT-12', scenario: 'Backup and restore', expected: 'Restored database passes the integrity check; expected records return.' },
];

function readVitest(): Result[] {
  const file = join(tmp, 'vitest-results.json');
  if (!existsSync(file)) return [];
  const json = JSON.parse(readFileSync(file, 'utf8')) as { testResults: { name: string; assertionResults: { ancestorTitles: string[]; title: string; status: string; duration?: number }[] }[] };
  return json.testResults.flatMap((f) =>
    f.assertionResults.map((a) => ({
      suite: `${f.name.includes('acceptance') ? 'API acceptance' : 'Unit'} · ${a.ancestorTitles.join(' › ')}`,
      name: a.title,
      status: a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'skipped',
      durationMs: Math.round(a.duration ?? 0),
    })),
  );
}

interface PwSuite {
  title: string;
  specs?: { title: string; tests: { results: { status: string; duration: number }[] }[] }[];
  suites?: PwSuite[];
}
function readPlaywright(): Result[] {
  const file = join(tmp, 'e2e-results.json');
  if (!existsSync(file)) return [];
  const out: Result[] = [];
  const walk = (suite: PwSuite) => {
    for (const spec of suite.specs ?? []) {
      const result = spec.tests[0]?.results.at(-1);
      out.push({ suite: 'Desktop end-to-end (Electron)', name: spec.title, status: result?.status === 'passed' ? 'passed' : result?.status === 'skipped' ? 'skipped' : 'failed', durationMs: result?.duration ?? 0 });
    }
    suite.suites?.forEach(walk);
  };
  (JSON.parse(readFileSync(file, 'utf8')) as { suites: PwSuite[] }).suites.forEach(walk);
  return out;
}

const fontDir = join(dirname(createRequire(import.meta.url).resolve('pdfmake/package.json')), 'fonts', 'Roboto');
pdfmake.setFonts({ Roboto: { normal: join(fontDir, 'Roboto-Regular.ttf'), bold: join(fontDir, 'Roboto-Medium.ttf'), italics: join(fontDir, 'Roboto-Italic.ttf'), bolditalics: join(fontDir, 'Roboto-MediumItalic.ttf') } });
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((path: string) => path.startsWith(fontDir));

const results = [...readVitest(), ...readPlaywright()];
if (!results.length) {
  console.error('No test results found in tests/.tmp. Run `npm run test:report` so the suites execute first.');
  process.exit(1);
}
const count = (status: Result['status'], list = results) => list.filter((r) => r.status === status).length;
const statusCell = (status: string): TableCell => ({ text: status.toUpperCase(), bold: true, color: status === 'passed' ? '#047857' : status === 'failed' ? '#B91C1C' : '#64748B' });
const header = (labels: string[]): TableCell[] => labels.map((text) => ({ text, bold: true, color: 'white', fillColor: '#0F2747' }));
const layout = { hLineWidth: () => 0.4, vLineWidth: () => 0, hLineColor: () => '#CBD5E1', paddingTop: () => 3, paddingBottom: () => 3 };

const acceptanceRows = ACCEPTANCE.map((at) => {
  const matching = results.filter((r) => `${r.suite} ${r.name}`.includes(at.id));
  const status = !matching.length ? 'not run' : matching.some((r) => r.status === 'failed') ? 'failed' : matching.every((r) => r.status === 'passed') ? 'passed' : 'skipped';
  return [{ text: at.id, bold: true }, at.scenario, at.expected, { text: `${matching.length} automated test${matching.length === 1 ? '' : 's'}`, color: '#475569' }, statusCell(status)] as TableCell[];
});

const bySuite = new Map<string, Result[]>();
for (const r of results) bySuite.set(r.suite, [...(bySuite.get(r.suite) ?? []), r]);

const content: Content[] = [
  { text: 'BCIS Subscription Billing and Collection System', fontSize: 15, bold: true, color: '#0F2747' },
  { text: 'Acceptance Test Report', fontSize: 12, bold: true, margin: [0, 2, 0, 0] },
  { text: `Generated ${new Date().toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' })} from the automated test output. Node ${process.version}, Windows ${release()}, PostgreSQL test database.`, fontSize: 8, color: '#475569', margin: [0, 2, 0, 10] },
  {
    table: {
      widths: ['*', '*', '*', '*'],
      body: [
        header(['Total tests', 'Passed', 'Failed', 'Skipped']),
        [{ text: String(results.length), fontSize: 14, bold: true }, { text: String(count('passed')), fontSize: 14, bold: true, color: '#047857' }, { text: String(count('failed')), fontSize: 14, bold: true, color: count('failed') ? '#B91C1C' : '#0F172A' }, { text: String(count('skipped')), fontSize: 14, bold: true }],
      ],
    },
    layout,
    margin: [0, 0, 0, 12],
  },
  { text: '1. Mandatory acceptance tests (section 7 of the laboratory activity)', fontSize: 11, bold: true, margin: [0, 0, 0, 4] },
  { table: { headerRows: 1, widths: [34, 150, '*', 70, 46], body: [header(['ID', 'Scenario', 'Expected result', 'Evidence', 'Result']), ...acceptanceRows] }, layout, margin: [0, 0, 0, 6] },
  { text: 'Each scenario is exercised through the real HTTP API with authentication, authorization, validation and a real PostgreSQL database. The tests are in tests/acceptance/ and the domain rules are additionally unit tested in source/shared.', fontSize: 8, color: '#475569', margin: [0, 0, 0, 12] },
  { text: '2. All automated tests', fontSize: 11, bold: true, margin: [0, 0, 0, 4] },
  ...[...bySuite.entries()].flatMap(([suite, list]): Content[] => [
    { text: `${suite}  (${count('passed', list)}/${list.length} passed)`, fontSize: 9, bold: true, margin: [0, 6, 0, 2] },
    { table: { headerRows: 0, widths: ['*', 44, 46], body: list.map((r) => [r.name, { text: `${r.durationMs} ms`, alignment: 'right', color: '#64748B' }, statusCell(r.status)] as TableCell[]) }, layout },
  ]),
  { text: '3. How to reproduce', fontSize: 11, bold: true, margin: [0, 14, 0, 4] },
  { ul: ['npm run db:start   (local PostgreSQL)', 'npm test   (unit + API acceptance tests against the bcis_test database)', 'npm run db:reset -- --yes && npm run build -w @bcis/desktop && npm run test:e2e   (desktop end-to-end tests and screenshots)', 'npm run test:report   (runs everything and regenerates this document)'], fontSize: 9 },
];

const doc: TDocumentDefinitions = {
  pageSize: 'A4',
  pageMargins: [34, 34, 34, 36],
  defaultStyle: { font: 'Roboto', fontSize: 8.5 },
  info: { title: 'BCIS Acceptance Test Report' },
  content,
  footer: (page: number, pages: number) => ({ text: `BCIS Acceptance Test Report · page ${page} of ${pages}`, alignment: 'center', fontSize: 7, color: '#64748B', margin: [0, 12, 0, 0] }),
};

await pdfmake.createPdf(doc).write(join(root, 'tests', 'acceptance-test-report.pdf'));
console.log(`tests/acceptance-test-report.pdf written: ${results.length} tests, ${count('passed')} passed, ${count('failed')} failed.`);
if (count('failed')) process.exitCode = 1;
