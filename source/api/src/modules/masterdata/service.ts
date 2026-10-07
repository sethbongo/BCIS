import type { AreaInput, AreaRow, CollectorInput, CollectorRow, PlanInput, PlanRow, PlanUpdateInput } from '@bcis/shared';
import { and, eq, sql } from 'drizzle-orm';
import { rows, type DbOrTx } from '../../db/client';
import { collectionAreas, collectorAssignments, collectors, servicePlans, serviceTypes } from '../../db/schema';
import { audit, diff } from '../../lib/audit';
import { today, type Ctx } from '../../lib/context';
import { notFound } from '../../lib/errors';

// ---------------- plans ----------------
export async function listPlans(db: DbOrTx, planId?: number): Promise<PlanRow[]> {
  return rows<PlanRow>(
    db,
    sql`select p.id, p.code, p.name, st.code as "serviceType", p.monthly_price as "monthlyPrice", p.installation_fee as "installationFee",
          p.reconnection_fee as "reconnectionFee", p.speed_mbps as "speedMbps", p.channel_count as "channelCount", p.description, p.is_active as "isActive",
          (select count(*) from service_accounts sa where sa.plan_id = p.id and sa.status in ('ACTIVE','SUSPENDED')) as "activeAccounts"
        from service_plans p join service_types st on st.id = p.service_type_id
        ${planId ? sql`where p.id = ${planId}` : sql``}
        order by st.id, p.monthly_price`,
  );
}

export async function createPlan({ db, actor }: Ctx, input: PlanInput): Promise<PlanRow> {
  const [type] = await db.select().from(serviceTypes).where(eq(serviceTypes.code, input.serviceType));
  if (!type) throw notFound('Service type');
  const id = await db.transaction(async (tx) => {
    const [plan] = await tx
      .insert(servicePlans)
      .values({
        code: input.code,
        name: input.name,
        serviceTypeId: type.id,
        monthlyPrice: input.monthlyPrice,
        installationFee: input.installationFee,
        reconnectionFee: input.reconnectionFee,
        speedMbps: input.speedMbps ?? null,
        channelCount: input.channelCount ?? null,
        description: input.description || null,
        isActive: input.isActive,
      })
      .returning({ id: servicePlans.id });
    await audit(tx, actor, { action: 'plan.create', entityType: 'plan', entityId: plan.id, newValues: input });
    return plan.id;
  });
  return (await listPlans(db, id))[0];
}

/**
 * A price change applies to future billing only: service accounts on the plan get the new
 * rate for their next invoice, while invoices already generated keep the amounts billed.
 */
export async function updatePlan({ db, actor }: Ctx, id: number, input: PlanUpdateInput): Promise<PlanRow> {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(servicePlans).where(eq(servicePlans.id, id)).for('update');
    if (!before) throw notFound('Plan');
    const changes = {
      name: input.name,
      monthlyPrice: input.monthlyPrice,
      installationFee: input.installationFee,
      reconnectionFee: input.reconnectionFee,
      speedMbps: input.speedMbps,
      channelCount: input.channelCount,
      description: input.description === undefined ? undefined : input.description || null,
      isActive: input.isActive,
    };
    const changed = diff(before, changes);
    if (!changed) return;
    await tx.update(servicePlans).set({ ...changes, updatedAt: new Date() }).where(eq(servicePlans.id, id));
    if (input.monthlyPrice !== undefined && input.monthlyPrice !== before.monthlyPrice) {
      await tx.execute(sql`
        insert into service_events (service_account_id, event_type, description, effective_date, created_by)
        select sa.id, 'RATE_CHANGED', ${`Plan ${before.code} price changed from ${before.monthlyPrice / 100} to ${input.monthlyPrice / 100}; applies to future billing`}, ${today()}, ${actor.id}
          from service_accounts sa where sa.plan_id = ${id} and sa.status <> 'TERMINATED'`);
      await tx.execute(sql`
        update service_accounts set current_rate = ${input.monthlyPrice}, monthly_discount = least(monthly_discount, ${input.monthlyPrice}), updated_at = now()
         where plan_id = ${id} and status <> 'TERMINATED'`);
    }
    await audit(tx, actor, { action: 'plan.update', entityType: 'plan', entityId: id, oldValues: changed.old, newValues: changed.new });
  });
  return (await listPlans(db, id))[0];
}

