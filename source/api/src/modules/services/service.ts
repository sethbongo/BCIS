import {
  addDays,
  formatMoney,
  type ListQuery,
  type Paged,
  type ReconnectionCompleteInput,
  type ReconnectionRequestInput,
  type ReconnectionRow,
  type ServiceAccountInput,
  type ServiceAccountRow,
  type ServiceAccountStatus,
  type ServiceAccountUpdateInput,
  type ServiceEventRow,
  type SuspendInput,
  type SuspensionRow,
} from '@bcis/shared';
import { and, eq, sql } from 'drizzle-orm';
import { contains, iso, one, paged, rows, where, type DbOrTx } from '../../db/client';
import { reconnectionRecords, serviceAccounts, serviceEvents, servicePlans, subscriberAddresses, subscribers, suspensionRecords } from '../../db/schema';
import { audit } from '../../lib/audit';
import { today, type Actor, type Ctx } from '../../lib/context';
import { conflict, invalid, notFound } from '../../lib/errors';
import { nextNumber } from '../../lib/sequences';
import { getSettings } from '../../lib/settings';
import { address, OPEN } from '../../lib/sqlfrag';
import { createOneTimeInvoice } from '../billing/service';
import { addAddress } from '../subscribers/service';

const accountSelect = sql`
  select sa.id, sa.account_no as "accountNo", sa.subscriber_id as "subscriberId", s.account_no as "subscriberAccountNo", s.full_name as "subscriberName",
    sa.plan_id as "planId", p.code as "planCode", p.name as "planName", st.code as "serviceType", ${address('a')} as address,
    ar.name as "areaName", coalesce(c.full_name, sc.full_name) as "collectorName",
    sa.activation_date as "activationDate", sa.billing_start_date as "billingStartDate", sa.due_day as "dueDay", sa.current_rate as "currentRate",
    sa.monthly_discount as "monthlyDiscount", sa.status, sa.notes,
    (select coalesce(sum(i.balance), 0)::bigint from invoices i where i.service_account_id = sa.id and i.status in ${OPEN}) as balance
  from service_accounts sa
  join subscribers s on s.id = sa.subscriber_id
  join service_plans p on p.id = sa.plan_id
  join service_types st on st.id = p.service_type_id
  join subscriber_addresses a on a.id = sa.address_id
  left join collection_areas ar on ar.id = s.collection_area_id
  left join collectors c on c.id = sa.collector_id
  left join collectors sc on sc.id = s.collector_id`;

export async function listServiceAccounts(db: DbOrTx, q: ListQuery): Promise<Paged<ServiceAccountRow>> {
  const term = q.q ? contains(q.q) : null;
  const base = sql`${accountSelect} ${where(
    term && sql`(sa.account_no ilike ${term} or s.full_name ilike ${term} or s.account_no ilike ${term} or p.name ilike ${term} or ${address('a')} ilike ${term})`,
    q.status && sql`sa.status = ${q.status}`,
    q.planId && sql`sa.plan_id = ${q.planId}`,
    q.serviceType && sql`st.code = ${q.serviceType}`,
    q.subscriberId && sql`sa.subscriber_id = ${q.subscriberId}`,
    q.areaId && sql`s.collection_area_id = ${q.areaId}`,
    q.collectorId && sql`coalesce(sa.collector_id, s.collector_id) = ${q.collectorId}`,
  )}`;
  return paged<ServiceAccountRow>(
    db,
    base,
    q,
    { accountNo: '"accountNo"', subscriberName: '"subscriberName"', planName: '"planName"', status: 'status', currentRate: '"currentRate"', balance: 'balance', activationDate: '"activationDate"' },
    '"accountNo" asc',
  );
}

export async function getServiceAccount(db: DbOrTx, id: number): Promise<ServiceAccountRow> {
  const row = await one<ServiceAccountRow>(db, sql`${accountSelect} where sa.id = ${id}`);
  if (!row) throw notFound('Service account');
  return row;
}

async function recordEvent(
  tx: DbOrTx,
  actor: Actor,
  event: { serviceAccountId: number; eventType: string; fromStatus?: ServiceAccountStatus | null; toStatus?: ServiceAccountStatus | null; description: string; effectiveDate?: string },
): Promise<void> {
  await tx.insert(serviceEvents).values({
    serviceAccountId: event.serviceAccountId,
    eventType: event.eventType,
    fromStatus: event.fromStatus ?? null,
    toStatus: event.toStatus ?? null,
    description: event.description,
    effectiveDate: event.effectiveDate ?? today(),
    createdBy: actor.id,
  });
}

