# BCIS Subscription Billing and Collection System — project instructions

Electron desktop clients → Fastify API → PostgreSQL. Three office PCs use it at once. Financial correctness and data integrity come before everything else, including speed of delivery and visual polish.

## Layout

- `source/shared` — pure domain rules (money, allocation, invoice status, aging, reconciliation), permission matrix, Zod schemas, response types. No I/O.
- `source/api` — `routes.ts` (authorize → validate → delegate), `modules/*/service.ts` (rules + SQL), `db/schema.ts`, `lib/`.
- `source/desktop` — `main` (IPC, API proxy, token), `preload` (bridge), `renderer` (React).
- `database/migrations`, `database/seeds`, `tests/acceptance`, `tests/e2e`, `docs`, `scripts`.

## Commands

```
npm run db:start            # local PostgreSQL (port 5433) — needed before tests or dev
npm run typecheck && npm run lint
npm test                    # unit + API acceptance (uses bcis_test, safe to run any time)
npm run db:reset -- --yes   # rebuild the demo database (destroys data in the dev DB)
npm run build -w @bcis/desktop && npm run test:e2e
npm run db:generate         # after editing schema.ts: creates a migration, never edit old ones
```

## Rules that must not be broken

Read `.claude/rules/financial-rules.md` and `.claude/rules/security-rules.md` before touching billing, payments, collections, auth or the Electron boundary. In short:

1. Money is integer centavos. Never `parseFloat`, never `Number` arithmetic on peso decimals, never `toFixed` for calculation.
2. Every multi-step financial change runs in one `db.transaction`, takes the subscriber lock first (`lockSubscriber`), and writes its audit record inside the same transaction.
3. Posted payments, receipts, ledger entries, finalized invoices and audit rows are never deleted or edited. Use reversal, void or adjustment. Do not weaken or drop the guard triggers.
4. Business rules go in services or `@bcis/shared`, not in React components or route handlers.
5. Every route declares its permission with `app.can(...)`. Hiding a button is not authorization.
6. The renderer never talks to the network or the database and never receives the session token. New capabilities go through a new, narrow, Zod-validated IPC handler.
7. Every schema change is a new migration (`npm run db:generate`). Never edit an applied migration.
8. Validate all external input with Zod schemas from `@bcis/shared`.

## Workflow for a change

1. Read the requirement and the existing service it touches.
2. Identify the domain, data and security rules affected.
3. Implement the smallest coherent feature.
4. Add or update the migration and the Zod schema.
5. Add tests: unit test for a pure rule, acceptance test for a posting flow.
6. Run `npm run typecheck && npm run lint && npm test`.
7. Review the diff specifically for financial and security impact.
8. Commit with a message that says what changed and why.

## Conventions

- TypeScript strict; no `any` in services, domain code or API routes.
- Database columns are snake_case; TypeScript properties are camelCase (Drizzle `casing: 'snake_case'`).
- Raw SQL uses the Drizzle `sql` tag with bound parameters only; sort columns come from a whitelist (`paged()`).
- Dates: business dates are `YYYY-MM-DD` strings in the business timezone (`today()`); timestamps are `timestamptz`.
- UI: tokens in `styles.css`; financial values right-aligned with tabular numerals (`.num`); statuses always text + colour (`StatusBadge`).
- Never put real subscriber data, real GCash details or real passwords in code, seeds, tests or prompts.
