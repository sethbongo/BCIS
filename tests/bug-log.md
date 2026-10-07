# Defect Log

Defects found during development, with root cause, fix and the test that now guards against a repeat.

| # | Found by | Severity | Status |
|---|---|---|---|
| BUG-01 | Desktop end-to-end test | Critical | Fixed |
| BUG-02 | Design review of lock order | High | Fixed |
| BUG-03 | Inspection of seeded data | Medium | Fixed |
| BUG-04 | Desktop end-to-end test | Medium | Fixed |
| BUG-05 | First end-to-end run | Low (tooling) | Fixed |
| BUG-06 | Lint | Low | Fixed |
| BUG-07 | Unit test run | Low (test defect) | Fixed |

---

## BUG-01 — Application went blank immediately after sign-in

* **Symptom:** After a successful login the window was empty; the console showed `TypeError: destroy_ is not a function`.
* **Root cause:** `Shell.tsx` had `useEffect(() => mainRef.current?.scrollTo(0, 0), [location.pathname])`. In the Chromium version shipped with Electron 44, `Element.scrollTo()` returns a Promise. The arrow function returned that Promise, and React treats a returned value as the effect's cleanup function, then failed when it tried to call it on the next navigation.
* **How it was located:** instrumented the unminified bundle to print the effect whose cleanup was not a function.
* **Fix:** the effect now has a block body and returns nothing; all other single-expression effects were converted to block bodies as well.
* **Regression test:** every end-to-end test signs in and asserts the navigation is visible (`signIn()` in `tests/e2e/desktop.spec.ts`).

## BUG-02 — Possible deadlock when two PCs bill the same subscriber at once

* **Symptom:** none observed; found by reviewing the lock order before concurrency testing.
* **Root cause:** inserting an invoice takes a shared key lock on the subscriber row (foreign key), and finalizing then upgraded it to an exclusive `FOR UPDATE` lock. Two transactions for the same subscriber could each hold the shared lock and wait for the other, which PostgreSQL resolves by aborting one.
* **Fix:** `insertDraft()` takes the exclusive subscriber lock **before** inserting the invoice, giving one global order: subscriber → invoices → number sequence.
* **Regression test:** AT-09 generates the same billing period from two clients concurrently while payments are being posted, and requires every request to succeed.

## BUG-03 — Demo data contained no collector shortage

* **Symptom:** the seeded batches were all "Balanced"; the shortage scenario intended for the demo was missing.
* **Root cause:** in the seed, both the collection area and the payment channel were derived from `i % 3`, so every subscriber who pays through a collector was in the same area. Batches in the other areas collected nothing, and "cash − 500, floor 0" produced a remittance of 0 against a collection of 0.
* **Fix:** the payment channel is derived from `floor(i / 3) % 3`, independent of the area.
* **Verification:** the seed's closed batches now include one SHORTAGE and one OVERAGE (visible in the *Collector Remittance & Shortage/Overage* sample report); the seed ends with the integrity check.

## BUG-04 — Next user landed on the previous user's screen

* **Symptom:** an administrator signed out while on Administration; the cashier who signed in next saw "You do not have access to this screen".
* **Root cause:** the route (URL hash) survived sign-out, and the home screen was chosen as the first permitted menu item, which for a cashier was the subscriber list.
* **Fix:** every sign-in resets the route to the user's home screen, and users without the dashboard who can receive payments start on Receive Payment.
* **Regression test:** the cashier end-to-end test signs in right after an administrator session that ended on Administration and asserts the Receive Payment heading and the absence of admin menu items.

## BUG-05 — Electron exited at once when started from the editor terminal

* **Symptom:** `electron.exe: bad option: --remote-debugging-port=0`, exit code 9.
* **Root cause:** the editor's extension host exports `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as plain Node.js.
* **Fix:** the end-to-end launcher, the documentation builder and `scripts/electron-vite.mjs` (used by `npm run dev`) remove that variable before starting Electron.

## BUG-06 — Invisible byte-order-mark character in source files

* **Symptom:** ESLint `no-irregular-whitespace` in the CSV writers.
* **Root cause:** the UTF-8 byte-order mark needed at the start of CSV files had been typed as a literal invisible character inside a template string.
* **Fix:** `String.fromCharCode(0xfeff)` so the intent is visible and reviewable.
* **Regression test:** `npm run lint`; the CSV content is asserted in `workflows.test.ts`.

## BUG-07 — Wrong expected total in a unit test

* **Symptom:** the aging unit test failed on its first run: expected 444,500, received 444,600.
* **Root cause:** the expected value in the test was added up incorrectly by hand; the code was right (99,900 + 49,900 + 99,900 + 65,000 + 129,900 = 444,600).
* **Fix:** corrected the expected constants, and the test now also asserts that the bucket total equals the sum of the input balances, so the check no longer depends on a hand-computed number alone.