export async function createServiceAccount(ctx: Ctx, input: ServiceAccountInput): Promise<ServiceAccountRow> {
  const { db, actor } = ctx;
  const id = await db.transaction(async (tx) => {
    const [subscriber] = await tx.select().from(subscribers).where(eq(subscribers.id, input.subscriberId));
    if (!subscriber) throw notFound('Subscriber');
    if (subscriber.status !== 'ACTIVE') throw invalid('Service accounts can only be added to an active subscriber.');
    const [plan] = await tx.select().from(servicePlans).where(eq(servicePlans.id, input.planId));
    if (!plan) throw notFound('Plan');
    if (!plan.isActive) throw invalid('This plan is inactive and cannot be assigned to new service accounts.', { planId: 'Plan is inactive' });
    if (input.monthlyDiscount > plan.monthlyPrice) throw invalid('The discount cannot exceed the plan price.', { monthlyDiscount: 'Exceeds plan price' });
    if (input.billingStartDate < input.activationDate) throw invalid('Billing cannot start before activation.', { billingStartDate: 'Must be on or after activation' });

    let addressId: number;
    if (input.newAddress) {
      addressId = await addAddress(ctx, input.subscriberId, input.newAddress, tx);
    } else {
      const [found] = await tx
        .select({ id: subscriberAddresses.id })
        .from(subscriberAddresses)
        .where(input.addressId ? and(eq(subscriberAddresses.id, input.addressId), eq(subscriberAddresses.subscriberId, input.subscriberId)) : and(eq(subscriberAddresses.subscriberId, input.subscriberId), eq(subscriberAddresses.isPrimary, true)));
      if (!found) throw invalid('Select an installation address that belongs to this subscriber.', { addressId: 'Invalid address' });
      addressId = found.id;
    }

    const accountNo = await nextNumber(tx, 'SERVICE_ACCOUNT');
    const [account] = await tx
      .insert(serviceAccounts)
      .values({
        accountNo,
        subscriberId: input.subscriberId,
        planId: plan.id,
        addressId,
        activationDate: input.activationDate,
        billingStartDate: input.billingStartDate,
        dueDay: input.dueDay,
        currentRate: plan.monthlyPrice,
        monthlyDiscount: input.monthlyDiscount,
        collectorId: input.collectorId ?? subscriber.collectorId,
        notes: input.notes || null,
        createdBy: actor.id,
      })
      .returning({ id: serviceAccounts.id });
    await recordEvent(tx, actor, { serviceAccountId: account.id, eventType: 'ACTIVATED', toStatus: 'ACTIVE', description: `Service activated on plan ${plan.name}`, effectiveDate: input.activationDate });
    await audit(tx, actor, {
      action: 'service_account.create',
      entityType: 'service_account',
      entityId: account.id,
      subscriberId: input.subscriberId,
      newValues: { accountNo, plan: plan.code, rate: plan.monthlyPrice, activationDate: input.activationDate, billingStartDate: input.billingStartDate },
    });
    return account.id;
  });
  return getServiceAccount(db, id);
}

export async function updateServiceAccount({ db, actor }: Ctx, id: number, input: ServiceAccountUpdateInput): Promise<ServiceAccountRow> {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(serviceAccounts).where(eq(serviceAccounts.id, id)).for('update');
    if (!before) throw notFound('Service account');
    if (before.status === 'TERMINATED') throw invalid('A terminated service account cannot be changed.');
    let currentRate = before.currentRate;
    if (input.planId && input.planId !== before.planId) {
      const [plan] = await tx.select().from(servicePlans).where(eq(servicePlans.id, input.planId));
      if (!plan || !plan.isActive) throw invalid('Select an active plan.', { planId: 'Plan is not available' });
      currentRate = plan.monthlyPrice;
      await recordEvent(tx, actor, { serviceAccountId: id, eventType: 'PLAN_CHANGED', description: `Plan changed to ${plan.name}; new rate applies to future billing${input.reason ? ` (${input.reason})` : ''}` });
    }
    const monthlyDiscount = input.monthlyDiscount ?? before.monthlyDiscount;
    if (monthlyDiscount > currentRate) throw invalid('The discount cannot exceed the monthly rate.', { monthlyDiscount: 'Exceeds monthly rate' });
    const after = {
      planId: input.planId ?? before.planId,
      currentRate,
      monthlyDiscount,
      dueDay: input.dueDay ?? before.dueDay,
      collectorId: input.collectorId === undefined ? before.collectorId : input.collectorId,
      notes: input.notes === undefined ? before.notes : input.notes || null,
    };
    await tx.update(serviceAccounts).set({ ...after, updatedAt: new Date() }).where(eq(serviceAccounts.id, id));
    await audit(tx, actor, {
      action: 'service_account.update',
      entityType: 'service_account',
      entityId: id,
      subscriberId: before.subscriberId,
      reason: input.reason || null,
      oldValues: { planId: before.planId, currentRate: before.currentRate, monthlyDiscount: before.monthlyDiscount, dueDay: before.dueDay, collectorId: before.collectorId },
      newValues: after,
    });
  });
  return getServiceAccount(db, id);
}

