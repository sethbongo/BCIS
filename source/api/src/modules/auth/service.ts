import type { AuthUser, LoginInput, LoginResult, Permission, RoleCode } from '@bcis/shared';
import { eq, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../../config';
import { one, rows, type Db, type DbOrTx } from '../../db/client';
import { sessions, users } from '../../db/schema';
import { audit } from '../../lib/audit';
import type { Actor } from '../../lib/context';
import { AppError, unauthorized } from '../../lib/errors';
import { hashPassword, verifyPassword } from '../../lib/passwords';
import { getSettings } from '../../lib/settings';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Verified against when the username does not exist, so response time does not reveal valid usernames.
let dummyHash: Promise<string> | null = null;

export async function loadAuthUser(db: DbOrTx, userId: number): Promise<AuthUser | null> {
  const row = await one<{ id: number; username: string; fullName: string; roles: RoleCode[] | null; permissions: Permission[] | null }>(
    db,
    sql`select u.id, u.username, u.full_name as "fullName",
          (select array_agg(r.code order by r.code) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id) as roles,
          (select array_agg(distinct p.code) from user_roles ur
             join role_permissions rp on rp.role_id = ur.role_id
             join permissions p on p.id = rp.permission_id
            where ur.user_id = u.id) as permissions
        from users u where u.id = ${userId}`,
  );
  if (!row) return null;
  return { ...row, roles: row.roles ?? [], permissions: row.permissions ?? [] };
}

export async function login(db: Db, input: LoginInput, ip: string | null): Promise<LoginResult> {
  const username = input.username.trim().toLowerCase();
  const invalidCredentials = new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect username or password.');
  const [user] = await db.select().from(users).where(eq(users.username, username));
  if (!user) {
    dummyHash ??= hashPassword(randomBytes(12).toString('hex'));
    await verifyPassword(input.password, await dummyHash);
    await audit(db, null, { action: 'auth.login_failed', entityType: 'user', newValues: { username, cause: 'unknown user' } });
    throw invalidCredentials;
  }

  const settings = await getSettings(db);
  const attempt = { id: user.id, username: user.username, ip };
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new AppError(429, 'ACCOUNT_LOCKED', `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= Number(settings['security.maxFailedLogins']);
    await db
      .update(users)
      .set({
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + Number(settings['security.lockoutMinutes']) * 60_000) : null,
      })
      .where(eq(users.id, user.id));
    await audit(db, attempt, { action: lock ? 'auth.account_locked' : 'auth.login_failed', entityType: 'user', entityId: user.id, newValues: { failedAttempts: failed } });
    throw invalidCredentials;
  }
  if (!user.isActive) throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is inactive. Please contact the administrator.');

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3_600_000);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await tx.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), clientName: input.clientName || null, ip, expiresAt });
    await audit(tx, attempt, { action: 'auth.login', entityType: 'user', entityId: user.id, newValues: { client: input.clientName ?? null } });
  });
  const authUser = await loadAuthUser(db, user.id);
  return { token, expiresAt: expiresAt.toISOString(), idleLockMinutes: Number(settings['security.idleLockMinutes']), user: authUser! };
}

export interface ResolvedSession {
  sessionId: string;
  locked: boolean;
  actor: Actor;
}

/** Validates a bearer token and loads the acting user with current permissions. */
export async function resolveSession(db: Db, token: string, ip: string | null): Promise<ResolvedSession> {
  const row = await one<{ id: string; userId: number; isActive: boolean; expired: boolean; idle: boolean; locked: boolean; stale: boolean }>(
    db,
    sql`select s.id, s.user_id as "userId", u.is_active as "isActive",
          (s.revoked_at is not null or s.expires_at < now()) as expired,
          (s.last_seen_at < now() - make_interval(mins => ${config.sessionIdleMinutes})) as idle,
          (s.locked_at is not null) as locked,
          (s.last_seen_at < now() - interval '30 seconds') as stale
        from sessions s join users u on u.id = s.user_id
       where s.token_hash = ${hashToken(token)}`,
  );
  if (!row || row.expired) throw unauthorized('Your session has expired. Please sign in again.');
  if (!row.isActive) throw unauthorized('This account is inactive.');

  let locked = row.locked;
  if (!locked && row.idle) {
    await db.update(sessions).set({ lockedAt: new Date() }).where(eq(sessions.id, row.id));
    locked = true;
  } else if (!locked && row.stale) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.id));
  }
  const user = await loadAuthUser(db, row.userId);
  if (!user) throw unauthorized();
  return { sessionId: row.id, locked, actor: { ...user, ip } };
}

export async function logout(db: Db, session: ResolvedSession): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, session.sessionId));
  await audit(db, session.actor, { action: 'auth.logout', entityType: 'user', entityId: session.actor.id });
}

export async function lock(db: Db, session: ResolvedSession): Promise<void> {
  await db.update(sessions).set({ lockedAt: new Date() }).where(eq(sessions.id, session.sessionId));
}

export async function unlock(db: Db, session: ResolvedSession, password: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, session.actor.id));
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await audit(db, session.actor, { action: 'auth.unlock_failed', entityType: 'user', entityId: session.actor.id });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect password.');
  }
  await db.update(sessions).set({ lockedAt: null, lastSeenAt: new Date() }).where(eq(sessions.id, session.sessionId));
}

export async function changePassword(db: Db, session: ResolvedSession, currentPassword: string, newPassword: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, session.actor.id));
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError(422, 'INVALID_CREDENTIALS', 'Your current password is incorrect.', { currentPassword: 'Incorrect password' });
  }
  const passwordHash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));
    // Sign out every other session of this user.
    await tx.execute(sql`update sessions set revoked_at = now() where user_id = ${user.id} and id <> ${session.sessionId} and revoked_at is null`);
    await audit(tx, session.actor, { action: 'auth.password_changed', entityType: 'user', entityId: user.id });
  });
}

export async function revokeUserSessions(db: DbOrTx, userId: number): Promise<void> {
  await rows(db, sql`update sessions set revoked_at = now() where user_id = ${userId} and revoked_at is null`);
}
