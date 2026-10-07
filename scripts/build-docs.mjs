// Builds the documentation deliverables:
//   docs/data-dictionary.md          generated from the live database catalogue
//   docs/erd.pdf                     entity-relationship diagram generated from the foreign keys
//   docs/technical-documentation.pdf from docs/technical-documentation.md (+ data dictionary)
//   docs/user-manual.pdf             from docs/user-manual.md (with screenshots from tests/screenshots)
// Usage: npm run docs:build   (needs the local database running and migrated)
import { marked } from 'marked';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { ROOT, readEnv } from './env.mjs';

const require = createRequire(import.meta.url);
const docsDir = join(ROOT, 'docs');
const workDir = join(ROOT, 'tests', '.tmp', 'docs-build');
mkdirSync(workDir, { recursive: true });

// ---------------------------------------------------------------- database catalogue
const client = new pg.Client({ connectionString: readEnv().DATABASE_URL });
await client.connect();
const columns = (
  await client.query(`
    select c.table_name, c.column_name, c.data_type, c.udt_name, c.character_maximum_length as len, c.is_nullable = 'NO' as required, c.column_default as def,
           exists (select 1 from information_schema.table_constraints tc join information_schema.key_column_usage k using (constraint_name, table_schema)
                    where tc.constraint_type = 'PRIMARY KEY' and tc.table_name = c.table_name and k.column_name = c.column_name and tc.table_schema = 'public') as pk
      from information_schema.columns c where c.table_schema = 'public' order by c.table_name, c.ordinal_position`)
).rows;
const fks = (
  await client.query(`
    select cl.relname as child, a.attname as col, pr.relname as parent
      from pg_constraint co
      join pg_class cl on cl.oid = co.conrelid join pg_class pr on pr.oid = co.confrelid
      join pg_attribute a on a.attrelid = co.conrelid and a.attnum = co.conkey[1]
      join pg_namespace n on n.oid = cl.relnamespace
     where co.contype = 'f' and n.nspname = 'public' order by 1, 2`)
).rows;
const constraints = (
  await client.query(`
    select cl.relname as tbl, co.conname as name, case co.contype when 'c' then 'CHECK' when 'u' then 'UNIQUE' end as kind, pg_get_constraintdef(co.oid) as def
      from pg_constraint co join pg_class cl on cl.oid = co.conrelid join pg_namespace n on n.oid = cl.relnamespace
     where n.nspname = 'public' and co.contype in ('c', 'u') order by 1, 3, 2`)
).rows;
const indexes = (await client.query(`select tablename as tbl, indexname as name, indexdef as def from pg_indexes where schemaname = 'public' and indexname not like '%_pkey' order by 1, 2`)).rows;
await client.end();

const typeOf = (c) => (c.data_type === 'USER-DEFINED' ? `enum ${c.udt_name}` : c.data_type === 'character varying' ? `varchar(${c.len})` : c.data_type === 'character' ? `char(${c.len})` : c.data_type.replace('timestamp with time zone', 'timestamptz'));
const tables = [...new Set(columns.map((c) => c.table_name))];
const fkOf = (table, column) => fks.find((f) => f.child === table && f.col === column)?.parent;

