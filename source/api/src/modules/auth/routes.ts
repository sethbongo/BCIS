import { ChangePasswordInput, LoginInput, UnlockInput } from '@bcis/shared';
import type { FastifyInstance } from 'fastify';
import { sessionOf } from '../../plugins/auth';
import * as auth from './service';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', async (req) => auth.login(app.db, LoginInput.parse(req.body), req.ip));

  app.get('/auth/me', { preHandler: app.authenticated({ allowLocked: true }) }, async (req) => {
    const session = sessionOf(req);
    const { ip: _ip, ...user } = session.actor;
    return { user, locked: session.locked };
  });

  app.post('/auth/logout', { preHandler: app.authenticated({ allowLocked: true }) }, async (req) => {
    await auth.logout(app.db, sessionOf(req));
    return { ok: true };
  });

  app.post('/auth/lock', { preHandler: app.authenticated({ allowLocked: true }) }, async (req) => {
    await auth.lock(app.db, sessionOf(req));
    return { ok: true };
  });

  app.post('/auth/unlock', { preHandler: app.authenticated({ allowLocked: true }) }, async (req) => {
    await auth.unlock(app.db, sessionOf(req), UnlockInput.parse(req.body).password);
    return { ok: true };
  });

  app.post('/auth/change-password', { preHandler: app.authenticated() }, async (req) => {
    const input = ChangePasswordInput.parse(req.body);
    await auth.changePassword(app.db, sessionOf(req), input.currentPassword, input.newPassword);
    return { ok: true };
  });
}
