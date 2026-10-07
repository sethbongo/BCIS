import type { Paged } from '@bcis/shared';
import { sql, type SQL } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

// BIGINT (money in centavos, counts) fits safely in a JS number for this system's ranges.
pg.types.setTypeParser(20, (value) => Number(value));

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface Database {
  db: Db;
  pool: pg.Pool;
}

export function createDatabase(connectionString: string, max = 10): Database {
  const pool = new pg.Pool({ connectionString, max });
  return { pool, db: drizzle(pool, { schema, casing: 'snake_case' }) };
}

/** Runs a raw parameterized query and returns its rows. */
export async function rows<T>(db: DbOrTx, query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

export async function one<T>(db: DbOrTx, query: SQL): Promise<T | undefined> {
  return (await rows<T>(db, query))[0];
}

/** ISO-8601 UTC string for a TIMESTAMPTZ expression in raw SQL. */
export const iso = (expr: string): SQL => sql.raw(`to_char(${expr} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);

/** Escapes LIKE wildcards and wraps the term for a "contains" match. */
export const contains = (term: string): string => `%${term.replace(/[\\%_]/g, '\\$&')}%`;

export interface PageInput {
  page: number;
  pageSize: number;
  sort?: string;
  dir?: 'asc' | 'desc';
}

/**
 * Server-side pagination for list screens. `sortable` is a whitelist that maps
 * client sort keys to SQL expressions, so user input never reaches ORDER BY.
 */
export async function paged<T>(db: DbOrTx, base: SQL, input: PageInput, sortable: Record<string, string>, defaultOrder: string): Promise<Paged<T>> {
  const column = input.sort ? sortable[input.sort] : undefined;
  const order = column ? `${column} ${input.dir === 'desc' ? 'desc' : 'asc'} nulls last, 1` : defaultOrder;
  const offset = (input.page - 1) * input.pageSize;
  const [count, data] = await Promise.all([
    one<{ total: number }>(db, sql`select count(*) as total from (${base}) t`),
    rows<T>(db, sql`select * from (${base}) t order by ${sql.raw(order)} limit ${input.pageSize} offset ${offset}`),
  ]);
  return { rows: data, total: count?.total ?? 0, page: input.page, pageSize: input.pageSize };
}

/** Combines optional WHERE fragments with AND. */
export function where(...conditions: (SQL | undefined | false | null | 0 | "")[]): SQL {
  const active = conditions.filter((c): c is SQL => !!c);
  return active.length ? sql`where ${sql.join(active, sql` and `)}` : sql``;
}
