import type { AuditRow, ListQuery, Paged, SearchResult } from '@bcis/shared';
import { sql } from 'drizzle-orm';
import { contains, iso, paged, rows, where, type DbOrTx } from '../../db/client';
import { address } from '../../lib/sqlfrag';

export async function listAuditLogs(db: DbOrTx, q: ListQuery & { action?: string; entityType?: string; actor?: string }): Promise<Paged<AuditRow>> {
  const term = q.q ? contains(q.q) : null;
  const base = sql`
    select id, ${iso('at')} as at, actor_username as "actorUsername", action, entity_type as "entityType", entity_id as "entityId", reason,
           old_values as "oldValues", new_values as "newValues", ip
      from audit_logs
      ${where(
        term && sql`(action ilike ${term} or actor_username ilike ${term} or reason ilike ${term} or entity_id ilike ${term})`,
        q.action && sql`action like ${`${q.action}%`}`,
        q.entityType && sql`entity_type = ${q.entityType}`,
        q.actor && sql`actor_username = ${q.actor}`,
        q.subscriberId && sql`subscriber_id = ${q.subscriberId}`,
        q.from && sql`at >= ${q.from}::date`,
        q.to && sql`at < ${q.to}::date + 1`,
      )}`;
  return paged<AuditRow>(db, base, q, { at: 'id', action: 'action', actorUsername: '"actorUsername"' }, 'id desc');
}

/** Global search across account numbers, names, contacts, addresses, invoices, receipts and GCash references. */
export async function globalSearch(db: DbOrTx, text: string, scope: { subscribers: boolean; billing: boolean; payments: boolean }): Promise<SearchResult[]> {
  const term = contains(text.trim());
  const queries: Promise<SearchResult[]>[] = [];
  if (scope.subscribers) {
    queries.push(
      rows<SearchResult>(
        db,
        sql`select 'SUBSCRIBER' as kind, s.id, s.id as "subscriberId", s.full_name as title,
              s.account_no || ' · ' || s.phone || coalesce(' · ' || ${address('a')}, '') as subtitle, s.status::text as badge
            from subscribers s left join subscriber_addresses a on a.subscriber_id = s.id and a.is_primary
           where s.full_name ilike ${term} or s.account_no ilike ${term} or s.phone ilike ${term} or s.alt_phone ilike ${term}
              or exists (select 1 from subscriber_addresses a2 where a2.subscriber_id = s.id and (a2.line1 || ' ' || a2.barangay || ' ' || a2.city) ilike ${term})
           order by s.full_name limit 8`,
      ),
      rows<SearchResult>(
        db,
        sql`select 'SERVICE_ACCOUNT' as kind, sa.id, sa.subscriber_id as "subscriberId", sa.account_no as title,
              s.full_name || ' · ' || p.name as subtitle, sa.status::text as badge
            from service_accounts sa join subscribers s on s.id = sa.subscriber_id join service_plans p on p.id = sa.plan_id
           where sa.account_no ilike ${term} order by sa.account_no limit 5`,
      ),
    );
  }
  if (scope.billing) {
    queries.push(
      rows<SearchResult>(
        db,
        sql`select 'INVOICE' as kind, i.id, i.subscriber_id as "subscriberId", i.invoice_no as title,
              s.full_name || ' · due ' || i.due_date::text as subtitle, i.status::text as badge
            from invoices i join subscribers s on s.id = i.subscriber_id where i.invoice_no ilike ${term} order by i.id desc limit 5`,
      ),
    );
  }
  if (scope.payments) {
    queries.push(
      rows<SearchResult>(
        db,
        sql`select 'RECEIPT' as kind, p.id, p.subscriber_id as "subscriberId", r.receipt_no as title,
              s.full_name || ' · ' || p.payment_date::text as subtitle, p.status::text as badge
            from receipts r join payments p on p.id = r.payment_id join subscribers s on s.id = p.subscriber_id
           where r.receipt_no ilike ${term} order by p.id desc limit 5`,
      ),
      rows<SearchResult>(
        db,
        sql`select 'GCASH' as kind, p.id, p.subscriber_id as "subscriberId", 'GCash ref ' || p.reference_no as title,
              s.full_name || ' · receipt ' || r.receipt_no as subtitle, p.status::text as badge
            from payments p join receipts r on r.payment_id = p.id join subscribers s on s.id = p.subscriber_id
           where p.method = 'GCASH' and p.reference_no ilike ${term} order by p.id desc limit 5`,
      ),
    );
  }
  return (await Promise.all(queries)).flat();
}
