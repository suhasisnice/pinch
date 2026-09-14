# Phase 1 — Financial Engine

## Objective

Make the engine match `PRODUCT_SPEC.md` §1.1's four distinct quantities —
bank balance, protected money, available budget, safe-to-spend — instead of
computing only one number (`spendablePool`) with the others folded silently
inside it. Add the two structural pieces the audit (`docs/AUDIT.md`) found
missing: an allocation ledger for Outings (Goals already had one) and a
transaction lifecycle status, so a payment can eventually be `PENDING` or
`FAILED` without corrupting the ledger.

This phase does not touch ingestion, Outings/Goals UI, or Today's screen. It
gives them a foundation to read from.

## Read first

- `PRODUCT_SPEC.md`
- `docs/AUDIT.md` (classification and correctness findings this phase acts on)

## Scope

### 1. Transaction lifecycle

Add `Transactions.status` (`COMPLETED | PENDING | FAILED | REVERSED | REFUNDED`),
defaulting every existing and new row to `COMPLETED` — nothing in the current
parser produces anything else yet (it hard-rejects failed/pending language
outright), so this is additive: the interface exists, behaviour does not
change until Phase 7 starts writing non-`COMPLETED` rows.

The two sums that feed the budget engine (`getGrossSpendBetween`,
`getIncomeBetween`) and the settlement totals (`SETTLE_IN`/`SETTLE_OUT`) are
gated on `status = 'COMPLETED'` now, so Rule I ("a failed payment should not
count as completed spending") holds structurally once Phase 7 can produce a
`FAILED` row, not just because the parser currently throws failed messages
away. Insights/history queries (category breakdown, recurring detection,
monthly totals) are **not** touched in this phase — no non-`COMPLETED` row can
exist yet, so gating them now is unproven surface area for no present benefit.
Whichever phase starts writing `PENDING`/`FAILED` rows (Phase 7) must audit
every remaining aggregate at that point.

No CHECK constraint on the new column — SQLite's `ALTER TABLE ADD COLUMN`
with a CHECK is unproven in this codebase's migration history (every prior
`ADD COLUMN` is unconstrained; see `non_spend_reason`, `excluded_at`), so
validity is enforced in the repo layer, matching how `NonSpendReason` already
works on an unconstrained column.

### 2. Outing reserves

Goals already separate "spoken for" from "spent" via `GoalContributions`, an
append-only ledger summed on read so `savedAmount` cannot drift. Outings had
no equivalent — `budget_amount` was a plan, never a reserve, so Phase 5's
"reserve money without touching cash" had nothing to reserve *into*.

`OutingReserves` mirrors `GoalContributions` exactly: `(outing_id, amount,
source, created_at)`, signed amounts, summed on read. `OutingSummary` gains
`reservedAmount` (from the ledger) and `stillNeeded` (`max(0, budgetAmount −
reservedAmount)`). A closed outing's reserve stops counting toward protected
money — closing already means "done," so nothing further needs an explicit
release action for the total to be correct, even though the ledger rows
themselves are kept (§11: never discard evidence).

Funding strategies (Fixed/Flexible/Manual/Hybrid) and the affordability
verdict (Comfortable/Tight/Disruptive) are Phase 5 screen logic, not built
here — this phase provides only the ledger primitive they will write into and
read from.

### 3. Protected money, available budget, bank balance

`computeBudget` gains `protectedMoney = goalReserve + outingReserve` as an
explicit field, and `availableBudget` as a spec-named alias of the existing
`spendablePool` (identical value — `spendablePool` stays, so nothing that
already reads it breaks). `dailyLimit`'s arithmetic is unchanged.

`bankBalance` is **not** derived from the period ledger. Per §1.1 it is "the
actual reported/observed cash balance" — the app has no bank API, so the only
honest source is what the user has typed into `BalanceSnapshots`
(`getBalanceState().projected`), which already exists and was previously
shown only in its own card, disconnected from the budget. It stays `null`
until the user records a balance at least once; nothing pretends bank balance
equals the period math.

`BudgetSnapshot` (in `budgetService.ts`) now carries `bankBalance`,
`protectedMoney`, and `availableBudget` alongside the existing fields, so
Phase 3's Today screen — whose spec'd hierarchy is bank balance → available
budget → protected → safe-to-spend — has all four numbers to read.

### 4. Balance consistency

Because bank balance and available budget are computed from unrelated
sources (one typed, one derived from the transaction ledger), they can
legitimately disagree — most often because a real payment never made it into
the ledger. `checkBalanceConsistency(bankBalance, availableBudget,
protectedMoney)` returns the gap and whether it exceeds a ₹50 noise
tolerance. This is deliberately the same primitive Phase 7's "missed
transactions" reconciliation needs (`PHASE_7_AUTO_INGESTION.md`: "Expected
balance ₹8,200. User verifies bank and enters ₹7,900... ₹300 unaccounted") —
built once here as pure math, wired into a "Find transaction / Add manually /
Ignore" flow only when Phase 7 or Phase 3 gets to it.

### Explicitly out of scope

- Rewiring Today's screen to display the new fields (Phase 3).
- Outing funding strategies, affordability verdicts, participant math (Phase 5).
- Raw-event retention and the multi-signal dedup matcher (Phase 7) — the
  transaction `status` column is a prerequisite for Phase 7, not a
  replacement for it.
- `sweepExpiredPeriod`'s auto-contribution of a finished period's leftover
  into a "Savings" goal. The audit initially flagged this as a §1.6 violation
  ("should not silently change goals"); re-reading `tests/budgetRollover.test.ts`
  shows it is deliberate, tested behavior that replaced an earlier bug where
  leftover money vanished from every total the app tracked. Left alone.
- Manual-entry transfer/refund/adjustment types (Phase 2).

## Data model changes

```sql
-- v10
CREATE TABLE OutingReserves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outing_id INTEGER NOT NULL REFERENCES Outings(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount <> 0),
  source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'AUTO')),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_outing_reserve ON OutingReserves(outing_id);

ALTER TABLE Transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'COMPLETED';
CREATE INDEX idx_txn_status ON Transactions(status);
```

## Acceptance tests

1. A fresh install and an upgraded install both land on `user_version = 10`
   with every existing transaction reading `status = 'COMPLETED'`.
2. `reserveForOuting` increases `reservedAmount` without creating a
   Transaction row or changing any bank-balance figure.
3. `releaseOutingReserve` (or closing the outing) removes it from
   `getTotalOutingReserved()` while the ledger rows remain queryable.
4. `computeBudget` with `outingReserve` set reduces `availableBudget` by
   exactly that amount and leaves `dailyLimit` numerically identical to the
   pre-Phase-1 formula when `outingReserve = 0` (existing `budget.test.ts`
   assertions pass unmodified).
5. `getBudgetSnapshot` returns `bankBalance: null` when no balance has ever
   been recorded, and the recorded, projected figure once one has.
6. `checkBalanceConsistency` flags a gap larger than the tolerance and clears
   once a transaction is added that closes it.
7. `npm test` and `npm run typecheck` stay green.
