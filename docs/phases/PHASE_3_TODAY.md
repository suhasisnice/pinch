*(Original phase document below the `---`. This section records what shipped.)*

## What shipped

Phase 1 (`docs/phases/PHASE_1_FINANCIAL_ENGINE.md`) already computed
`bankBalance`, `availableBudget`, and `protectedMoney` as explicit fields on
`BudgetSnapshot` — none of them were shown anywhere. This phase wires them
into the screen the spec's hierarchy actually describes, without redesigning
what already works (the Safe-to-Spend hero, the affordability tool, the
transaction list).

- **`BudgetBreakdownSheet` gained the missing "Set aside for outings" line.**
  A real completeness gap, not new scope: `protectedMoney` has meant
  `goalReserve + outingReserve` since Phase 1, but the breakdown sheet still
  only listed `goalReserve` — Phase 5's whole reserve mechanic was invisible
  in the one place that already explains every other term in the formula.
- **A new "Available budget" card**, between the (still hidden-by-default)
  bank balance card and the Safe-to-Spend hero — `availableBudget` and, when
  a balance has ever been recorded, `protectedMoney` shown as what it's
  currently holding back. Tapping either opens the existing breakdown sheet
  rather than duplicating its explanation.
- **A period-level budget bar** on that same card: `grossSpend / availableBudget`
  (clamped), distinct from the hero's own bar, which tracks *today's* pace
  against the *daily* limit. The spec lists these as two separate elements
  ("Budget bar" then, later, "Daily/weekly pace") and the existing code only
  had the second one.
- **A balance-consistency note**, using `checkBalanceConsistency` (built in
  Phase 1 specifically for this and for Phase 7's later reconciliation flow):
  when a recorded bank balance disagrees with the ledger by more than the
  ₹50 tolerance, a line explains the gap instead of the two numbers silently
  disagreeing with no acknowledgement.

### A deliberate deviation from the spec's literal wording, flagged rather than silently made

The spec's own example shows bank balance as a plain "Large number" —
always visible. The existing `BalanceCard` hides it behind a tap
("A balance is the one figure on this screen that is nobody else's
business, and phones get glanced at") — a real, considered piece of product
reasoning that predates this phase and that neither spec document
addresses. Rather than pick a side silently, the balance card's position
was moved to be first on the screen (matching the spec's ordering) but its
hide-by-default behaviour was kept. If glanceable-by-default balance turns
out to matter more than the privacy reasoning, that's a product call for
the user to make, not one to resolve by fiat while wiring up numbers that
already existed.

### Explicitly out of scope / deferred

- **A full visual redesign of Today's hierarchy.** The spec's literal
  top-to-bottom order (bank balance → available → protected → bar → safe to
  spend → pace → transactions → add) is now substantially present, but the
  hero card, the "Can I afford it?" tool, and the transaction list keep
  their existing composition — none of it conflicts with the spec, and
  Phase 0/10 own the remaining anti-vibe-coded/card-per-concept audit.
- **Smoothing `dailyLimit` for "spending pace."** The spec asks the
  Safe-to-Spend calculation to account for "relevant spending pace," beyond
  what `availableBudget / daysRemaining` already gives. `avgDailyBurn` and
  the "runs out in N days" projection already exist and are shown; a more
  sophisticated pace-adjusted daily limit is a math-layer change with real
  behavioural consequences (whose Safe-to-Spend number moves and when) that
  deserves its own decision, not a rider on a UI-wiring phase.
- **Visual verification.** Same standing limitation as every UI phase so
  far: no attached device/emulator, no snapshot tests.

## Acceptance tests

All from the original document below, plus:

- `BudgetBreakdownSheet` shows a line for `outingReserve` whenever it is
  non-zero, using the same "held back from X your outings asked for" pattern
  goals already use when the ceiling had to bind (n/a here — outing
  reserves are direct, not capped — so the plain amount is shown).
- The new Available Budget card's `protectedMoney` figure equals
  `snapshot.protectedMoney` exactly (goals + outings), not just the goal
  portion.
- A balance recorded more than ₹50 away from `availableBudget + protectedMoney`
  shows the discrepancy note; a balance within tolerance, or never recorded
  at all, shows neither.
- `npm test` and `npm run typecheck` stay green.

---

# Phase 3 — Today *(original)*

## Objective

Build the primary user experience around one question:

**What can I safely spend right now?**

## Read first

- `PRODUCT_SPEC.md`
- `PHASE_1_FINANCIAL_ENGINE.md`
- `PHASE_2_MANUAL_TRANSACTIONS.md`

## Screen hierarchy

The screen should feel editorial and calm, not like a dense dashboard.

Recommended order:

1. Bank balance
2. Available budget
3. Protected money
4. Budget bar
5. Safe to spend today
6. Daily/weekly pace
7. Today's transactions
8. Add action

## Bank balance

Large number.

Label clearly as:

`Bank balance`

Do not imply the entire bank balance is spendable.

## Available budget

Display large enough to be immediately understood.

Example:

`₹5,720`

`Available budget`

Then show a compact explanation of protected money.

## Protected money

Example:

`₹2,700 protected`

Tap may reveal:

- savings allocations
- outing reserves
- fixed commitments

## Safe to spend today

Primary action metric.

Example:

`₹187`

`Safe to spend today`

If the user has already spent part of it:

`₹92 left today`

## Calculation

Use the budget engine. Do not simply divide bank balance by remaining days.

It should account for:

- available budget
- remaining period
- savings commitments
- outing reserves
- known commitments
- configured buffer
- relevant spending pace

## Transactions

Use a ledger-style list, not a card per transaction.

Example:

`12:42  College Canteen   -₹120`

`Food`

A review-needed transaction can show a subtle status line such as `Needs review`.

## Add action

Use a compact floating pill or bottom action such as `+ Add` rather than a giant floating circle.

## Budget behavior

An expensive day should not necessarily cause a red failure state if the weekly/monthly trajectory remains healthy.

The page should emphasize trajectory.

## Acceptance tests

- User can configure starting bank balance.
- Available budget is always less than or equal to bank balance when the state is valid.
- Protected allocations reduce available budget without reducing bank cash.
- Spending reduces bank cash and the appropriate available pool.
- Outing spending that was already reserved does not subtract from general budget twice.
- Savings allocation affects available budget but not bank balance until an actual cash transfer occurs.
- Today's transactions are shown exactly once.
- App restart preserves state.
- The page remains readable with 100+ transactions.

## Out of scope

- SMS parsing
- notification ingestion
- analytics engine
- investment execution