async function overdueBalance(tx: DbOrTx, serviceAccountId: number): Promise<number> {
  const row = await one<{ amount: number }>(
    tx,
    sql`select coalesce(sum(balance), 0)::bigint as amount from invoices where service_account_id = ${serviceAccountId} and status in ${OPEN} and due_date < ${today()}`,
  );
  return row?.amount ?? 0;
}

export async function suspendServiceAccount({ db, actor }: Ctx, id: number, input: SuspendInput): Promise<ServiceAccountRow> {
  await db.transaction(async (tx) => {
    const [account] = await tx.select().from(serviceAccounts).where(eq(serviceAccounts.id, id)).for('update');
    if (!account) throw notFound('Service account');
    if (account.status !== 'ACTIVE') throw conflict('NOT_ACTIVE', `Only an active service account can be suspended (current status: ${account.status}).`);
    const arrears = await overdueBalance(tx, id);
    await tx.insert(suspensionRecords).values({ serviceAccountId: id, reason: input.reason, effectiveDate: input.effectiveDate, arrearsAtSuspension: arrears, approvedBy: actor.id, notes: input.notes || null });
    await tx.update(serviceAccounts).set({ status: 'SUSPENDED', updatedAt: new Date() }).where(eq(serviceAccounts.id, id));
    await recordEvent(tx, actor, { serviceAccountId: id, eventType: 'SUSPENDED', fromStatus: 'ACTIVE', toStatus: 'SUSPENDED', description: `Suspended: ${input.reason}`, effectiveDate: input.effectiveDate });
    await audit(tx, actor, {
      action: 'service_account.suspend',
      entityType: 'service_account',
      entityId: id,
      subscriberId: account.subscriberId,
      reason: input.reason,
      oldValues: { status: 'ACTIVE' },
      newValues: { status: 'SUSPENDED', effectiveDate: input.effectiveDate, arrearsAtSuspension: arrears },
    });
  });
  return getServiceAccount(db, id);
}

/**
 * Starts the reconnection workflow. With `reconnection.requireFullPayment` on, the account
 * qualifies only once its overdue invoices are settled. The plan's reconnection fee is billed
 * as a one-time invoice so it flows through the ledger like any other charge.
 */
export async function requestReconnection({ db, actor }: Ctx, id: number, input: ReconnectionRequestInput): Promise<ReconnectionRow> {
  const reconnectionId = await db.transaction(async (tx) => {
    const [account] = await tx.select().from(serviceAccounts).where(eq(serviceAccounts.id, id)).for('update');
    if (!account) throw notFound('Service account');
    if (account.status !== 'SUSPENDED') throw conflict('NOT_SUSPENDED', 'Only a suspended service account can be reconnected.');
    const pending = await one(tx, sql`select 1 from reconnection_records where service_account_id = ${id} and status = 'REQUESTED'`);
    if (pending) throw conflict('RECONNECTION_PENDING', 'A reconnection request is already open for this service account.');

    const settings = await getSettings(tx);
    const arrears = await overdueBalance(tx, id);
    if (settings['reconnection.requireFullPayment'] && arrears > 0) {
      throw invalid(`Overdue invoices totalling ${formatMoney(arrears, { symbol: true })} must be settled before this account qualifies for reconnection.`);
    }
    const [plan] = await tx.select().from(servicePlans).where(eq(servicePlans.id, account.planId));
    const [suspension] = await tx.select().from(suspensionRecords).where(and(eq(suspensionRecords.serviceAccountId, id), eq(suspensionRecords.isActive, true)));
    const feeAmount = input.waiveFee ? 0 : plan.reconnectionFee;
    let feeInvoiceId: number | null = null;
    if (feeAmount > 0) {
      const invoice = await createOneTimeInvoice(tx, actor, {
        subscriberId: account.subscriberId,
        serviceAccountId: id,
        invoiceDate: today(),
        dueDate: addDays(today(), 7),
        items: [{ itemType: 'RECONNECTION_FEE', description: `Reconnection fee - ${plan.name}`, quantity: 1, unitAmount: feeAmount }],
      });
      feeInvoiceId = invoice.id;
    }
    const [record] = await tx
      .insert(reconnectionRecords)
      .values({
        serviceAccountId: id,
        suspensionId: suspension?.id ?? null,
        requestDate: today(),
        feeAmount,
        feeInvoiceId,
        technicianUserId: input.technicianUserId ?? null,
        requestedBy: actor.id,
        notes: input.notes || null,
      })
      .returning({ id: reconnectionRecords.id });
    await recordEvent(tx, actor, { serviceAccountId: id, eventType: 'RECONNECTION_REQUESTED', description: `Reconnection requested${feeAmount ? `; fee ${formatMoney(feeAmount)}` : input.waiveFee ? '; fee waived' : ''}` });
    await audit(tx, actor, {
      action: 'service_account.reconnection_request',
      entityType: 'service_account',
      entityId: id,
      subscriberId: account.subscriberId,
      newValues: { reconnectionId: record.id, feeAmount, feeWaived: !!input.waiveFee, technicianUserId: input.technicianUserId ?? null },
    });
    return record.id;
  });
  return (await listReconnections(db, { page: 1, pageSize: 1 }, reconnectionId)).rows[0];
}

