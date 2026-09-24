# Weekly recap

Shipped in 0.9.11. Not visually verified (no emulator) — check on the phone.

Last Monday–Sunday as full-screen slides, one number each. Opened from the
"Your week, in a minute" row at the top of Insights, which only appears when
last week had spending. Swipe, or tap the right side for next and the left
third for back; a segmented bar at the top shows how many slides there are.

## Rules

- **Real numbers only.** Every figure is a sum over real transactions. No
  scores, no personality labels, no "you're a Foodie".
- **Yours, not paid.** Other people's share of bills you fronted is taken off
  (`getSpendsWithShare`), and the first slide says how much that was.
- **Skip, don't pad.** A slide that has nothing true to say is left out.

| Slide | Shown when |
|---|---|
| You spent ₹X — vs the week before, or the spend count | always |
| Biggest day — weekday, amount, what drove it | spending on 2+ days |
| Most of it went to — category and share | 2+ categories (uncategorised never wins) |
| Your regular — merchant, visits, total | same merchant 3+ times |
| Under ₹limit a day — N of 7, which days went over | a budget is set |
| Spent nothing on — N days, which ones | at least one quiet day |
| This week — ₹limit a day keeps you on track | a budget is set |

Days are the phone's calendar days, not UTC, so a 1am spend belongs to the
night it happened. Logic lives in `src/math/weeklyRecap.ts` (14 tests).

Deliberately the app's own dark canvas and type, not a Wrapped-style burst of
colour: the spec rules out gradients and rainbow palettes, and the numbers
carry it.

Not done: a Monday notification or a Today banner pointing at it. Easy to add
if you want it found without opening Insights.
