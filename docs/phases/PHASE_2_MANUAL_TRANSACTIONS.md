# Phase 2 — Manual Transactions

*(Original phase document below the `---`. This section records what actually
shipped, the decisions made getting there, and where it differs from or adds
to the original scope.)*

## What shipped

All seven types are now creatable directly from one Add flow
(`AddExpenseSheet`, extended rather than replaced): **Expense, Income,
Transfer, Loan given, Loan received, Refund, Adjustment.**

### Data model

- **`is_adjustment`** (migration v11): a plain `INTEGER NOT NULL DEFAULT 0`
  column on `Transactions`, unconstrained — following the precedent v10's own
  comment sets out ("every prior `ADD COLUMN` in this file is unconstrained")
  and the reasoning v5's comment gives for *not* touching `kind`'s `CHECK`
  constraint ("would mean rebuilding the whole Transactions table"). An
  adjustment is not a new `kind` — a debit adjustment still counts as
  `SPEND` and a credit adjustment still counts as `INCOME` for every budget
  and insights query exactly as the spec wants ("I forgot to log ₹200 cash
  spending" should reduce Safe-to-Spend like any other expense) — `is_adjustment`
  only changes how it is *labelled*, never how it is *summed*. Every existing
  `kind = 'SPEND'`/`kind = 'INCOME'` query in `transactions.ts` therefore
  needed no changes at all.
- **Transfer**: still no `Accounts` table (out of scope — `PRODUCT_SPEC.md`
  doesn't require one for V1). A manual transfer creates two ordinary
  `Transactions` rows — a `SPEND`-kind debit labelled with the destination,
  an `INCOME`-kind credit labelled with the source — and links them with the
  **existing** `markTransferPair`, exactly the mechanism auto-detected
  transfers already use. Every spend/income/category/insights query already
  filters `transfer_pair_id IS NULL` (verified across all of them before
  writing this), so a manual transfer is correctly invisible to the budget
  the moment it's linked — no query needed to change.
- **Loan given / Loan received**: no new schema. Creates the `Transaction`
  (`SPEND`+`DEBIT` for given, `INCOME`+`CREDIT` for received) then an `IOU`
  against it — the same two steps `MarkAsLoanSheet` already performs on an
  *existing* row, now available up front as one guided flow
  (`postLoan` in `captureService.ts`) instead of a two-step retrofit.
  `MarkAsLoanSheet` itself is untouched — retrofitting a loan onto a payment
  already logged as a plain expense is still a real, separate need.
- **Refund**: no new schema — `kind: 'REFUND'` already existed and was
  already netted against `SPEND` within a window by every query that reads
  `grossSpend`. The only gap was that nothing in the UI could *create* one
  manually; `postTransaction`'s existing `kind` override was already enough.

### A real gap found and fixed: deleting a transfer leg orphaned its pair

`transfer_pair_id` is a bare `INTEGER` column with no foreign key — nothing
enforced by SQLite stops it pointing at a row that no longer exists.
`deleteTransaction` previously did a bare `DELETE`, so deleting one leg of a
transfer (self-transfer or a round trip) left the other leg's
`transfer_pair_id` dangling: still set, pointing at nothing.
`getTransfers()` would then return a row with no partner, and worse, that
row's own exclusion from spend (`transfer_pair_id IS NULL` in every budget
query) would *silently persist correctly* while nothing referenced it — a
transaction that reads as "part of a transfer" forever, with the transfer
gone. Fixed by having `deleteTransaction` call the **existing**
`unmarkTransfer` first (it already does exactly this symmetric-null
operation, used elsewhere for the undo-a-detected-transfer flow) — a one-line
fix reusing code that already existed for a different caller. This satisfies
the original phase document's "Deletion must not leave orphaned obligations
or allocations" for the one real orphan risk found; the others
(`IOUs.transaction_id ON DELETE CASCADE`, `Settlements`/`GoalContributions
.transaction_id ON DELETE SET NULL`) were already correctly handled at the
schema level.

### UI

- `AddExpenseSheet` gained a type selector (7 chips) up front. Fields shown
  change per type: Expense/Income keep the exact fields they always had;
  Transfer asks for two free-text account labels; Loan given/received reuse
  `ContactPicker` and a reason field, matching `MarkAsLoanSheet`'s existing
  pattern; Refund asks for the amount and who refunded it; Adjustment asks
  for a direction (added/removed) and what is being corrected.
- `TransactionDetailSheet` gained a human-readable kind label (e.g.
  "Repayment received", "Refund", "Adjustment") next to the category/date
  line, and hides the Split/"I lent this" actions on a transfer leg
  (`transfer_pair_id !== null`) — splitting or lending your own transfer
  between accounts was always a no-op that happened to be reachable.

### Explicitly out of scope / deferred

- **Refund → original-expense linking.** `PRODUCT_SPEC.md` Rule H says a
  refund "should link to the original expense where possible." No structural
  link column was added — the original phase document's own acceptance tests
  don't exercise linking, and adding one means deciding how a refund finds
  its candidate original (fuzzy match on merchant + amount + recency, or a
  manual picker), which is real design work belonging with Phase 7's
  refund-matching requirement, not a two-line addition here. A refund today
  nets against `grossSpend` correctly; it just isn't shown attached to a
  specific prior row.
- **Free-form kind/direction editing in the UI.** `updateTransaction` has
  supported changing `kind`/`direction` at the repo level since before this
  phase, but no screen has ever exposed it, and this phase does not start
  now — "dangerous type conversions must preserve ledger integrity" is
  satisfied here by *not offering* the dangerous conversion (changing kind
  or direction on a row that might carry an open IOU, a transfer pairing, or
  outing linkage) rather than building the reconciliation logic a safe
  in-place conversion would need. The one reclassification this phase does
  add (loan/refund/adjustment as *creation-time* choices) sidesteps this
  because it composes the same two calls (`addTransaction` + `createIOU`)
  the retrofit flow already made, rather than mutating an existing row's
  meaning after other tables have referenced it.
- **A dedicated "undo" gesture.** The original document's acceptance
  criterion is "Delete/undo without corrupting related records," which the
  orphan-cleanup fix above satisfies for the corruption half. A snackbar/toast
  primitive doesn't exist anywhere in `ui.tsx`, and building one to give
  "undo" its own affordance (rather than "open the transaction you just
  added and delete it," already fully reachable) is UI-kit scope closer to
  Phase 0/10 than this phase's data-model focus.
- **Investment contribution, Withdrawal, Fee** — named in `PRODUCT_SPEC.md`
  §1.3's full type list but not in this phase document's own "User can
  create" list. Left for whichever phase actually needs them (Investments
  has no phase document yet, per the audit).

## Acceptance tests

All from the original document below, plus:

8. Deleting either leg of a linked transfer clears `transfer_pair_id` on the
   other leg rather than leaving it dangling.
9. A manual Transfer's two legs never appear in `getGrossSpendBetween`,
   `getIncomeBetween`, `getSpendByCategory`, or `getMonthlySpend` for the
   window they occurred in.
10. A debit Adjustment counts toward `getGrossSpendBetween` and
    `getSpendByCategory` like any other `SPEND`; a credit Adjustment counts
    toward `getIncomeBetween` like any other `INCOME`. Only its
    `is_adjustment` flag distinguishes it.
11. Loan given creates exactly one `Transaction` and one `IOU`
    (`THEY_OWE_ME`) in a single flow, with no intermediate row.
12. `npm test` and `npm run typecheck` stay green.

---

# Phase 2 — Manual Transactions *(original)*

## Objective

Create a complete manual transaction workflow before automatic ingestion.

If manual transaction accounting is not correct, do not proceed to automatic ingestion.

## Read first

- `PRODUCT_SPEC.md`
- `PHASE_1_FINANCIAL_ENGINE.md`

## User capabilities

User can create:

- Expense
- Income
- Transfer
- Loan given
- Loan received
- Refund
- Adjustment

The UI may use a compact Add sheet rather than exposing accounting terminology everywhere.

## Add flow

Tap `+ Add`.

Choose transaction type.

Enter:

- amount
- description/merchant
- date/time
- account
- category where applicable
- counterparty where applicable
- optional note

## Editing

Users can:

- edit amount
- edit category
- edit merchant
- edit date
- change type where valid
- attach/detach outing
- attach shared-expense context
- add note

Dangerous type conversions must preserve ledger integrity.

## Undo/delete

Support undo for accidental entry.

Deletion must not leave orphaned obligations or allocations.

If historical deletion is supported, require a confirmation and handle all references.

## Transaction detail

Should show:

- amount
- merchant/description
- time/date
- category
- account
- type/status
- linked outing if any
- shared-expense info if any
- source
- edit action

## Acceptance tests

1. Add a normal expense and verify budget/ledger updates.
2. Add income and verify bank/available-money calculations.
3. Add a self-transfer and verify it does not count as spending.
4. Add a loan and verify it becomes an obligation.
5. Add repayment and verify obligation closes.
6. Create a shared restaurant transaction and split it; verify only the personal share counts as expense.
7. Edit category without creating a second transaction.
8. Delete/undo without corrupting related records.
9. Restart app and verify data persists.

## Out of scope

- automatic parsing
- automatic merchant learning
- notification listener
- advanced reconciliation
