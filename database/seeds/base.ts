/**
 * Base seed: reference data every installation needs (roles, permissions, service types,
 * document number sequences). Idempotent - safe to run on every deployment.
 */
import { ALL_PERMISSIONS, PERMISSIONS, ROLES } from '@bcis/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../../source/api/src/db/client';
import { permissions, rolePermissions, roles, serviceTypes } from '../../source/api/src/db/schema';
import { SEQUENCES } from '../../source/api/src/lib/sequences';

export async function seedBase(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    for (const code of ALL_PERMISSIONS) {
      await tx.insert(permissions).values({ code, description: PERMISSIONS[code] }).onConflictDoUpdate({ target: permissions.code, set: { description: PERMISSIONS[code] } });
    }
    for (const role of ROLES) {
      await tx
        .insert(roles)
        .values({ code: role.code, name: role.name, description: role.description })
        .onConflictDoUpdate({ target: roles.code, set: { name: role.name, description: role.description } });
    }
    // The role matrix in @bcis/shared is the source of truth; re-sync it on every run.
    await tx.delete(rolePermissions);
    await tx.execute(sql`delete from permissions where code not in ${ALL_PERMISSIONS}`);
    for (const role of ROLES) {
      await tx.execute(sql`
        insert into role_permissions (role_id, permission_id)
        select r.id, p.id from roles r cross join permissions p where r.code = ${role.code} and p.code in ${[...role.permissions]}`);
    }

    for (const [code, name] of [['INTERNET', 'Internet'], ['CABLE', 'Cable'], ['COMBO', 'Combo']] as const) {
      await tx.insert(serviceTypes).values({ code, name }).onConflictDoNothing();
    }
    for (const [name, def] of Object.entries(SEQUENCES)) {
      await tx.execute(sql`insert into number_sequences (name, prefix, padding, next_value) values (${name}, ${def.prefix}, ${def.padding}, 1) on conflict (name) do nothing`);
    }
  });
}
