import type { BackupRow, IntegrityReport, RestoreResult } from '@bcis/shared';
import { eq, sql } from 'drizzle-orm';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../../config';
import { iso, one, rows, type DbOrTx } from '../../db/client';
import { backupHistory, sessions } from '../../db/schema';
import { audit } from '../../lib/audit';
import type { Ctx } from '../../lib/context';
import { AppError, conflict, notFound } from '../../lib/errors';
import { runIntegrityCheck } from './integrity';

const DUMP_FILE = 'database.dump';
const MANIFEST_FILE = 'manifest.json';
const COUNTED_TABLES = ['subscribers', 'service_accounts', 'invoices', 'payments', 'payment_allocations', 'ledger_entries', 'receipts', 'audit_logs'];
const DEFAULT_BIN_DIRS = ['C:\\Program Files\\PostgreSQL\\18\\bin', 'C:\\Program Files\\PostgreSQL\\17\\bin', 'C:\\Program Files\\PostgreSQL\\16\\bin', 'C:\\Program Files\\PostgreSQL\\15\\bin'];

interface Manifest {
  name: string;
  createdAt: string;
  createdBy: string;
  appVersion: string;
  database: { file: string; sha256: string; sizeBytes: number };
  attachments: { files: number };
  rowCounts: Record<string, number>;
}

function pgTool(tool: string): string {
  const exe = process.platform === 'win32' ? `${tool}.exe` : tool;
  for (const dir of [config.pgBinDir, ...DEFAULT_BIN_DIRS]) {
    if (dir && existsSync(join(dir, exe))) return join(dir, exe);
  }
  return exe;
}

/** Runs a PostgreSQL client tool. The password travels in the environment, never on the command line. */
function runPg(tool: string, args: string[]): Promise<string> {
  const url = new URL(config.databaseUrl);
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.slice(1),
  };
  return new Promise((resolve, reject) => {
    const child = spawn(pgTool(tool), args, { env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (err) => reject(new AppError(500, 'PG_TOOL_MISSING', `${tool} could not be started. Set PG_BIN_DIR in .env to the PostgreSQL bin folder. (${err.message})`)));
    child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`${tool} exited with code ${code}: ${stderr.trim().slice(-2000)}`))));
  });
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

async function countFiles(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0;
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).length;
}

const backupDir = (name: string) => join(config.backupsDir, name);

export async function listBackups(db: DbOrTx, id?: number): Promise<BackupRow[]> {
  const data = await rows<Omit<BackupRow, 'available'>>(
    db,
    sql`select id, kind, name, status, size_bytes as "sizeBytes", checksum, ${iso('verified_at')} as "verifiedAt", verification_result as "verificationResult",
          created_by_name as "createdByName", ${iso('created_at')} as "createdAt", notes
        from backup_history ${id ? sql`where id = ${id}` : sql``} order by id desc limit 200`,
  );
  return data.map((row) => ({ ...row, available: row.kind === 'BACKUP' && existsSync(join(backupDir(row.name), DUMP_FILE)) }));
}

