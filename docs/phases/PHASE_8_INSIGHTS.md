# Phase 8 — Insights

No document existed for this phase (`PRODUCT_SPEC.md` §14 requires one; the
audit flagged its absence, listing Insights as `UNKNOWN` scope). Written
now, scoped from `PRODUCT_SPEC.md` §3 ("Insights — Where is my money going,
what changed, and what could I realistically improve?"),
`SPOTIFY_FINANCE_UI_PROMPT.md`'s Insights section, and what already existed
in `InsightsScreen`/`math/insights.ts`/`math/insightsSummary.ts` before this
phase — which, like Savings before it, turned out to be most of it.

## Objective

Answer: **where is my money going, what changed, and what could I
realistically improve?**

## Read first

- `PRODUCT_SPEC.md` §3
- `PHASE_1_FINANCIAL_ENGINE.md`

## What already existed (KEEP, per the audit)

`buildFindings` (`math/insightsSummary.ts`) already turns raw figures into
ranked, readable conclusions — "Food is ₹300 a day" rather than a pie chart
left for the reader to interpret — which is exactly the spec's "bold
summary numbers… concise annotations" instruction, and exactly its own
worked example ("**Food spending ↑ ₹420**. Most of the increase came from
4 additional delivery orders."). Week-over-week and month-over-month
comparison, a skew-aware "typical day" figure, recurring-charge detection,
a weekday pattern, and "what you actually bore" (backing out other
people's share of bills you fronted) all existed and are untouched. The
screen already leads with findings and puts the underlying charts below
them as evidence, which is the hierarchy the spec asks for, not a
dashboard-first one.

`TodayScreen`'s existing "Can I afford it?" tool already answers the
spec's "What if...?" question — "what if I spend ₹800" — just on Today
rather than Insights. Nothing was duplicated onto this screen for it.

## What this phase added

**The one concrete UI requirement the spec states outright and the screen
had zero of: a drill-down.** The spec's own example ends every insight
with `**View food spending →**`; before this phase, nothing on the screen
was tappable at all — not a finding, not a category row, nothing navigated
anywhere.

- `Finding` (`math/insightsSummary.ts`) gained an optional `category`
  field, populated by the two finding-builders that are actually about one
  specific category (`top-category`, `biggest-mover`). Other findings
  (`committed`, `skewed`, pace-based ones) correctly have no category —
  there is nothing to drill into for "40% of your spending has no
  category."
- `RootStackParamList`'s `Transactions` route gained an optional
  `{ category?: string }` param. `TransactionsScreen` reads it, applies it
  as an additional filter alongside the existing ALL/OUT/IN/IGNORED chips
  (independent of them, not folded into `Filter`, since a category and a
  debit/credit split are orthogonal), and shows a clearable chip naming
  the active category.
- Both the findings card (a "View X spending →" link, styled and worded
  exactly per the spec's own example) and the category-breakdown rows
  became tappable, navigating to the now-filterable Transactions screen.

## Explicitly out of scope / deferred

- **A dedicated "What if...?" explorer on Insights itself.** Already
  answered by Today's existing affordability tool; building a second one
  here would be the kind of duplicate UI pattern `PRODUCT_SPEC.md` and the
  UI prompt both warn against ("never add a new UI pattern merely because
  the framework makes it easy").
- **Drill-down for month-over-month and weekday-pattern cards.** The spec's
  worked example is specifically about a category finding; extending the
  same tap-to-filter pattern to every other card (a specific month, a
  specific weekday) is a reasonable follow-on, not something the spec's own
  example demonstrates a need for yet.
- **A synthetic what-changed narrative beyond category shifts** — e.g.
  attributing a category's rise to "4 additional delivery orders," the
  exact wording in the spec's own example. `categoryShifts` reports the
  *size* of a shift; naming *what inside it* changed (order count, a new
  merchant, a price change) needs a second, more detailed query per
  category and is real, separate analysis work.
- Screen-level component tests. This codebase has no screen-rendering test
  infrastructure at all (confirmed absent before this phase, not removed
  by it); the new `category` field and navigation logic that can be
  exercised without one (the `Finding` builder) has direct test coverage.

## Acceptance tests

- `buildFindings`' `top-category` and `biggest-mover` findings carry the
  category they are about; every other finding does not.
- `TransactionsScreen` with a `category` route param shows only that
  category's rows, alongside whatever ALL/OUT/IN/IGNORED filter is also
  active; clearing the category chip returns to the unfiltered list.
- `npm test` and `npm run typecheck` stay green.
