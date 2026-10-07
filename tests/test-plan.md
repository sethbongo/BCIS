# Test Plan

## 1. Scope and objectives

Prove that the BCIS system computes balances correctly, preserves financial history, prevents unauthorized actions and survives concurrent use and restore. Visual completeness is not accepted as evidence: every financial scenario asserts the resulting invoice balances **and** the subscriber ledger.

## 2. Test levels

| Level | Location | Tool | Database | Count |
|---|---|---|---|---|
| Unit — domain rules | `source/shared/src/domain/domain.test.ts` | Vitest | none | 25 |
| API acceptance / integration | `tests/acceptance/*.test.ts` | Vitest + Fastify inject + real HTTP for AT-09 | `bcis_test` (rebuilt from migrations before every run) | 32 |
| Desktop end-to-end | `tests/e2e/desktop.spec.ts` | Playwright driving Electron | demo database | 10 |
| Data integrity | `GET /api/integrity-check` | SQL cross-checks | any | 10 rules |

## 3. Environment

* Windows 11, Node.js 24, PostgreSQL 17 (project-local cluster on port 5433).
* `npm test` never touches the development database: Vitest sets `DATABASE_URL` to `TEST_DATABASE_URL`, and the harness refuses to start otherwise.
* Each acceptance test creates its own plan, subscriber and service account, so tests are independent and can run in any order.

## 4. Mandatory acceptance tests

| ID | Scenario | Automated in | Key assertions |
|---|---|---|---|
| AT-01 | Exact payment 999.00 / 999.00 | `at-01-06-payments.test.ts`, unit | Invoice PAID, balance 0, receipt `RCPT-…`, ledger rows debit 999 / credit 999, closing 0 |
| AT-02 | Partial payment 500.00 of 999.00 | same | PARTIALLY_PAID, balance 499.00, one allocation row of 500.00, ledger 499.00 |
| AT-03 | Advance payment 3,000.00, monthly 1,000.00 | same | 1,000 applied, 2,000 unapplied credit, ledger −2,000; next two invoices auto-paid by CREDIT allocations; allocations + unapplied = 3,000 |
| AT-04 | Aug 999 + Sep 999, pay 1,200 | same | Preview and result: August 0, September 798; manual allocation needs permission and cannot over-apply |
| AT-05 | Duplicate GCash reference | same | Proof alone never pays; second proof flagged; verify → 409 `DUPLICATE_GCASH_REFERENCE`; direct post blocked; DB unique index blocks raw insert; fake image rejected; stored name is server-generated |
| AT-06 | Payment reversal | same | Payment REVERSED and still listed, receipt VOID with same number, reversal linked, invoices restored, ledger restored, audit row with actor + reason + old/new; second reversal 409; DB triggers reject delete/update |
| AT-07 | Remit 20,000 of 20,000 | `at-07-08-collections.test.ts`, unit | Difference 0, BALANCED, supervisor cannot close, admin closes with confirmation |
| AT-08 | Remit 19,500 of 20,000 | same | Difference −500 shown; close before reconcile 409; reconcile without reason 422; SHORTAGE recorded with reason; DB refuses "BALANCED"; report and audit show it |
| AT-09 | Three concurrent clients | `at-09-11-…test.ts` | 16 simultaneous payments over real HTTP: unique gapless receipts; 5 payments on one invoice → exact balance; same billing period from two clients → one invoice each; integrity check clean; sessions independent |
| AT-10 | Authorization | same | Cashier gets 403 on 12 admin operations called directly; no token → 401; every role's permissions equal the documented matrix; lockout after 5 failures; session lock 423 |
| AT-11 | Duplicate billing | same | Second run creates 0, skips 3; one invoice and one ledger debit per account; raw duplicate insert rejected; draft → finalize; void then re-bill once |
| AT-12 | Backup and restore | `at-12-backup-restore.test.ts` | Backup files + checksum; verify; change data; only owner with `RESTORE` can restore; counts back to state A; later records gone; integrity check passes; safety backup exists; tampered backup refused |

## 5. Supporting tests (`workflows.test.ts`)

Plan price change keeps historical invoices; adjustments (credit, debit, CREDITED state); validation error fields; aging reconciles to outstanding; overdue filters; suspension threshold, suspension, qualifying payment, reconnection fee and completion; subscribers never deleted; global search by account, name, invoice, receipt and GCash reference; all 16 reports build and PDF/XLSX/CSV exports are valid files; dashboard KPIs equal the receivables summary.

## 6. End-to-end demo sequence (`tests/e2e`)

Sandbox check (no Node.js in the renderer) → wrong password → admin: dashboard, subscribers, profile, ledger, Statement of Account, billing, invoice, overdue, aging, suspension candidates → GCash duplicate blocked and a clean proof verified → batch remitted 500.00 short, reconciled with reason and closed → reports run and exported to PDF and XLSX → audit log → cashier: lands on Receive Payment, partial payment with allocation preview, receipt printed and saved as PDF, admin operations refused by the server → owner: reversal, session lock, backup, verify, integrity check, role matrix.

Screenshots are written to `tests/screenshots/`.

## 7. Entry and exit criteria

* **Entry:** `npm run typecheck` and `npm run lint` report no errors.
* **Exit:** all unit, acceptance and end-to-end tests pass; the integrity check passes on the demo database; `tests/acceptance-test-report.pdf` is regenerated from that run.

## 8. How to run

```
npm run db:start
npm test
npm run db:reset -- --yes
npm run build -w @bcis/desktop
npm run test:e2e
npm run test:report
```
