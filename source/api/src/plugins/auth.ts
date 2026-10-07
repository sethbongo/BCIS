import type { Permission } from '@bcis/shared';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Db } from '../db/client';
import type { Ctx } from '../lib/context';
import { AppError, forbidden, unauthorized } from '../lib/errors';
import { resolveSession, type ResolvedSession } from '../modules/auth/service';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    /** preHandler: requires a valid unlocked session holding at least one of the permissions. */
    can: (...anyOf: Permission[]) => preHandlerAsyncHookHandler;
    /** preHandler: requires a valid session; `allowLocked` is used by unlock/logout/me. */
    authenticated: (options?: { allowLocked?: boolean }) => preHandlerAsyncHookHandler;
  }
  interface FastifyRequest {
    session: ResolvedSession | null;
  }
}

async function authenticate(app: FastifyInstance, req: FastifyRequest, allowLocked: boolean): Promise<ResolvedSession> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  const session = await resolveSession(app.db, header.slice(7).trim(), req.ip);
  if (session.locked && !allowLocked) throw new AppError(423, 'SESSION_LOCKED', 'Your session is locked. Enter your password to continue.');
  req.session = session;
  return session;
}

/**
 * Server-side authorization. Every protected route declares the permission it needs;
 * the check runs here on the server, so hiding a button in the UI is never the only barrier.
 */
export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest('session', null);
  app.decorate('authenticated', (options = {}) => async (req) => {
    await authenticate(app, req, options.allowLocked ?? false);
  });
  app.decorate('can', (...anyOf) => async (req) => {
    const session = await authenticate(app, req, false);
    if (!anyOf.some((p) => session.actor.permissions.includes(p))) {
      req.log.warn({ user: session.actor.username, required: anyOf, url: req.url }, 'permission denied');
      throw forbidden();
    }
  });
}

/** Builds the service context for the authenticated request. */
export function ctx(app: FastifyInstance, req: FastifyRequest): Ctx {
  if (!req.session) throw unauthorized();
  return { db: app.db, actor: req.session.actor };
}

export function sessionOf(req: FastifyRequest): ResolvedSession {
  if (!req.session) throw unauthorized();
  return req.session;
}

/** Parses a numeric route parameter such as :id. */
export function idParam(req: FastifyRequest, name = 'id'): number {
  const value = Number((req.params as Record<string, string>)[name]);
  if (!Number.isInteger(value) || value <= 0) throw new AppError(400, 'BAD_REQUEST', 'Invalid identifier.');
  return value;
}
