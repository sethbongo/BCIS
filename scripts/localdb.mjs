// Manages a project-local PostgreSQL cluster in .localdb/ for development and tests.
// It uses the PostgreSQL binaries already installed on the machine but its own data
// directory and port, so it never touches the system PostgreSQL service or its data.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, pgBin, readEnv } from './env.mjs';

const DATA_DIR = join(ROOT, '.localdb', 'pgdata');
const LOG_FILE = join(ROOT, '.localdb', 'postgres.log');

function connection() {
  const env = readEnv();
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is missing. Run `npm run setup` first.');
  const url = new URL(env.DATABASE_URL);
  const test = env.TEST_DATABASE_URL ? new URL(env.TEST_DATABASE_URL) : null;
  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: url.hostname,
    port: url.port || '5432',
    databases: [url.pathname.slice(1), test?.pathname.slice(1)].filter(Boolean),
  };
}

function run(tool, args, extraEnv = {}) {
  return spawnSync(pgBin(tool), args, { encoding: 'utf8', env: { ...process.env, ...extraEnv } });
}

function isRunning() {
  return run('pg_ctl', ['status', '-D', DATA_DIR]).status === 0;
}

function init(conn) {
  if (existsSync(join(DATA_DIR, 'PG_VERSION'))) return;
  mkdirSync(join(ROOT, '.localdb'), { recursive: true });
  const pwFile = join(ROOT, '.localdb', 'pwfile.tmp');
  writeFileSync(pwFile, conn.password);
  console.log('Initialising local PostgreSQL cluster in .localdb/pgdata ...');
  const res = run('initdb', ['-D', DATA_DIR, '-U', conn.user, `--pwfile=${pwFile}`, '-E', 'UTF8', '--locale=C', '-A', 'scram-sha-256']);
  rmSync(pwFile, { force: true });
  if (res.status !== 0) throw new Error(`initdb failed:\n${res.stdout}\n${res.stderr}`);
}

function start(conn) {
  init(conn);
  if (!isRunning()) {
    const res = spawnSync(
      pgBin('pg_ctl'),
      ['start', '-D', DATA_DIR, '-l', LOG_FILE, '-w', '-t', '60', '-o', `-p ${conn.port} -c listen_addresses=${conn.host}`],
      { stdio: 'ignore' },
    );
    if (res.status !== 0) throw new Error(`pg_ctl start failed. See ${LOG_FILE}`);
  }
  const auth = { PGPASSWORD: conn.password };
  const base = ['-h', conn.host, '-p', conn.port, '-U', conn.user, '-d', 'postgres', '-At'];
  for (const db of conn.databases) {
    const exists = run('psql', [...base, '-c', `select 1 from pg_database where datname='${db}'`], auth);
    if (exists.status !== 0) throw new Error(`Cannot connect to local PostgreSQL: ${exists.stderr}`);
    if (exists.stdout.trim() !== '1') {
      const created = run('psql', [...base, '-c', `create database "${db}"`], auth);
      if (created.status !== 0) throw new Error(`Could not create database ${db}: ${created.stderr}`);
      console.log(`Created database ${db}`);
    }
  }
  console.log(`Local PostgreSQL is running on ${conn.host}:${conn.port} (databases: ${conn.databases.join(', ')})`);
}

function stop() {
  if (!isRunning()) return console.log('Local PostgreSQL is not running.');
  const res = run('pg_ctl', ['stop', '-D', DATA_DIR, '-m', 'fast', '-w']);
  if (res.status !== 0) throw new Error(`pg_ctl stop failed: ${res.stderr}`);
  console.log('Local PostgreSQL stopped.');
}

const command = process.argv[2] ?? 'status';
try {
  if (command === 'start') start(connection());
  else if (command === 'stop') stop();
  else if (command === 'status') console.log(isRunning() ? 'running' : 'stopped');
  else throw new Error(`Unknown command "${command}". Use start | stop | status.`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
