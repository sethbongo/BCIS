import type { AddressInput, AddressRow, ListQuery, Paged, SubscriberDetail, SubscriberInput, SubscriberRow, SubscriberUpdateInput } from '@bcis/shared';
import { eq, sql } from 'drizzle-orm';
import { contains, one, paged, rows, where, type DbOrTx } from '../../db/client';
import { subscriberAddresses, subscribers } from '../../db/schema';
import { audit, diff } from '../../lib/audit';
import { today, type Ctx } from '../../lib/context';
import { invalid, notFound } from '../../lib/errors';
import { nextNumber } from '../../lib/sequences';
import { address, balanceOf, creditOf, OPEN, outstandingOf } from '../../lib/sqlfrag';

const fullNameOf = (firstName: string, lastName: string) => `${lastName.trim()}, ${firstName.trim()}`;

const SUBSCRIBER_COLUMNS = sql`
  s.id, s.account_no as "accountNo", s.full_name as "fullName", s.phone,
  coalesce(${address('a')}, '') as address, ar.name as "areaName", c.full_name as "collectorName",
  s.status, s.due_day as "dueDay",
  (select count(*) from service_accounts sa where sa.subscriber_id = s.id and sa.status <> 'TERMINATED') as "serviceCount",
  ${balanceOf()} as balance`;

const SUBSCRIBER_JOINS = sql`
  from subscribers s
  left join subscriber_addresses a on a.subscriber_id = s.id and a.is_primary
  left join collection_areas ar on ar.id = s.collection_area_id
  left join collectors c on c.id = s.collector_id`;

export async function listSubscribers(db: DbOrTx, q: ListQuery): Promise<Paged<SubscriberRow>> {
  const term = q.q ? contains(q.q) : null;
  const base = sql`select ${SUBSCRIBER_COLUMNS} ${SUBSCRIBER_JOINS} ${where(
    term &&
      sql`(s.full_name ilike ${term} or s.account_no ilike ${term} or s.phone ilike ${term} or s.alt_phone ilike ${term}
           or exists (select 1 from subscriber_addresses a2 where a2.subscriber_id = s.id and (a2.line1 || ' ' || a2.barangay || ' ' || a2.city) ilike ${term}))`,
    q.status && sql`s.status = ${q.status}`,
    q.areaId && sql`s.collection_area_id = ${q.areaId}`,
    q.collectorId && sql`s.collector_id = ${q.collectorId}`,
  )}`;
  return paged<SubscriberRow>(
    db,
    base,
    q,
    { accountNo: '"accountNo"', fullName: '"fullName"', areaName: '"areaName"', collectorName: '"collectorName"', status: 'status', balance: 'balance', serviceCount: '"serviceCount"' },
    '"fullName" asc, id asc',
  );
}

export async function listAddresses(db: DbOrTx, subscriberId: number): Promise<AddressRow[]> {
  return rows<AddressRow>(
    db,
    sql`select a.id, a.label, a.line1, a.barangay, a.city, a.province, a.landmark, a.is_primary as "isPrimary",
          ${address('a')} || ', ' || a.province as formatted
        from subscriber_addresses a where a.subscriber_id = ${subscriberId} order by a.is_primary desc, a.id`,
  );
}

export async function getSubscriber(db: DbOrTx, id: number): Promise<SubscriberDetail> {
  const asOf = today();
  const row = await one<Omit<SubscriberDetail, 'addresses'>>(
    db,
    sql`select ${SUBSCRIBER_COLUMNS},
          s.first_name as "firstName", s.last_name as "lastName", s.alt_phone as "altPhone", s.email,
          s.collection_area_id as "collectionAreaId", s.collector_id as "collectorId", s.route_sequence as "routeSequence", s.notes,
          to_char(s.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "createdAt",
          ${outstandingOf()}::bigint as outstanding,
          (select coalesce(sum(i.balance), 0)::bigint from invoices i where i.subscriber_id = s.id and i.status in ${OPEN} and i.due_date < ${asOf}) as overdue,
          ${creditOf()}::bigint as credit,
          lp.payment_date as "lastPaymentDate", lp.amount as "lastPaymentAmount"
        ${SUBSCRIBER_JOINS}
        left join lateral (select p.payment_date, p.amount from payments p where p.subscriber_id = s.id and p.status = 'POSTED'
                            order by p.payment_date desc, p.id desc limit 1) lp on true
        where s.id = ${id}`,
  );
  if (!row) throw notFound('Subscriber');
  return { ...row, addresses: await listAddresses(db, id) };
}

