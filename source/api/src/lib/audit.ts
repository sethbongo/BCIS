import type { DbOrTx } from '../db/client';
import { auditLogs } from '../db/schema';
import type { Actor } from './context';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  subscriberId?: number | null;
  reason?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
}

const SENSITIVE = /password|token|secret|hash|dataBase64/i;

function redact(values: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!values) return null;
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, SENSITIVE.test(k) ? '[redacted]' : v]));
}

/**
 * Appends an audit record. Call it with the same transaction as the change it
 * describes so the audit row and the data change commit or roll back together.
 */
export async function audit(db: DbOrTx, actor: Pick<Actor, 'id' | 'username' | 'ip'> | null, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: actor?.id ?? null,
    actorUsername: actor?.username ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId == null ? null : String(entry.entityId),
    subscriberId: entry.subscriberId ?? null,
    reason: entry.reason ?? null,
    oldValues: redact(entry.oldValues),
    newValues: redact(entry.newValues),
    ip: actor?.ip ?? null,
  });
}

/** Returns only the keys whose values differ, as { old, new } maps for the audit trail. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): { old: Record<string, unknown>; new: Record<string, unknown> } | null {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (after[key] !== undefined && before[key] !== after[key]) {
      oldValues[key] = before[key];
      newValues[key] = after[key];
    }
  }
  return Object.keys(newValues).length ? { old: oldValues, new: newValues } : null;
}