/** Database dump (pg_dump custom format) + a copy of the proof attachments + a checksummed manifest. */
export async function createBackup({ db, actor }: Ctx, notes?: string, label = 'bcis'): Promise<BackupRow> {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const name = `${label}-${stamp}`;
  const dir = backupDir(name);
  const dumpPath = join(dir, DUMP_FILE);
  await mkdir(dir, { recursive: true });
  try {
    // Sessions and the backup catalogue describe this running installation, not business data.
    await runPg('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--exclude-table-data=sessions', '--exclude-table-data=backup_history', `--file=${dumpPath}`]);
    if (existsSync(config.attachmentsDir)) await cp(config.attachmentsDir, join(dir, 'attachments'), { recursive: true });

    const rowCounts: Record<string, number> = {};
    for (const table of COUNTED_TABLES) rowCounts[table] = (await one<{ n: number }>(db, sql`select count(*) as n from ${sql.identifier(table)}`))?.n ?? 0;
    const manifest: Manifest = {
      name,
      createdAt: new Date().toISOString(),
      createdBy: actor.username,
      appVersion: config.version,
      database: { file: DUMP_FILE, sha256: await sha256File(dumpPath), sizeBytes: (await stat(dumpPath)).size },
      attachments: { files: await countFiles(join(dir, 'attachments')) },
      rowCounts,
    };
    await writeFile(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
    const [row] = await db
      .insert(backupHistory)
      .values({ kind: 'BACKUP', name, status: 'COMPLETED', sizeBytes: manifest.database.sizeBytes, checksum: manifest.database.sha256, notes: notes || null, createdBy: actor.id, createdByName: actor.fullName })
      .returning({ id: backupHistory.id });
    await audit(db, actor, { action: 'backup.create', entityType: 'backup', entityId: row.id, newValues: { name, sizeBytes: manifest.database.sizeBytes, rowCounts } });
    return (await listBackups(db, row.id))[0];
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}

async function loadBackup(db: DbOrTx, id: number) {
  const [row] = await db.select().from(backupHistory).where(eq(backupHistory.id, id));
  if (!row || row.kind !== 'BACKUP') throw notFound('Backup');
  const dumpPath = join(backupDir(row.name), DUMP_FILE);
  if (!existsSync(dumpPath)) throw new AppError(410, 'BACKUP_FILE_MISSING', 'The backup files are no longer on the server.');
  return { row, dumpPath, dir: backupDir(row.name) };
}

/**
 * Verification proves a backup is restorable before anyone relies on it:
 * the dump's checksum must match the manifest and the catalogue, and pg_restore
 * must be able to read the archive's table of contents.
 */
export async function verifyBackup({ db, actor }: Ctx, id: number): Promise<BackupRow> {
  const { row, dumpPath, dir } = await loadBackup(db, id);
  const problems: string[] = [];
  let tables = 0;
  try {
    const manifest = JSON.parse(await readFile(join(dir, MANIFEST_FILE), 'utf8')) as Manifest;
    const checksum = await sha256File(dumpPath);
    if (checksum !== manifest.database.sha256 || checksum !== row.checksum) problems.push('checksum mismatch - the dump file was modified or is corrupt');
    const toc = await runPg('pg_restore', ['--list', dumpPath]);
    tables = toc.split('\n').filter((line) => line.includes(' TABLE DATA ')).length;
    if (tables < COUNTED_TABLES.length) problems.push('archive is missing table data');
  } catch (err) {
    problems.push((err as Error).message);
  }
  const ok = problems.length === 0;
  const result = ok ? `Checksum OK; archive readable (${tables} tables)` : `FAILED: ${problems.join('; ')}`;
  await db.update(backupHistory).set({ status: ok ? 'VERIFIED' : 'FAILED', verifiedAt: new Date(), verificationResult: result }).where(eq(backupHistory.id, id));
  await audit(db, actor, { action: 'backup.verify', entityType: 'backup', entityId: id, newValues: { name: row.name, ok, result } });
  return (await listBackups(db, id))[0];
}

/**
 * Restores a verified backup:
 *   1. verify the archive again, 2. take an automatic safety backup of the current state,
 *   3. pg_restore inside a single transaction (all-or-nothing), 4. restore attachments,
 *   5. run the financial integrity check and record the outcome.
 */
export async function restoreBackup(ctx: Ctx, id: number, reason: string, sessionId: string): Promise<RestoreResult> {
  const { db, actor } = ctx;
  const verified = await verifyBackup(ctx, id);
  if (verified.status !== 'VERIFIED') throw conflict('BACKUP_NOT_VERIFIED', `This backup failed verification and cannot be restored. ${verified.verificationResult ?? ''}`);
  const { row, dumpPath, dir } = await loadBackup(db, id);

  const safety = await createBackup(ctx, `Automatic safety backup before restoring ${row.name}`, 'pre-restore');
  // Carried across the restore: the caller's session and the backup catalogue.
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  const catalogue = await db.select().from(backupHistory);

  try {
    await runPg('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error', `--dbname=${new URL(config.databaseUrl).pathname.slice(1)}`, dumpPath]);
  } catch (err) {
    // --single-transaction rolled everything back: the live database is unchanged.
    await db.insert(backupHistory).values({ kind: 'RESTORE', name: row.name, status: 'FAILED', verificationResult: (err as Error).message.slice(0, 1000), notes: reason, createdBy: actor.id, createdByName: actor.fullName });
    throw new AppError(500, 'RESTORE_FAILED', 'The restore failed and was rolled back. The current data is unchanged. See the server log for details.');
  }

  const attachmentsBackup = join(dir, 'attachments');
  if (existsSync(attachmentsBackup)) {
    const previous = `${config.attachmentsDir}.before-restore`;
    await rm(previous, { recursive: true, force: true });
    if (existsSync(config.attachmentsDir)) await rename(config.attachmentsDir, previous);
    await cp(attachmentsBackup, config.attachmentsDir, { recursive: true });
  }

  // The users who created older backups may not exist in the restored data, so only their names are kept.
  if (catalogue.length) await db.insert(backupHistory).values(catalogue.map((entry) => ({ ...entry, createdBy: null }))).onConflictDoNothing();
  await db.execute(sql`select setval(pg_get_serial_sequence('backup_history', 'id'), greatest((select coalesce(max(id), 0) from backup_history), 1))`);
  const userStillExists = await one(db, sql`select 1 from users where id = ${actor.id} and is_active`);
  if (session && userStillExists) await db.insert(sessions).values(session).onConflictDoNothing();

  const integrity: IntegrityReport = await runIntegrityCheck(db);
  const summary = integrity.ok ? 'Restore completed; integrity check passed' : `Restore completed; integrity check FAILED (${integrity.checks.filter((c) => !c.ok).map((c) => c.name).join(', ')})`;
  await db.insert(backupHistory).values({ kind: 'RESTORE', name: row.name, status: integrity.ok ? 'COMPLETED' : 'FAILED', verificationResult: summary, notes: reason, createdBy: userStillExists ? actor.id : null, createdByName: actor.fullName });
  await audit(db, userStillExists ? actor : null, {
    action: 'backup.restore',
    entityType: 'backup',
    entityId: id,
    reason,
    newValues: { restoredFrom: row.name, safetyBackup: safety.name, integrityOk: integrity.ok, restoredBy: actor.username },
  });
  return { restoredFrom: row.name, integrity };
}
