import { mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import pino, { type LoggerOptions } from 'pino';
import { buildApp } from './app';
import { config } from './config';
import { createDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { refreshOverdue } from './modules/billing/core';

for (const dir of [config.attachmentsDir, config.backupsDir, config.logsDir]) mkdirSync(dir, { recursive: true });

// Structured logs. Secrets never reach the log: credentials and tokens are redacted and request bodies are not logged.
const loggerOptions: LoggerOptions = {
  level: config.logLevel,
  redact: { paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.token', '*.dataBase64'], censor: '[redacted]' },
};
const stream = config.isProduction
  ? pino.multistream([{ stream: process.stdout }, { stream: pino.destination({ dest: join(config.logsDir, 'api.log'), mkdir: true, sync: false }) }])
  : undefined;

async function main(): Promise<void> {
  const database = createDatabase(config.databaseUrl);
  await runMigrations(database.db);

  const app = await buildApp({
    database,
    logger: config.isProduction ? { ...loggerOptions, stream } as LoggerOptions : { ...loggerOptions, transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
  });

  const markOverdue = () => refreshOverdue(database.db).catch((err) => app.log.error({ err }, 'overdue refresh failed'));
  await markOverdue();
  const timer = setInterval(markOverdue, 10 * 60_000);

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    clearInterval(timer);
    await app.close();
    await database.pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => `http://${n!.address}:${config.port}`);
  app.log.info(`BCIS API ${config.version} ready. Office PCs connect to: ${lan.join(', ') || `http://localhost:${config.port}`}`);
}

main().catch((err) => {
  console.error('The BCIS API could not start:', err);
  process.exit(1);
});
