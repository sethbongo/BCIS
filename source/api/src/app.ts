import { DomainError, type ApiErrorBody, type HealthStatus } from '@bcis/shared';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { LoggerOptions } from 'pino';
import { ZodError } from 'zod';
import { config } from './config';
import type { Database } from './db/client';
import { AppError, CONSTRAINT_MESSAGES } from './lib/errors';
import { authRoutes } from './modules/auth/routes';
import { registerAuth } from './plugins/auth';
import { apiRoutes } from './routes';

interface PgError {
  code?: string;
  constraint?: string;
  message: string;
  severity?: string;
}

function findPgError(err: unknown): PgError | null {
  // Drizzle wraps driver errors; the PostgreSQL error is the cause.
  for (let e = err as { cause?: unknown } | undefined, depth = 0; e && depth < 4; e = e.cause as typeof e, depth++) {
    const candidate = e as PgError;
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code) && candidate.severity) return candidate;
  }
  return null;
}

/** Maps any thrown error to a safe HTTP response. Technical detail goes to the log, never to the client. */
function toResponse(err: unknown): { status: number; body: ApiErrorBody; expected: boolean } {
  const make = (status: number, code: string, message: string, fields?: Record<string, string>) => ({ status, body: { error: { code, message, fields } }, expected: true });

  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) fields[issue.path.join('.') || '_'] ??= issue.message;
    return make(400, 'VALIDATION_ERROR', 'Some of the information entered is not valid. Please check the highlighted fields.', fields);
  }
  if (err instanceof AppError) return make(err.status, err.code, err.message, err.fields);
  if (err instanceof DomainError) return make(422, err.code, err.message);

  const pg = findPgError(err);
  if (pg) {
    if (pg.code === '23505') return make(409, 'DUPLICATE', CONSTRAINT_MESSAGES[pg.constraint ?? ''] ?? 'A record with the same unique value already exists.');
    if (pg.code === '23503') return make(409, 'REFERENCED', 'This record is linked to other records and the change cannot be applied.');
    if (pg.code === '23001') return make(409, 'PROTECTED_RECORD', pg.message);
    if (pg.code === '23514') return make(422, 'INTEGRITY_RULE', 'The change was rejected because it would break a data integrity rule.');
    if (pg.code === '40001' || pg.code === '40P01') return make(409, 'CONCURRENT_UPDATE', 'Another user changed this record at the same moment. Please try again.');
  }
  const fastifyError = err as FastifyError;
  if (typeof fastifyError.statusCode === 'number' && fastifyError.statusCode >= 400 && fastifyError.statusCode < 500) {
    const message = fastifyError.statusCode === 413 ? 'The uploaded file is too large.' : 'The request could not be processed.';
    return make(fastifyError.statusCode, fastifyError.code ?? 'BAD_REQUEST', message);
  }
  return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server. The problem has been logged; please try again or contact the administrator.' } }, expected: false };
}

export interface AppOptions {
  database: Database;
  logger?: LoggerOptions | boolean;
}

export async function buildApp({ database, logger = false }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger, bodyLimit: 512 * 1024 });
  app.decorate('db', database.db);
  registerAuth(app);

  app.setErrorHandler((err, req, reply) => {
    const { status, body, expected } = toResponse(err);
    if (expected) req.log.info({ code: body.error.code, status }, body.error.message);
    else req.log.error({ err, reqId: req.id }, 'unhandled error');
    return reply.status(status).send(body);
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'The requested resource does not exist.' } } satisfies ApiErrorBody));

  // API responses carry live financial data: never cache, never sniff.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });

  app.get('/api/health', async (_req, reply): Promise<HealthStatus> => {
    let database_: HealthStatus['database'] = 'up';
    try {
      await database.db.execute(sql`select 1`);
    } catch {
      database_ = 'down';
      reply.status(503);
    }
    return { status: database_ === 'up' ? 'ok' : 'degraded', version: config.version, database: database_, time: new Date().toISOString() };
  });

  await app.register(
    async (api) => {
      await authRoutes(api);
      await apiRoutes(api);
    },
    { prefix: '/api' },
  );
  return app;
}
