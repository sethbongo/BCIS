# Financial rules

Applies to anything under `source/api/src/modules/{billing,payments,gcash,collections,receivables}`, `source/shared/src/domain` and the related screens.

## Money

- Amounts are integer centavos (`number`, `BIGINT` in PostgreSQL). ₱999.00 is `99900`.
- Parse user input only with `parseMoney`; display only with `formatMoney`.
- SQL sums must be cast: `coalesce(sum(x), 0)::bigint`.

## Invariants (the integrity check enforces all of them)

- `invoice.balance = total + adjustments_total - amount_paid`, never negative.
- `invoice.amount_paid` = sum of its non-reversed allocations.
- For a posted payment: `sum(non-reversed allocations) + unapplied_amount = amount`.
- Subscriber ledger balance = open invoice balances − unapplied credit of posted payments.
- Each finalized invoice has exactly one ledger debit; each payment exactly one ledger credit; each reversal one ledger debit.

If a change would break one of these, the change is wrong.

## Posting pattern

```ts
await db.transaction(async (tx) => {
  await lockSubscriber(tx, subscriberId);        // always first
  const open = await lockOpenInvoices(tx, subscriberId);
  // ... compute with a pure function from @bcis/shared ...
  // ... insert rows, updateInvoiceAmounts(), nextNumber(), postLedger() ...
  await audit(tx, actor, { action, entityType, entityId, reason, oldValues, newValues });
});
```

- Lock order: subscriber → invoices → number sequence. Never the other way round.
- Take document numbers (`nextNumber`) as late as possible; the row lock is held until commit.
- Invoice status is only ever set from `deriveInvoiceStatus`.

## Corrections

- Wrong payment → `reversePayment` (keeps the payment, voids the receipt, restores balances, ledger debit).
- Wrong invoice → `voidInvoice` (only when nothing is paid on it) or `createAdjustment`.
- Never add `DELETE` or free-form `UPDATE` paths for posted rows. The triggers in migration `0001` will reject them anyway.

## Policies that are documented and tested — change the tests and docs if you change them

- Allocation: oldest due date first; manual allocation needs `payment.allocate_manual`.
- Advance payment: excess stays as `unapplied_amount` and is applied automatically to newly finalized invoices.
- GCash: proofs are evidence; only `gcash.verify` posts; a reference that backs a posted payment is blocked.
- Billing: one live invoice per service account and period; re-running is a no-op.
- Reconciliation: any shortage or overage needs a recorded reason; closing needs `collection.close`.

## Tests required

- A pure rule → unit test in `source/shared/src/domain/domain.test.ts`.
- A posting flow → acceptance test in `tests/acceptance` asserting invoice balances **and** the ledger closing balance.