export async function createSubscriber({ db, actor }: Ctx, input: SubscriberInput): Promise<SubscriberDetail> {
  const id = await db.transaction(async (tx) => {
    const accountNo = await nextNumber(tx, 'SUBSCRIBER');
    const [subscriber] = await tx
      .insert(subscribers)
      .values({
        accountNo,
        firstName: input.firstName,
        lastName: input.lastName,
        fullName: fullNameOf(input.firstName, input.lastName),
        phone: input.phone,
        altPhone: input.altPhone || null,
        email: input.email || null,
        dueDay: input.dueDay,
        collectionAreaId: input.collectionAreaId ?? null,
        collectorId: input.collectorId ?? null,
        routeSequence: input.routeSequence ?? null,
        notes: input.notes || null,
        createdBy: actor.id,
      })
      .returning({ id: subscribers.id });
    await insertAddress(tx, subscriber.id, input.address, true);
    await audit(tx, actor, {
      action: 'subscriber.create',
      entityType: 'subscriber',
      entityId: subscriber.id,
      subscriberId: subscriber.id,
      newValues: { accountNo, name: fullNameOf(input.firstName, input.lastName), phone: input.phone },
    });
    return subscriber.id;
  });
  return getSubscriber(db, id);
}

async function insertAddress(tx: DbOrTx, subscriberId: number, input: AddressInput, isPrimary: boolean): Promise<number> {
  const [row] = await tx
    .insert(subscriberAddresses)
    .values({
      subscriberId,
      label: input.label || (isPrimary ? 'Home' : 'Service address'),
      line1: input.line1,
      barangay: input.barangay,
      city: input.city,
      province: input.province,
      landmark: input.landmark || null,
      isPrimary,
    })
    .returning({ id: subscriberAddresses.id });
  return row.id;
}

export async function addAddress({ db, actor }: Ctx, subscriberId: number, input: AddressInput, tx?: DbOrTx): Promise<number> {
  const run = async (t: DbOrTx) => {
    const [subscriber] = await t.select({ id: subscribers.id }).from(subscribers).where(eq(subscribers.id, subscriberId));
    if (!subscriber) throw notFound('Subscriber');
    const id = await insertAddress(t, subscriberId, input, false);
    await audit(t, actor, { action: 'subscriber.address_add', entityType: 'subscriber_address', entityId: id, subscriberId, newValues: input });
    return id;
  };
  return tx ? run(tx) : db.transaction(run);
}

export async function updateSubscriber({ db, actor }: Ctx, id: number, input: SubscriberUpdateInput): Promise<SubscriberDetail> {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(subscribers).where(eq(subscribers.id, id)).for('update');
    if (!before) throw notFound('Subscriber');
    const firstName = input.firstName ?? before.firstName;
    const lastName = input.lastName ?? before.lastName;
    const changes = {
      firstName,
      lastName,
      fullName: fullNameOf(firstName, lastName),
      phone: input.phone,
      altPhone: input.altPhone === undefined ? undefined : input.altPhone || null,
      email: input.email === undefined ? undefined : input.email || null,
      dueDay: input.dueDay,
      collectionAreaId: input.collectionAreaId,
      collectorId: input.collectorId,
      routeSequence: input.routeSequence,
      notes: input.notes === undefined ? undefined : input.notes || null,
      status: input.status,
    };
    const changed = diff(before, changes);
    if (!changed) return;
    if (input.status && input.status !== before.status) {
      if (!input.statusReason) throw invalid('Give a reason for the status change.', { statusReason: 'Reason is required' });
      // Subscribers are never deleted. Closing an account requires its services to be closed first.
      if (input.status !== 'ACTIVE') {
        const live = await one<{ n: number }>(tx, sql`select count(*) as n from service_accounts where subscriber_id = ${id} and status in ('ACTIVE','SUSPENDED','PENDING')`);
        if (live && live.n > 0) throw invalid('Terminate the subscriber\'s service accounts before changing the subscriber status.');
      }
    }
    await tx.update(subscribers).set({ ...changes, updatedAt: new Date() }).where(eq(subscribers.id, id));
    await audit(tx, actor, {
      action: input.status && input.status !== before.status ? 'subscriber.status_change' : 'subscriber.update',
      entityType: 'subscriber',
      entityId: id,
      subscriberId: id,
      reason: input.statusReason || null,
      oldValues: changed.old,
      newValues: changed.new,
    });
  });
  return getSubscriber(db, id);
}