export async function completeReconnection({ db, actor }: Ctx, reconnectionId: number, input: ReconnectionCompleteInput): Promise<ReconnectionRow> {
  await db.transaction(async (tx) => {
    const [record] = await tx.select().from(reconnectionRecords).where(eq(reconnectionRecords.id, reconnectionId)).for('update');
    if (!record) throw notFound('Reconnection request');
    if (record.status !== 'REQUESTED') throw conflict('NOT_PENDING', 'This reconnection request is already closed.');
    if (input.completionDate < record.requestDate) throw invalid('Completion cannot be earlier than the request date.', { completionDate: 'Before request date' });
    const [account] = await tx.select().from(serviceAccounts).where(eq(serviceAccounts.id, record.serviceAccountId)).for('update');
    await tx
      .update(reconnectionRecords)
      .set({ status: 'COMPLETED', completionDate: input.completionDate, completedBy: actor.id, notes: [record.notes, input.notes].filter(Boolean).join(' | ') || null })
      .where(eq(reconnectionRecords.id, reconnectionId));
    await tx.update(suspensionRecords).set({ isActive: false, liftedAt: new Date() }).where(and(eq(suspensionRecords.serviceAccountId, account.id), eq(suspensionRecords.isActive, true)));
    await tx.update(serviceAccounts).set({ status: 'ACTIVE', updatedAt: new Date() }).where(eq(serviceAccounts.id, account.id));
    await recordEvent(tx, actor, { serviceAccountId: account.id, eventType: 'RECONNECTED', fromStatus: 'SUSPENDED', toStatus: 'ACTIVE', description: 'Service reconnected', effectiveDate: input.completionDate });
    await audit(tx, actor, {
      action: 'service_account.reconnect',
      entityType: 'service_account',
      entityId: account.id,
      subscriberId: account.subscriberId,
      oldValues: { status: 'SUSPENDED' },
      newValues: { status: 'ACTIVE', reconnectionId, completionDate: input.completionDate },
    });
  });
  return (await listReconnections(db, { page: 1, pageSize: 1 }, reconnectionId)).rows[0];
}

/** Service accounts are never deleted; termination keeps the whole history. */
export async function terminateServiceAccount({ db, actor }: Ctx, id: number, input: { reason: string; effectiveDate: string }): Promise<ServiceAccountRow> {
  await db.transaction(async (tx) => {
    const [account] = await tx.select().from(serviceAccounts).where(eq(serviceAccounts.id, id)).for('update');
    if (!account) throw notFound('Service account');
    if (account.status === 'TERMINATED') throw conflict('ALREADY_TERMINATED', 'This service account is already terminated.');
    await tx.update(serviceAccounts).set({ status: 'TERMINATED', updatedAt: new Date() }).where(eq(serviceAccounts.id, id));
    await tx.update(suspensionRecords).set({ isActive: false, liftedAt: new Date() }).where(and(eq(suspensionRecords.serviceAccountId, id), eq(suspensionRecords.isActive, true)));
    await tx.execute(sql`update reconnection_records set status = 'CANCELLED' where service_account_id = ${id} and status = 'REQUESTED'`);
    await recordEvent(tx, actor, { serviceAccountId: id, eventType: 'TERMINATED', fromStatus: account.status, toStatus: 'TERMINATED', description: `Terminated: ${input.reason}`, effectiveDate: input.effectiveDate });
    await audit(tx, actor, {
      action: 'service_account.terminate',
      entityType: 'service_account',
      entityId: id,
      subscriberId: account.subscriberId,
      reason: input.reason,
      oldValues: { status: account.status },
      newValues: { status: 'TERMINATED', effectiveDate: input.effectiveDate },
    });
  });
  return getServiceAccount(db, id);
}

