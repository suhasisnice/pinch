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
