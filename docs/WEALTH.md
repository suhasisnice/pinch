# Wealth (0.9.15)

The user asked for "a wealth creation section that allows me to invest money
safely and patiently in the long run". Their answers to the follow-up
questions set the scope:

- **Placement:** its own fourth tab.
- **Features:** safety ladder, holdings tracker, monthly SIP plan. Patience
  guardrails (hiding value, a withdrawal cool-off) were offered and not chosen.
- **Growth:** a value the user types in now and then, plus a long-run
  projection at a rate they choose.
- **Auto-detect:** investment-looking SMS go to Review and are asked about each
  time. They are never auto-logged.

## What Pinch does and does not do

It **cannot buy anything**. Brokerage execution is out of scope
(`PRODUCT_SPEC.md` §13), and the app is offline. The money still goes through
the user's own broker app; Pinch plans it, counts it and keeps it steady.

It **does not pick investments**. "Automated investment recommendations" are
out of scope (§13). The ladder is about order, not products: a cushion before
risk, a habit before size, and time before judgement. The screen says so in
its footer.

It **does not know prices**. A holding's value is whatever the user last typed
in, and before that it is exactly what went in. That value is never guessed.

## Pieces

- **Holdings** (migration v16, `db/repos/holdings.ts`)
  - A holding is a name, a kind, an optional monthly plan (amount plus a day
    from 1 to 28), and an optional typed-in value with its date.
  - Money in and out is still the Phase 9 INVESTMENT transaction, pointed at a
    holding by the new `Transactions.holding_id`. Every existing total keeps
    working.
  - Pre-existing (Phase 9) entries show as "Not in a holding".
- **The ladder** (`math/wealth.ts`)
  1. **Cushion:** an ordinary goal named "Emergency fund", sized at three
     months of allowance and remembered in settings. Because it is a goal, it
     reserves from the budget, accepts round-ups, and can be edited under Plans.
  2. **Habit:** a monthly plan, plus at least 3 calendar months with a
     contribution.
  3. **Time:** 12 months since the first contribution.
  - The ladder is soft. Investing before the cushion is full is allowed, but
    it triggers one amber caution line.
- **Monthly plan (SIP)**
  - The plan's amount is held back from the budget for the period it falls
    in, the same way a goal reserve is (`sipReserve` becomes
    `BudgetInput.planReserve`, which is part of protectedMoney).
  - Logging the contribution moves the money from reserve to invested cash,
    so Today does not move. The decision was made when the plan was set.
- **Projection**
  - Monthly compounding, shown for 5, 10 and 20 years at the chosen rate
    (6/8/10/12%; 10% by default).
  - A cautious 6% line always sits beside it, and the footer says
    "arithmetic, not advice".
- **Suggestion, not detection** (`looksLikeInvestment`)
  - Whole-word matches on platforms (Groww, Zerodha, Kite, …), clearing
    houses and registrars (ICCL, Indian Clearing Corp, CAMS, KFintech) and
    product words (SIP, mutual fund, PPF, NPS, redemption).
  - A match always goes to Review with `CaptureInbox.suggested_reason =
    'INVESTMENT'`, even when the parse is confident and even during a silent
    backfill.
  - Review then offers "Yes, invested" (with holding chips, pre-picked by name
    or by a matching plan amount), "A normal payment" or "Not a payment".
  - `classifyNonSpend` still never tags INVESTMENT. Phase 9's acceptance test
    holds.

## A real budget fix found on the way

Before this change, logging an investment excluded it from spending (correct),
but the money it moved never left the spendable pool either (wrong). The cash
had left the account, so Today overstated what was left, and the
bank-balance check showed a gap of exactly that amount.

`BudgetInput.investedNet` fixes this. It is the net of contributions and
withdrawals in the period, and it leaves the pool the way repaying a friend
does, without counting as spending. The period-end sweep subtracts it as well,
so invested money is not swept into Savings a second time.

## Spec conflicts (stated, not silent)

| Document says | Now | Resolution |
| --- | --- | --- |
| `PRODUCT_SPEC.md` §2: exactly five tabs; `DESIGN_DIRECTION.md` (0.9.14): three | Four: Today / Plans / Wealth / People | The user's explicit choice in this conversation |
| `PHASE_9_INVESTMENTS.md`: "No new route, tab, or screen" | A Wealth tab | Phase 9 scoped itself to the spec as it stood; the user has now asked for the surface |
| `PHASE_9_INVESTMENTS.md` deferred: per-platform breakdown, recurring SIP, auto-detection | Holdings, monthly plans, Review suggestions | Built, since the user asked. Detection only ever suggests. |
| §13: brokerage execution, automated recommendations out of scope | Neither is built | No conflict. Kept out deliberately. |

## Tests

`tests/wealth.test.ts` has 49 tests covering:

- SIP due-date counting across month and year edges
- reserve maths
- the projection
- the ladder rungs
- detection positives and negatives
- the budget identity: paying a planned SIP leaves the pool unchanged, and an
  unplanned investment reduces it
- holdings totals against real SQL
- archived holdings keeping their money in the totals
- Review's three answers

# Pay yourself first, net worth, the habit (0.9.16)

The 0.9.15 tab tracked investments. It did not yet make saving the default,
so 0.9.16 adds the parts the user asked for: a plan for every rupee, a feeling
of progress, one net-worth number, and habit insights for people on an allowance.
Savings follow a plan. Everyday spending only gets nudges; no new alerts were added.

## Pieces

- **Pay yourself first** (`src/math/payday.ts`, settings key `pinch.payPlan`).
  - A split takes a percentage of the allowance for the cushion, goals and investing. The total is capped at 50%.
  - Each period this becomes a payday checklist. An unticked line is held back from the budget as `planReserve`.
  - Ticking a line writes the goal contribution or logs the investment. The pool does not change, so Today does not move.
  - The cushion line is capped at what the cushion still needs. The invest line is never below the SIPs due.
  - With the plan off, the reserve falls back to the 0.9.15 SIP reserve.
- **Net worth** (`src/math/progress.ts`) = bank balance + investment worth + money owed to you − money you owe.
  - Goals are not added, because they are labels on bank money.
  - It is null until a bank balance exists; until then the hero shows "kept for later".
  - Net worth is written once a month to `NetWorthSnapshots` (migration v17), which draws the line.
- **The habit.** Share of income kept (goal contributions + net invested) for each of the last six periods, shown as bars.
  - The streak counts finished periods at 10% or more.
- **Milestones.** Stored in `Milestones` the first time each is reached, so their dates stay fixed. The next one is shown.
- **Small change, big number.**
  - Takes the top discretionary category if its monthly run-rate is at least ₹400.
  - Shows what a quarter of it, kept every month, would become in ten years at the user's chosen rate.

## Behaviour change: goal reserve is per period

Before, a goal held back its all-time savings from every new period. Money saved
in March therefore reduced April's budget again: double counting.

- Now a goal only holds back what was contributed this period (`savedThisPeriod`).
- The period-close sweep dates its automatic contribution into the period that is ending.
- When pay-yourself-first is on, goals are not paced (`paced: false`). The plan does the pacing.
- Tests: `tests/payYourselfFirst.test.ts`.