// ---------------- collection areas ----------------
export async function listAreas(db: DbOrTx, areaId?: number): Promise<AreaRow[]> {
  return rows<AreaRow>(
    db,
    sql`select a.id, a.code, a.name, a.description, a.route_notes as "routeNotes", a.is_active as "isActive",
          (select count(*) from subscribers s where s.collection_area_id = a.id and s.status = 'ACTIVE') as "subscriberCount",
          coalesce((select json_agg(json_build_object('id', c.id, 'name', c.full_name) order by c.full_name)
                      from collector_assignments ca join collectors c on c.id = ca.collector_id
                     where ca.area_id = a.id and ca.is_active), '[]'::json) as collectors
        from collection_areas a ${areaId ? sql`where a.id = ${areaId}` : sql``} order by a.name`,
  );
}

export async function saveArea({ db, actor }: Ctx, id: number | null, input: AreaInput): Promise<AreaRow> {
  const values = { code: input.code, name: input.name, description: input.description || null, routeNotes: input.routeNotes || null, isActive: input.isActive };
  const areaId = await db.transaction(async (tx) => {
    if (id === null) {
      const [area] = await tx.insert(collectionAreas).values(values).returning({ id: collectionAreas.id });
      await audit(tx, actor, { action: 'area.create', entityType: 'collection_area', entityId: area.id, newValues: values });
      return area.id;
    }
    const [before] = await tx.select().from(collectionAreas).where(eq(collectionAreas.id, id));
    if (!before) throw notFound('Collection area');
    await tx.update(collectionAreas).set(values).where(eq(collectionAreas.id, id));
    const changed = diff(before, values);
    if (changed) await audit(tx, actor, { action: 'area.update', entityType: 'collection_area', entityId: id, oldValues: changed.old, newValues: changed.new });
    return id;
  });
  return (await listAreas(db, areaId))[0];
}

// ---------------- collectors ----------------
export async function listCollectors(db: DbOrTx, collectorId?: number): Promise<CollectorRow[]> {
  return rows<CollectorRow>(
    db,
    sql`select c.id, c.code, c.full_name as "fullName", c.phone, c.is_active as "isActive",
          (select count(*) from subscribers s where s.collector_id = c.id and s.status = 'ACTIVE') as "subscriberCount",
          coalesce((select json_agg(json_build_object('id', a.id, 'name', a.name) order by a.name)
                      from collector_assignments ca join collection_areas a on a.id = ca.area_id
                     where ca.collector_id = c.id and ca.is_active), '[]'::json) as areas
        from collectors c ${collectorId ? sql`where c.id = ${collectorId}` : sql``} order by c.full_name`,
  );
}

export async function saveCollector({ db, actor }: Ctx, id: number | null, input: CollectorInput): Promise<CollectorRow> {
  const values = { code: input.code, fullName: input.fullName, phone: input.phone || null, isActive: input.isActive };
  const collectorId = await db.transaction(async (tx) => {
    let cid = id;
    if (cid === null) {
      const [created] = await tx.insert(collectors).values(values).returning({ id: collectors.id });
      cid = created.id;
      await audit(tx, actor, { action: 'collector.create', entityType: 'collector', entityId: cid, newValues: { ...values, areaIds: input.areaIds } });
    } else {
      const [before] = await tx.select().from(collectors).where(eq(collectors.id, cid));
      if (!before) throw notFound('Collector');
      await tx.update(collectors).set(values).where(eq(collectors.id, cid));
      await audit(tx, actor, { action: 'collector.update', entityType: 'collector', entityId: cid, oldValues: before, newValues: { ...values, areaIds: input.areaIds } });
    }
    // Area assignments keep history: ended assignments are closed, not deleted.
    const current = await tx.select().from(collectorAssignments).where(and(eq(collectorAssignments.collectorId, cid), eq(collectorAssignments.isActive, true)));
    for (const assignment of current.filter((a) => !input.areaIds.includes(a.areaId))) {
      await tx.update(collectorAssignments).set({ isActive: false, assignedTo: today() }).where(eq(collectorAssignments.id, assignment.id));
    }
    const added = input.areaIds.filter((areaId) => !current.some((a) => a.areaId === areaId));
    if (added.length) {
      await tx.insert(collectorAssignments).values(added.map((areaId) => ({ collectorId: cid, areaId, assignedFrom: today(), assignedBy: actor.id })));
    }
    return cid;
  });
  return (await listCollectors(db, collectorId))[0];
}
