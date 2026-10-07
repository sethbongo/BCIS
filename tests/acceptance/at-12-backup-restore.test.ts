/** Mandatory acceptance test AT-12: backup, change data, restore, integrity check. */
import type { BackupRow, RestoreResult } from '@bcis/shared';
import { sql } from 'drizzle-orm';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../../source/api/src/config';
import { bill, createSubscriberWithService, invoicesOf, ledgerOf, pay, startHarness, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

describe('AT-12 Backup and restore', () => {
  it('create backup, change data, restore the verified backup -> integrity check passes and expected records return', async () => {
    // State A: a subscriber with one invoice, half paid.
    const kept = await createSubscriberWithService(h, 99900);
    await bill(h, kept, '2025-09');
    const keptPayment = await pay(h, kept, 50000);
    const countsBefore = (await h.sql(sql`select (select count(*) from subscribers)::int as subscribers, (select count(*) from payments)::int as payments, (select count(*) from ledger_entries)::int as ledger`))[0];

    const backup = await h.call<BackupRow>('OWNER', 'POST', '/backups', { notes: 'AT-12 test backup' });
    expect(backup.status).toBe(200);
    expect(backup.body).toMatchObject({ kind: 'BACKUP', status: 'COMPLETED', available: true });
    expect(backup.body.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(config.backupsDir, backup.body.name, 'database.dump'))).toBe(true);
    expect(existsSync(join(config.backupsDir, backup.body.name, 'manifest.json'))).toBe(true);

    const verified = await h.call<BackupRow>('OWNER', 'POST', `/backups/${backup.body.id}/verify`);
    expect(verified.body.status).toBe('VERIFIED');
    expect(verified.body.verificationResult).toContain('Checksum OK');

    // Changes made after the backup (state B).
    const later = await createSubscriberWithService(h, 129900);
    await bill(h, later, '2025-09');
    const laterPayment = await pay(h, kept, 49900);
    expect((await invoicesOf(h, kept))[0]).toMatchObject({ status: 'PAID', balance: 0 });

    // Only the owner may restore, and only with the explicit confirmation word.
    expect((await h.call('ADMIN', 'POST', `/backups/${backup.body.id}/restore`, { confirmation: 'RESTORE', reason: 'not allowed' })).status).toBe(403);
    expect((await h.call('OWNER', 'POST', `/backups/${backup.body.id}/restore`, { confirmation: 'yes', reason: 'missing confirmation word' })).status).toBe(400);
    const restored = await h.call<RestoreResult>('OWNER', 'POST', `/backups/${backup.body.id}/restore`, { confirmation: 'RESTORE', reason: 'AT-12 restore drill' });
    expect(restored.status).toBe(200);
    expect(restored.body.restoredFrom).toBe(backup.body.name);
    expect(restored.body.integrity.ok).toBe(true);
    expect(restored.body.integrity.checks.length).toBeGreaterThanOrEqual(8);
    expect(restored.body.integrity.checks.every((c) => c.ok)).toBe(true);

    // State A is back: the record that existed is intact, later changes are gone.
    expect((await h.sql(sql`select (select count(*) from subscribers)::int as subscribers, (select count(*) from payments)::int as payments, (select count(*) from ledger_entries)::int as ledger`))[0]).toEqual(countsBefore);
    const owner = await h.call('OWNER', 'GET', `/subscribers/${kept.subscriber.id}`); // the owner's session survived the restore
    expect(owner.status).toBe(200);
    expect(owner.body).toMatchObject({ accountNo: kept.subscriber.accountNo, outstanding: 49900 });
    expect((await h.call('OWNER', 'GET', `/payments/${keptPayment.body.id}`)).body).toMatchObject({ status: 'POSTED', amount: 50000, receiptNo: keptPayment.body.receiptNo });
    expect((await h.call('OWNER', 'GET', `/payments/${laterPayment.body.id}`)).status).toBe(404);
    expect((await h.call('OWNER', 'GET', `/subscribers/${later.subscriber.id}`)).status).toBe(404);

    // The restore is recorded, a safety backup of the pre-restore state exists, and it is audited.
    const history = (await h.call<BackupRow[]>('OWNER', 'GET', '/backups')).body;
    expect(history.find((b) => b.kind === 'RESTORE')).toMatchObject({ name: backup.body.name, status: 'COMPLETED' });
    expect(history.some((b) => b.kind === 'BACKUP' && b.name.startsWith('pre-restore-') && b.available)).toBe(true);
    expect(history.some((b) => b.id === backup.body.id)).toBe(true);
    const audit = await h.sql(sql`select reason from audit_logs where action = 'backup.restore'`);
    expect(audit).toEqual([{ reason: 'AT-12 restore drill' }]);

    // The system keeps working after the restore: numbering continues without collisions.
    h.forgetSessions();
    const again = await pay(h, kept, 49900);
    expect(again.status).toBe(200);
    expect(again.body.receiptNo).toBe(laterPayment.body.receiptNo); // the rolled-back number was never legitimately issued in state A
    expect((await ledgerOf(h, kept)).closingBalance).toBe(0);
  });

  it('refuses to restore a backup whose file was tampered with', async () => {
    const backup = await h.call<BackupRow>('OWNER', 'POST', '/backups', {});
    const dump = join(config.backupsDir, backup.body.name, 'database.dump');
    writeFileSync(dump, 'corrupted', { flag: 'a' });
    const verified = await h.call<BackupRow>('OWNER', 'POST', `/backups/${backup.body.id}/verify`);
    expect(verified.body.status).toBe('FAILED');
    expect(verified.body.verificationResult).toContain('checksum mismatch');
    const before = (await h.sql(sql`select count(*)::int as n from payments`))[0];
    const restore = await h.call('OWNER', 'POST', `/backups/${backup.body.id}/restore`, { confirmation: 'RESTORE', reason: 'should be refused' });
    expect(restore.status).toBe(409);
    expect(restore.body.error.code).toBe('BACKUP_NOT_VERIFIED');
    expect((await h.sql(sql`select count(*)::int as n from payments`))[0]).toEqual(before);
  });
});
