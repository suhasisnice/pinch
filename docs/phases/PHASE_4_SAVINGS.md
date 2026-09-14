# Phase 4 — Savings

No document existed for this phase (`PRODUCT_SPEC.md` §14 requires one; the
audit flagged its absence). Written now, scoped from `PRODUCT_SPEC.md` §3
("Savings — What do I want to eventually afford, and what can I
realistically save?"), `SPOTIFY_FINANCE_UI_PROMPT.md`'s Savings section, and
what already existed in `GoalsScreen`/`src/db/repos/goals.ts` before this
phase — which turned out to be most of it.

## Objective

Answer: **what do I want to eventually afford, and what can I realistically
save toward it?**

## Read first

- `PRODUCT_SPEC.md` §3, §4.3 (Allocation), §6
- `PHASE_1_FINANCIAL_ENGINE.md`

## What already existed (KEEP, per the audit)

`Goals` + `GoalContributions` — an append-only, signed-amount ledger summed
on read, so `savedAmount` cannot drift from the entries that produced it
(the exact pattern `OutingReserves` was later built to mirror in Phase 1).
Contributions never write a `Transaction`: the money hasn't moved, it's
merely spoken for, which is `PRODUCT_SPEC.md` §4.3's Allocation definition
exactly. `goalReserve`/`cappedGoalReserve` (`math/budget.ts`) already
compute "how much of this period's money a goal claims," with a ceiling
(`MAX_GOAL_RESERVE_SHARE = 0.5`) so an ambitious goal can't claim more than
half of what's actually coming in. `GoalsScreen` already had creation,
progress, contribution/withdrawal, editing, archiving, deletion, and
round-up routing. This phase did not rebuild any of it.

## What this phase added

- **Tab and screen title renamed** from "Goals" to "Savings"
  (`PRODUCT_SPEC.md` §2's actual tab name) — the route name (`Goals` in
  `TabParamList`) stays, since nothing besides the label needed to change
  and renaming a route is a larger, unrelated refactor for zero user-visible
  difference.
- **`goalTrackingStatus`**: ON_TRACK / BEHIND, for a goal with a deadline —
  compares saved-so-far as a fraction of target against elapsed time as a
  fraction of the deadline, with a small slack so a goal funded in lump
  sums (allowance day, not daily) doesn't flip BEHIND for not being
  perfectly linear. Deliberately not based on a historical contribution
  rate — that needs a `GoalContributions` query per goal for a status this
  one subtraction already gets right, and "saved 40% of the target 40% of
  the way to the deadline" is on-pace by definition regardless of how the
  40% arrived.
- **`estimatedCompletionDate`**: for a goal with *no* deadline, projects a
  finish date from the saving rate so far (`savedAmount / daysSinceCreated`).
  Null when nothing has been saved yet — there is no rate to project from.
  This is the UI prompt's "Jul 2027" in its own goal-row example, for the
  case that example doesn't cover (a goal that never had a deadline to just
  echo back).
- Both wired into `GoalCard`: an "ON TRACK"/"BEHIND SCHEDULE" label next to
  the percentage, and the projected month/year appended to the existing
  per-day pace line for a goal without a deadline.

## Explicitly out of scope / deferred

- **A dedicated "what can I realistically save" figure independent of any
  goal.** The spec's question has two halves — what to afford (per-goal,
  already built) and what's realistically saveable (a property of the
  *budget*, not any one goal). `getSpendingHistorySummary` in
  `budgetService.ts` already answers a version of this (recurring costs,
  top categories, over a 90-day window) for the "set a new budget" flow
  (`FreshStartSheet`) but is not surfaced on the Savings screen itself.
  Wiring it in is a real, separate UI decision — where does a "you can
  realistically save about ₹X/month" line sit relative to the goal list —
  not a natural extension of the tracking-status work above.
- **A dedicated "Total saved" hero number** across every goal (the UI
  prompt's "prioritize: total saved"). `GoalsScreen` shows total *reserved*
  (held back from spending), which is a materially different number from
  total saved (`Σ savedAmount`) once a goal is complete and its money is no
  longer "reserved" in the budget sense but is still, in the ordinary sense,
  saved. Both are real numbers; showing only one without deciding how they
  relate on screen would be worse than showing neither for now.
- Goal-creation as "a focused guided flow" (the UI prompt's phrasing) beyond
  the existing single-sheet form — no multi-step wizard was built; the
  existing sheet (name, amount, days, icon) already asks for everything
  needed in one pass and adding steps for their own sake isn't a real
  improvement.

## Acceptance tests

- A goal with a deadline and saved-share ≥ elapsed-share (within 5%) shows
  ON TRACK; further behind shows BEHIND SCHEDULE.
- A goal with no deadline and at least one contribution shows a projected
  completion month; one with zero saved shows no projection rather than a
  divide-by-zero artifact.
- A completed goal shows neither label (there's nothing left to be on track
  toward).
- The Savings tab and screen title read "Savings"; the underlying route and
  every existing Goals repo/test path is unchanged.
- `npm test` and `npm run typecheck` stay green.
