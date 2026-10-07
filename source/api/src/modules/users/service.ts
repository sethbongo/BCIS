import { ROLES, type RoleCode, type RoleRow, type UserCreateInput, type UserRow, type UserUpdateInput } from '@bcis/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import { iso, rows, type DbOrTx } from '../../db/client';
import { roles, userRoles, users } from '../../db/schema';
import { audit } from '../../lib/audit';
import type { Ctx } from '../../lib/context';
import { invalid, notFound } from '../../lib/errors';
import { hashPassword } from '../../lib/passwords';
import { revokeUserSessions } from '../auth/service';

export async function listUsers(db: DbOrTx, userId?: number): Promise<UserRow[]> {
  return rows<UserRow>(
    db,
    sql`select u.id, u.username, u.full_name as "fullName", u.email, u.is_active as "isActive",
          coalesce((select array_agg(r.code order by r.code) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id), '{}') as roles,
          ${iso('u.last_login_at')} as "lastLoginAt", ${iso('u.locked_until')} as "lockedUntil", ${iso('u.created_at')} as "createdAt"
        from users u ${userId ? sql`where u.id = ${userId}` : sql``} order by u.username`,
  );
}

export async function listRoles(db: DbOrTx): Promise<RoleRow[]> {
  const data = await rows<{ code: RoleCode; name: string; description: string; permissions: string[]; userCount: number }>(
    db,
    sql`select r.code, r.name, r.description,
          coalesce((select array_agg(p.code order by p.code) from role_permissions rp join permissions p on p.id = rp.permission_id where rp.role_id = r.id), '{}') as permissions,
          (select count(*) from user_roles ur where ur.role_id = r.id) as "userCount"
        from roles r`,
  );
  // Present roles in the documented order (Owner first).
  return ROLES.flatMap((def) => data.filter((r) => r.code === def.code)) as RoleRow[];
}

async function setRoles(tx: DbOrTx, userId: number, roleCodes: readonly RoleCode[]): Promise<void> {
  const found = await tx.select().from(roles).where(inArray(roles.code, [...roleCodes]));
  if (found.length !== new Set(roleCodes).size) throw invalid('One or more selected roles do not exist.');
  await tx.delete(userRoles).where(eq(userRoles.userId, userId));
  await tx.insert(userRoles).values(found.map((r) => ({ userId, roleId: r.id })));
}

export async function createUser({ db, actor }: Ctx, input: UserCreateInput): Promise<UserRow> {
  const passwordHash = await hashPassword(input.password);
  const id = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ username: input.username, fullName: input.fullName, email: input.email || null, passwordHash, isActive: input.isActive })
      .returning({ id: users.id });
    await setRoles(tx, user.id, input.roleCodes);
    await audit(tx, actor, {
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      newValues: { username: input.username, fullName: input.fullName, roles: input.roleCodes, isActive: input.isActive },
    });
    return user.id;
  });
  return (await listUsers(db, id))[0];
}

export async function updateUser({ db, actor }: Ctx, id: number, input: UserUpdateInput): Promise<UserRow> {
  const [before] = await listUsers(db, id);
  if (!before) throw notFound('User');
  if (id === actor.id && (input.isActive === false || (input.roleCodes && !input.roleCodes.includes('OWNER') && before.roles.includes('OWNER')))) {
    throw invalid('You cannot deactivate your own account or remove your own Owner role.');
  }
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        fullName: input.fullName ?? before.fullName,
        email: input.email === undefined ? before.email : input.email || null,
        isActive: input.isActive ?? before.isActive,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
    if (input.roleCodes) await setRoles(tx, id, input.roleCodes);
    // Role or status changes take effect immediately: existing sessions must sign in again.
    if (input.isActive === false) await revokeUserSessions(tx, id);
    await audit(tx, actor, {
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      oldValues: { fullName: before.fullName, email: before.email, isActive: before.isActive, roles: before.roles },
      newValues: { fullName: input.fullName, email: input.email, isActive: input.isActive, roles: input.roleCodes },
    });
  });
  return (await listUsers(db, id))[0];
}

export async function resetPassword({ db, actor }: Ctx, id: number, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({ passwordHash, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (!updated.length) throw notFound('User');
    await revokeUserSessions(tx, id);
    await audit(tx, actor, { action: 'user.reset_password', entityType: 'user', entityId: id });
  });
}