let dictionary = '# Data Dictionary\n\nGenerated from the live PostgreSQL catalogue by `npm run docs:build`. Money columns are `bigint` integer centavos.\n';
for (const table of tables) {
  dictionary += `\n## ${table}\n\n| Column | Type | Required | Key | Default |\n|---|---|---|---|---|\n`;
  for (const c of columns.filter((x) => x.table_name === table)) {
    const key = [c.pk ? 'PK' : '', fkOf(table, c.column_name) ? `FK → ${fkOf(table, c.column_name)}` : ''].filter(Boolean).join(', ');
    dictionary += `| ${c.column_name} | ${typeOf(c)} | ${c.required ? 'yes' : ''} | ${key} | ${c.def ? '`' + String(c.def).replace(/\|/g, '\\|').slice(0, 40) + '`' : ''} |\n`;
  }
  const rules = constraints.filter((x) => x.tbl === table);
  if (rules.length) dictionary += `\nConstraints:\n\n${rules.map((r) => `- **${r.kind}** \`${r.name}\`: \`${r.def.replace(/\s+/g, ' ').slice(0, 300)}\``).join('\n')}\n`;
  const idx = indexes.filter((x) => x.tbl === table && !rules.some((r) => r.name === x.name));
  if (idx.length) dictionary += `\nIndexes:\n\n${idx.map((i) => `- \`${i.name}\`${/UNIQUE/.test(i.def) ? ' (unique)' : ''}: \`${i.def.replace(/^.* USING /, '').slice(0, 200)}\``).join('\n')}\n`;
}
writeFileSync(join(docsDir, 'data-dictionary.md'), dictionary);

// ---------------------------------------------------------------- ERD (Mermaid)
// One overview of every table and relationship, then one detailed diagram per domain so the
// attributes stay readable on a printed page. "Who did it" links to users (created_by, ...) are
// left out of the business diagrams; they all appear in the Security diagram's description.
const DOMAINS = [
  { title: 'Security', tables: ['users', 'roles', 'permissions', 'role_permissions', 'user_roles', 'sessions'] },
  { title: 'Subscribers and Services', tables: ['subscribers', 'subscriber_addresses', 'service_types', 'service_plans', 'service_accounts', 'service_events', 'suspension_records', 'reconnection_records'] },
  { title: 'Billing and Ledger', tables: ['billing_cycles', 'invoices', 'invoice_items', 'adjustments', 'ledger_entries'] },
  { title: 'Payments and Receipts', tables: ['payments', 'payment_allocations', 'payment_proofs', 'payment_reversals', 'receipts'] },
  { title: 'Collections', tables: ['collection_areas', 'collectors', 'collector_assignments', 'collection_batches', 'batch_accounts', 'collector_remittances'] },
  { title: 'System', tables: ['audit_logs', 'application_settings', 'backup_history', 'number_sequences'] },
];
const isAuditLink = (fk) => fk.parent === 'users' && !['user_roles', 'sessions'].includes(fk.child);
const entity = (table) => {
  const shown = columns.filter((c) => c.table_name === table && (c.pk || fkOf(table, c.column_name) || /_no$|^code$|^status$|amount|^total$|balance|^period$|^username$|_date$|^debit$|^credit$|^difference$|^action$|^name$|^key$/.test(c.column_name))).slice(0, 14);
  return [`  ${table} {`, ...shown.map((c) => `    ${typeOf(c).replace(/[^a-z0-9_]/gi, '_')} ${c.column_name}${c.pk ? ' PK' : fkOf(table, c.column_name) ? ' FK' : ''}`), '  }'];
};
const relation = (fk) => `  ${fk.parent} ||--o{ ${fk.child} : "${fk.col}"`;

const diagrams = [{ title: 'Overview: all tables and relationships', source: ['erDiagram', ...tables.map((t) => `  ${t}`), ...fks.filter((fk) => !isAuditLink(fk)).map(relation)] }];
for (const domain of DOMAINS) {
  const own = new Set(domain.tables);
  const links = fks.filter((fk) => (own.has(fk.child) || own.has(fk.parent)) && (domain.title === 'Security' ? own.has(fk.child) && own.has(fk.parent) : !isAuditLink(fk)));
  const neighbours = [...new Set(links.flatMap((fk) => [fk.parent, fk.child]))].filter((t) => !own.has(t));
  diagrams.push({ title: domain.title, source: ['erDiagram', ...domain.tables.flatMap(entity), ...neighbours.map((t) => `  ${t}`), ...links.map(relation)] });
}
const missing = tables.filter((t) => !DOMAINS.some((d) => d.tables.includes(t)));
if (missing.length) throw new Error(`Tables missing from the ERD domains in build-docs.mjs: ${missing.join(', ')}`);
writeFileSync(join(docsDir, 'erd.mmd'), diagrams.map((d) => `%% ${d.title}\n${d.source.join('\n')}\n`).join('\n'));

// ---------------------------------------------------------------- HTML pages
const mermaidJs = pathToFileURL(require.resolve('mermaid/dist/mermaid.min.js')).toString();
const fontCss = pathToFileURL(require.resolve('@fontsource-variable/inter/index.css')).toString();
const style = `
  @import url('${fontCss}');
  body { font-family: 'Inter Variable', 'Segoe UI', sans-serif; font-size: 10.5pt; line-height: 1.5; color: #0f172a; margin: 0; }
  h1 { font-size: 20pt; color: #0f2747; border-bottom: 2px solid #0f2747; padding-bottom: 6px; margin-top: 0; page-break-before: always; }
  h1:first-of-type { page-break-before: avoid; }
  h2 { font-size: 13.5pt; color: #0f2747; margin-top: 22px; page-break-after: avoid; }
  h3 { font-size: 11pt; margin-top: 16px; page-break-after: avoid; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 14px; font-size: 9pt; }
  th { background: #0f2747; color: white; text-align: left; padding: 4px 7px; }
  td { border-bottom: 1px solid #e2e8f0; padding: 3px 7px; vertical-align: top; }
  tr { page-break-inside: avoid; }
  code { font-family: Consolas, monospace; font-size: 9pt; background: #f1f5f9; padding: 0 3px; border-radius: 3px; }
  pre { background: #f6f8fb; border: 1px solid #e2e8f0; border-radius: 5px; padding: 9px 11px; font-size: 8.5pt; line-height: 1.4; white-space: pre-wrap; page-break-inside: avoid; }
  pre code { background: none; padding: 0; }
  img { max-width: 100%; border: 1px solid #cbd5e1; border-radius: 4px; margin: 6px 0; }
  blockquote { border-left: 3px solid #2563eb; margin: 10px 0; padding: 4px 12px; background: #eff5ff; }
  .cover { height: 90vh; display: flex; flex-direction: column; justify-content: center; }
  .cover h1 { border: 0; font-size: 28pt; }
  .mermaid { text-align: center; page-break-inside: avoid; }
`;

function page(title, bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${style}</style></head><body>${bodyHtml}
<script src="${mermaidJs}"></script>
<script>
  mermaid.initialize({ startOnLoad: false, theme: 'neutral', er: { useMaxWidth: false }, flowchart: { useMaxWidth: true } });
  mermaid.run().then(() => document.fonts.ready).then(() => { window.__ready = true; }).catch((e) => { document.title = 'ERROR ' + e.message; window.__ready = true; });
</script></body></html>`;
}

function markdownToHtml(file, extra = '') {
  const source = readFileSync(join(docsDir, file), 'utf8') + extra;
  const html = marked.parse(source, { gfm: true });
  return html
    .replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, (_m, code) => `<pre class="mermaid">${code}</pre>`)
    .replace(/src="\.\.\/tests\/screenshots\//g, `src="${pathToFileURL(join(ROOT, 'tests', 'screenshots')).toString()}/`);
}

const jobs = [];
const add = (name, html, options = {}) => {
  const htmlPath = join(workDir, `${name}.html`);
  writeFileSync(htmlPath, html);
  jobs.push({ html: htmlPath, pdf: join(docsDir, `${name}.pdf`), ...options });
};
if (existsSync(join(docsDir, 'technical-documentation.md'))) {
  add('technical-documentation', page('BCIS Technical Documentation', markdownToHtml('technical-documentation.md', '\n\n' + dictionary.replace('# Data Dictionary', '# Appendix A. Data Dictionary'))));
}
if (existsSync(join(docsDir, 'user-manual.md'))) add('user-manual', page('BCIS User Manual', markdownToHtml('user-manual.md')));
const erdStyle = `<style>
  .erd { page-break-after: always; height: 262mm; display: flex; flex-direction: column; }
  .erd:last-child { page-break-after: auto; }
  .erd h2 { margin: 0 0 4px; font-size: 15pt; } .erd p { margin: 0 0 6px; font-size: 9pt; color: #475569; }
  .erd pre.mermaid { flex: 1; min-height: 0; background: none; border: 0; padding: 0; margin: 0; }
  .erd svg { width: 100% !important; height: 100% !important; max-width: none !important; }
</style>`;
const erdHtml = diagrams
  .map((d, i) => `<section class="erd"><h2>BCIS Entity-Relationship Diagram ${i + 1} of ${diagrams.length}: ${d.title}</h2><p>Generated from the foreign keys of the live database. Crow's foot = many. Tables shown without columns belong to another diagram.</p><pre class="mermaid">${d.source.join('\n')}</pre></section>`)
  .join('\n');
add('erd', page('BCIS Entity-Relationship Diagram', erdStyle + erdHtml), { pageSize: 'A3', landscape: true });
writeFileSync(join(workDir, 'jobs.json'), JSON.stringify(jobs, null, 2));

// ---------------------------------------------------------------- render with Electron (Chromium print-to-PDF)
const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
const electron = require('electron');
const result = spawnSync(electron, [join(ROOT, 'scripts', 'render-docs.cjs'), join(workDir, 'jobs.json')], { stdio: 'inherit', env });
if (result.status !== 0) {
  console.error('PDF rendering failed.');
  process.exit(1);
}
console.log('Documentation built in docs/.');
