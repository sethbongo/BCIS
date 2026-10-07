/**
 * Creates the first Owner account on a new installation (the demo seed is not used in production).
 *   npm run owner:create -- <username> "<Full Name>"
 * The password is read from the BCIS_OWNER_PASSWORD environment variable; if it is not set a
 * strong random password is generated and shown once. It is stored only as a salted scrypt hash.
 */
import { zPassword } from '@bcis/shared';
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { config } from '../source/api/src/config';
import { createDatabase } from '../source/api/src/db/client';
import { users } from '../source/api/src/db/schema';
import { hashPassword } from '../source/api/src/lib/passwords';

const [username = 'owner', fullName = 'System Owner'] = process.argv.slice(2);
const { db, pool } = createDatabase(config.databaseUrl, 2);

async function main(): Promise<void> {
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('Username must be 3-40 lower-case letters, digits, dot, dash or underscore.');
  const supplied = process.env.BCIS_OWNER_PASSWORD;
  const password = supplied ?? `Bc-${randomBytes(12).toString('base64url')}9a`;
  const check = zPassword.safeParse(password);
  if (!check.success) throw new Error(`Password rejected: ${check.error.issues[0].message}`);

  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const [role] = (await tx.execute(sql`select id from roles where code = 'OWNER'`)).rows as { id: number }[];
    if (!role) throw new Error('Roles are missing. Run `npm run db:seed` first.');
    const [user] = await tx.insert(users).values({ username, fullName, passwordHash }).returning({ id: users.id });
    await tx.execute(sql`insert into user_roles (user_id, role_id) values (${user.id}, ${role.id})`);
    await tx.execute(sql`insert into audit_logs (action, entity_type, entity_id, new_values) values ('user.create', 'user', ${String(user.id)}, ${JSON.stringify({ username, roles: ['OWNER'], via: 'owner:create script' })}::jsonb)`);
  });
  console.log(`Owner account "${username}" created.`);
  if (!supplied) console.log(`Temporary password (shown once, change it after first sign-in): ${password}`);
}

main()
  .catch((err) => {
    const pgError = (err as { cause?: { code?: string } }).cause;
    console.error(pgError?.code === '23505' ? `A user named "${username}" already exists.` : err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
