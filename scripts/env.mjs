// Shared helpers for the plain-Node maintenance scripts.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_PATH = join(ROOT, '.env');

export function readEnv() {
  const env = {};
  if (!existsSync(ENV_PATH)) return env;
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2];
  }
  return env;
}

const DEFAULT_BIN_DIRS = [
  'C:\\Program Files\\PostgreSQL\\18\\bin',
  'C:\\Program Files\\PostgreSQL\\17\\bin',
  'C:\\Program Files\\PostgreSQL\\16\\bin',
  'C:\\Program Files\\PostgreSQL\\15\\bin',
];

export function pgBin(tool) {
  const exe = process.platform === 'win32' ? `${tool}.exe` : tool;
  const dirs = [readEnv().PG_BIN_DIR, process.env.PG_BIN_DIR, ...DEFAULT_BIN_DIRS].filter(Boolean);
  for (const dir of dirs) {
    const candidate = join(dir, exe);
    if (existsSync(candidate)) return candidate;
  }
  return exe; // fall back to PATH
}
