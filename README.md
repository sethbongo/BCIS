# BCIS Subscription Billing and Collection System

Desktop billing, collection and subscriber-ledger system for **Bukidnon Cable and Internet Services**: Internet, Cable and Combo subscriptions, monthly billing, Cash/GCash collection, collector accountability, overdue receivables, reports, audit trail and backup/restore, for three office PCs working at the same time.

```
PC 1  Owner/Admin  ─┐
PC 2  Cashier  ─────┼── LAN ──>  BCIS API server (Fastify)  ──>  PostgreSQL
PC 3  Operations  ──┘            attachments · backups · audit · logs
        Electron + React clients (no direct database access)
```

| | |
|---|---|
| Desktop client | Electron 44 · React 19 · TypeScript strict · Tailwind CSS 4 · TanStack Query/Table · React Hook Form |
| API server | Fastify 5 · Drizzle ORM · Zod 4 · Pino |
| Database | PostgreSQL (migrations in `database/migrations`) |
| Reports | pdfmake (PDF) · ExcelJS (XLSX) · CSV |
| Tests | Vitest (unit + API acceptance) · Playwright (Electron end-to-end) |

---

## Quick start (development / demo on one PC)

**You need:** Windows 10/11, [Node.js 22+](https://nodejs.org), [PostgreSQL 15+](https://www.postgresql.org/download/windows/) installed (only its programs are used; you do not need its password), and Git.

```powershell
npm install                 # 1. install all packages (also downloads Electron)
npm run setup               # 2. create .env with random local passwords
npm run db:start            # 3. start the project's own PostgreSQL on port 5433
npm run db:reset -- --yes   # 4. create tables + load the synthetic demo data
npm run dev                 # 5. start the API and the desktop app
```

Sign in with one of the demo users. The password for all of them is the value of `SEED_DEMO_PASSWORD` in your `.env` file.

| Username | Role | Lands on |
|---|---|---|
| `owner` | Owner / Super Admin | Dashboard (everything, incl. users, settings, backup/restore) |
| `admin` | Administrator | Dashboard (billing, GCash verification, reversals, closing batches) |
| `cashier` | Cashier | Receive Payment |
| `supervisor` | Collection Supervisor | Dashboard (batches, remittance, reconciliation) |
| `auditor` | Accounting / Auditor | Dashboard (read-only finance, reports, audit log) |
| `tech` | Technician | Services (reconnection work only) |
| `viewer` | Read-only Viewer | Dashboard and reports |

> **After every reboot** run `npm run db:start` again before `npm run dev` (the local PostgreSQL in `.localdb/` is not a Windows service).
> To go back to a clean demo dataset at any time: `npm run db:reset -- --yes`.

To run it like the real office (three PCs, installed client, PostgreSQL service), follow [`docs/deployment-guide.md`](docs/deployment-guide.md).

---

## Commands

| Command | What it does |
|---|---|
| `npm run setup` | Creates `.env` from `.env.example` with generated secrets (never committed) |
| `npm run db:start` / `db:stop` / `db:status` | Local PostgreSQL cluster in `.localdb/` (port 5433) |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Migrations + base data (roles, permissions, sequences) — for production |
| `npm run db:reset -- --yes` | **Deletes all data**, then migrations + base + demo dataset |
| `npm run db:generate` | Generate a new migration after changing `source/api/src/db/schema.ts` |
| `npm run owner:create -- <username> "<Full Name>"` | Create the first Owner on a production database |
| `npm run dev` | API (watch mode) + desktop app (hot reload) |
| `npm run dev:api` / `npm run dev:desktop` | Start only one of them |
| `npm run build` | Production build of API and desktop app |
| `npm run start:api` | Run the built API server |
| `npm run dist` | Build the Windows installer into `release/` |
| `npm run typecheck` / `npm run lint` | TypeScript strict check / ESLint |
| `npm test` | Unit tests + API acceptance tests (AT-01 … AT-12) on the `bcis_test` database |
| `npm run test:e2e` | Playwright tests on the real Electron app; saves screenshots to `tests/screenshots/` |
| `npm run test:report` | Runs the tests and writes `tests/acceptance-test-report.pdf` |
| `npm run reports:samples` | Writes sample PDF/XLSX reports to `reports-samples/` |
| `npm run docs:build` | Builds `docs/*.pdf`, the ERD and the data dictionary |
| `npm run backup:create` | Create and verify a backup from the command line (for Task Scheduler) |

---

## Folder structure

```
BCIS/
├── source/
│   ├── shared/     domain rules, permission matrix, Zod schemas, shared types
│   ├── api/        Fastify API server (routes → services → PostgreSQL)
│   └── desktop/    Electron main + preload + React renderer
├── database/
│   ├── migrations/ SQL migrations (schema + integrity triggers)
│   └── seeds/      base and demo seed scripts
├── docs/           technical documentation, user manual, ERD, data dictionary, deployment guide
├── tests/
│   ├── acceptance/ API acceptance tests AT-01 … AT-12
│   ├── e2e/        Playwright desktop tests
│   ├── screenshots/        UI evidence produced by the e2e run
│   ├── acceptance-test-report.pdf
│   ├── test-plan.md  ·  bug-log.md
├── reports-samples/  sample PDF and XLSX reports
├── release/          Windows installer (built with `npm run dist`)
├── scripts/          setup, local database, docs and report generators
├── CLAUDE.md · .claude/rules/   project rules for AI-assisted development
└── README.md
```

---

## How the financial rules are kept correct

* **Money is integer centavos** (`BIGINT`); no floating-point arithmetic. `parseFloat` is banned by lint.
* **Posting is transactional.** A payment, its allocations, invoice balances, receipt number, ledger entry and audit record commit together or not at all.
* **Oldest unpaid invoice first**; excess is kept as **advance credit** and applied to later invoices automatically.
* **Nothing posted is deleted.** Payments are reversed, invoices are voided or adjusted. PostgreSQL triggers reject `DELETE`/`UPDATE` on posted payments, receipts, ledger entries and audit rows.
* **No duplicates.** Partial unique indexes stop a second invoice for the same service account and period, and a second posted payment for the same GCash reference. Receipt numbers come from a row-locked sequence.
* **Collector shortage/overage is explicit.** A batch that does not balance cannot be reconciled without a recorded reason; the database refuses to store it as balanced.
* **Server-side authorization** on every route; the desktop renderer is sandboxed and never holds the session token.
* **Integrity check** (Administration › Backup & Restore) re-derives all balances from the raw tables.

Details: [`docs/technical-documentation.pdf`](docs/technical-documentation.pdf) · [`docs/user-manual.pdf`](docs/user-manual.pdf) · [`docs/erd.pdf`](docs/erd.pdf) · [`docs/data-dictionary.md`](docs/data-dictionary.md)

---

## Demo data

`npm run db:reset -- --yes` builds a **fully synthetic** dataset by replaying five months of activity through the real services: 7 users (one per role), 7 plans (3 Internet, 2 Cable, 2 Combo), 3 collection areas, 2 collectors, 50 subscribers with 62 service accounts, 300+ invoices, 170 payments (cash, GCash, bank transfer; exact, partial and advance), overdue accounts in every aging bucket, closed collection batches including a shortage and an overage, a reversed payment, a voided invoice, a credit adjustment, three suspensions and two reconnections, and GCash proofs waiting for verification (one with a duplicate reference). No real customer data is used anywhere.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `DATABASE_URL is required` | Run `npm run setup` |
| `Cannot connect to local PostgreSQL` / `ECONNREFUSED 127.0.0.1:5433` | Run `npm run db:start` (needed after each reboot) |
| `initdb` / `pg_ctl` not found | Install PostgreSQL, or set `PG_BIN_DIR` in `.env` to its `bin` folder |
| Port 4000 already in use | Another API is still running; close it or change `API_PORT` in `.env` |
| Desktop app shows "Cannot reach the BCIS server" | Start the API (`npm run dev:api`), or click **Change** on the sign-in screen and test the server address |
| Electron window never opens from an editor terminal | Use `npm run dev` (it clears `ELECTRON_RUN_AS_NODE`), or run from a normal PowerShell window |
| Backup fails with "pg_dump could not be started" | Set `PG_BIN_DIR` in `.env` |
| Forgot the demo password | It is `SEED_DEMO_PASSWORD` in `.env` |
