import { sql } from 'drizzle-orm';
import { one, type DbOrTx } from '../db/client';

export const SEQUENCES = {
  SUBSCRIBER: { prefix: 'BCIS-', padding: 5 },
  SERVICE_ACCOUNT: { prefix: 'SA-', padding: 6 },
  INVOICE: { prefix: 'INV-', padding: 6 },
  RECEIPT: { prefix: 'RCPT-', padding: 6 },
  ADJUSTMENT: { prefix: 'ADJ-', padding: 5 },
  REVERSAL: { prefix: 'REV-', padding: 5 },
  BATCH: { prefix: 'CB-', padding: 5 },
  REMITTANCE: { prefix: 'REM-', padding: 5 },
} as const;

export type SequenceName = keyof typeof SEQUENCES;

/**
 * Issues the next document number. The UPDATE takes a row lock that is held until the
 * surrounding transaction ends, so two PCs can never receive the same number, and a
 * rolled-back transaction gives its number back (no gaps, no duplicates).
 * Always call this inside the transaction that inserts the numbered record.
 */
export async function nextNumber(tx: DbOrTx, name: SequenceName): Promise<string> {
  const row = await one<{ prefix: string; padding: number; value: number }>(
    tx,
    sql`update number_sequences set next_value = next_value + 1 where name = ${name} returning prefix, padding, next_value - 1 as value`,
  );
  if (!row) throw new Error(`Number sequence ${name} is not initialised. Run the base seed.`);
  return `${row.prefix}${String(row.value).padStart(row.padding, '0')}`;
}
