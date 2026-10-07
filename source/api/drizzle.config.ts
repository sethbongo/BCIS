import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` only diffs the schema against the migration snapshots;
// it does not need a database connection.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: '../../database/migrations',
  casing: 'snake_case',
});
