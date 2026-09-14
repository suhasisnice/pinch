*(Original phase document below the `---`. This section records what shipped.)*

## What shipped

Most of the hard part — the reserve ledger itself — was already built and
tested in Phase 1 (`OutingReserves`, `reserveForOuting`/`releaseOutingReserve`,
`getTotalOutingReserved` feeding `protectedMoney`) with zero UI ever reading
or writing it. This phase is almost entirely that wiring:

- **Reserve/release UI** in the outing detail sheet — a plain amount field
  and two buttons. Reserving never writes a `Transaction` (the existing
  repo function's own guarantee, matching `contributeToGoal`'s reasoning);
  the sheet tracks its own `reserved` state via `getOutingReserved`, refetched
  alongside transactions/candidates/IOUs, because the `OutingSummary` object
  the list handed the sheet does not itself get refetched while the sheet
  stays open across a reserve action.
- **Planned / Reserved / Spent shown as three separate numbers**, per
  `PRODUCT_SPEC.md`'s explicit "do not collapse these into one number" —
  the detail sheet previously only ever showed `totalSpent`.
- **`outingAffordability`**: Comfortable/Tight/Disruptive, shown live while
  typing a budget cap when creating an outing. Advisory only — nothing it
  returns blocks `reserveForOuting` from running, per the spec's own "must
  not block creation." Deliberately the same shape as `canIAfford`'s
  severity ladder: reserving for an outing and one impulse purchase are the
  same underlying question ("how much does this change my daily number?"),
  so they use the same thresholds rather than two unrelated mental models.
- **Close/delete confirmations now say where the reserve goes.** Closing an
  outing already stops its reserve counting toward `protectedMoney` —
  `getTotalOutingReserved` only sums outings with `closed_at IS NULL` — so
  "release the remaining reserve" needed no new code, only telling the user
  it happened instead of letting their available budget change for an
  unstated reason. Deleting cascades the `OutingReserves` rows (existing FK,
  `ON DELETE CASCADE`), which has the same effect.

### Explicitly out of scope / deferred

- **A funding-strategy choice (Fixed/Flexible/Manual/Hybrid).** The reserve
  primitive underneath any of these exists; which strategy auto-reserves
  how much and when is real decision logic (e.g. "top up from spare budget
  automatically" needs its own explicit opt-in per §"Spare budget must never
  be automatically moved unless the user explicitly enables the rule") that
  deserves to be built and tested on its own, not folded into wiring up the
  ledger's UI.
- **An explicit buffer field.** The spec's `funding target = planned +
  buffer` implies a second amount alongside the budget cap. No column was
  added for it — `budgetAmount` alone is used as the funding target. Adding
  a real buffer means a schema change for a number nothing yet reads
  differently from padding the cap itself.
- **A three-way choice on completion** ("return to budget / move to
  savings / move to another outing"). What ships is the first option,
  automatically, with the amount stated. Moving the remainder to a specific
  goal instead is reachable manually (release the reserve, then contribute
  to a goal) but has no guided one-tap flow — building the picker-on-close
  UI is a real, separate piece of work.
- **Historical learning of planned-vs-actual** (the spec's own "do not
  implement predictive ML" caveat covers the harder version, but even
  storing per-outing accuracy for Insights to read later wasn't started).
- Groups/participants beyond the existing per-person IOU model — unchanged
  from before this phase; see Phase 6.

## Acceptance tests

All from the original document below, plus:

- Reserving money for an outing increases `getOutingReserved(id)` and
  `getTotalOutingReserved()` without creating a `Transaction` row.
- Releasing more than is reserved does not go negative in the UI (`Release`
  is disabled once `reserved <= 0`, and the amount released is capped to
  what remains).
- Closing an outing with an open reserve removes it from
  `getTotalOutingReserved()` (verified already in
  `tests/financialEngine.test.ts`); the close confirmation names the amount
  when non-zero.
- `outingAffordability` never throws regardless of how far the target
  exceeds what's available — it classifies, it does not block.
- `npm test` and `npm run typecheck` stay green.

---

# Phase 5 — Outings *(original)*

## Objective

Build Outings as a hybrid occasion-fund system.

Core idea:

**An Outing is a temporary financial plan for a future occasion.**

It connects planned spending → reserved money → actual transactions → optional participants → shared expenses → planned vs actual.

## Read first

- `PRODUCT_SPEC.md`
- `PHASE_3_TODAY.md`
- `PHASE_4_SAVINGS.md`

## What qualifies as an outing

- Movie
- Dinner
- Birthday
- Date
- College event
- Shopping
- Party
- Trip
- Custom occasion

## Main screen

Header can show:

- total reserved for active outings
- total planned upcoming spending

Then upcoming outing rows/cards with:

- name
- date/date range
- planned amount
- reserved amount
- status

Avoid mini dashboards inside every card.

## Create outing

Flow:

1. Occasion/name
2. Date or date range
3. Estimated budget
4. Optional budget breakdown
5. Optional buffer
6. Funding strategy
7. Optional participants

## Budget estimate

Support:

- enter total
- build estimate from categories

Suggested categories:

- transport
- food
- tickets
- accommodation
- activities
- gifts
- shopping
- miscellaneous

Suggestions are editable, never mandatory.

## Funding target

`Funding target = planned amount + optional buffer`

## Funding strategies

- Fixed
- Flexible
- Manual
- Hybrid

Allow optional spare-budget funding.

Spare budget must never be automatically moved unless the user explicitly enables the rule.

## Affordability state

Show:

- Comfortable
- Tight
- Disruptive

The app must not block creation.

## Detail page

Show:

- title/date
- planned amount
- buffer
- funding target
- reserved
- actual spending
- amount still needed
- plan items
- actual spending
- participants
- activity/history

## Reserved vs spent

These are separate concepts.

Example:

Planned ₹1,500
Reserved ₹1,700
Spent ₹1,420

Do not collapse these into one number.

## Automatic transaction linking

When a new transaction could plausibly belong to an active outing, propose a lightweight confirmation:

`₹750 at Restaurant`

`Part of Rahul's Birthday?`

- Yes
- No
- Other

The canonical transaction is linked; it is never duplicated.

## Participants

Participants are optional and local.

Users can select from device contacts or recent people.

No participant account is required.

## Shared spending

Outings may contain shared expenses.

Those expenses feed into Split/Obligations.

## Completion

At completion show:

- planned vs actual
- reserved vs spent
- leftover reserve

Offer:

- return to budget
- move to savings
- move to another outing

## Cancellation

Same idea: release remaining reserve and let the user choose where it goes.

## Historical learning

Store planned vs actual so Insights can later identify recurring estimation patterns.

Do not implement advanced predictive ML in this phase.

## Acceptance tests

- Create a movie outing with ₹1,200 target.
- Reserve money without changing bank cash.
- Verify available budget decreases by the reserved amount.
- Attach a real transaction and verify it appears once.
- Verify an outing expense already funded does not subtract from general spending twice.
- Complete outing and correctly handle leftover reserve.
- Cancel outing and release unused reserve.
- Add participants from contacts.
- Shared expense correctly creates obligations without duplicating the transaction.
- Trip with a date range behaves correctly.

## Out of scope

- live group syncing
- social messaging
- travel booking
- external price lookup
- requiring friends to install the app