export async function listServiceEvents(db: DbOrTx, filter: { subscriberId?: number; serviceAccountId?: number }): Promise<ServiceEventRow[]> {
  return rows<ServiceEventRow>(
    db,
    sql`select e.id, e.service_account_id as "serviceAccountId", sa.account_no as "serviceAccountNo", e.event_type as "eventType", e.from_status as "fromStatus",
          e.to_status as "toStatus", e.description, e.effective_date as "effectiveDate", u.full_name as "createdByName", ${iso('e.created_at')} as "createdAt"
        from service_events e join service_accounts sa on sa.id = e.service_account_id left join users u on u.id = e.created_by
        ${where(filter.subscriberId && sql`sa.subscriber_id = ${filter.subscriberId}`, filter.serviceAccountId && sql`e.service_account_id = ${filter.serviceAccountId}`)}
        order by e.effective_date desc, e.id desc limit 500`,
  );
}

export async function listSuspensions(db: DbOrTx, q: ListQuery): Promise<Paged<SuspensionRow>> {
  const base = sql`
    select sr.id, sr.service_account_id as "serviceAccountId", sa.account_no as "serviceAccountNo", sa.subscriber_id as "subscriberId", s.full_name as "subscriberName",
      p.name as "planName", sr.reason, sr.effective_date as "effectiveDate", sr.arrears_at_suspension as "arrearsAtSuspension", u.full_name as "approvedByName",
      sr.notes, sr.is_active as "isActive", ${iso('sr.lifted_at')} as "liftedAt",
      (select coalesce(sum(i.balance), 0)::bigint from invoices i where i.service_account_id = sa.id and i.status in ${OPEN} and i.due_date < ${today()}) as "currentArrears"
    from suspension_records sr
    join service_accounts sa on sa.id = sr.service_account_id
    join subscribers s on s.id = sa.subscriber_id
    join service_plans p on p.id = sa.plan_id
    left join users u on u.id = sr.approved_by
    ${where(q.status === 'ACTIVE' && sql`sr.is_active`, q.status === 'LIFTED' && sql`not sr.is_active`, q.subscriberId && sql`sa.subscriber_id = ${q.subscriberId}`)}`;
  return paged<SuspensionRow>(db, base, q, { effectiveDate: '"effectiveDate"', subscriberName: '"subscriberName"' }, '"isActive" desc, "effectiveDate" desc, id desc');
}

export async function listReconnections(db: DbOrTx, q: ListQuery | { page: number; pageSize: number; status?: string; subscriberId?: number }, id?: number): Promise<Paged<ReconnectionRow>> {
  const base = sql`
    select rr.id, rr.service_account_id as "serviceAccountId", sa.account_no as "serviceAccountNo", sa.subscriber_id as "subscriberId", s.full_name as "subscriberName",
      p.name as "planName", ${address('a')} as address, rr.request_date as "requestDate", rr.completion_date as "completionDate", rr.fee_amount as "feeAmount",
      fi.invoice_no as "feeInvoiceNo", t.full_name as "technicianName", rr.status, ru.full_name as "requestedByName", rr.notes
    from reconnection_records rr
    join service_accounts sa on sa.id = rr.service_account_id
    join subscribers s on s.id = sa.subscriber_id
    join service_plans p on p.id = sa.plan_id
    join subscriber_addresses a on a.id = sa.address_id
    left join invoices fi on fi.id = rr.fee_invoice_id
    left join users t on t.id = rr.technician_user_id
    left join users ru on ru.id = rr.requested_by
    ${where(id && sql`rr.id = ${id}`, q.status && sql`rr.status = ${q.status}`, q.subscriberId && sql`sa.subscriber_id = ${q.subscriberId}`)}`;
  return paged<ReconnectionRow>(db, base, q, { requestDate: '"requestDate"', subscriberName: '"subscriberName"' }, `case status when 'REQUESTED' then 0 else 1 end, "requestDate" desc, id desc`);
}

/** Users who can be assigned reconnection work. */
export async function listTechnicians(db: DbOrTx): Promise<{ id: number; name: string }[]> {
  return rows(
    db,
    sql`select distinct u.id, u.full_name as name from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id
         where r.code = 'TECHNICIAN' and u.is_active order by 2`,
  );
}
