# Interventions (0.9.19)

The user, on 2026-09-24: the app "is more focused towards showing you your
shortcomings … just giving the user data". They want "active interventions
and active reprimands for overspends to actually make a change". Pinch can't
stop a payment. It can respond to one, and it can warn before one.

MCQ answers:
- **Recovery mission**, **pattern callouts + caps**, and **warn before, not after**.
- Not chosen: "make it pay back", i.e. moving an overspend onto the next few days or onto a goal.
- **Tone: savage by default.**

## 1. Recovery mission

The budget engine already absorbs an overspend: the pool shrinks, so every later day's limit drops. That's correct, but you can't see it happen. The mission makes the recovery visible and gives it an end.

- **Start:** when a day closes over its limit, or today goes OVER, a mission starts. It is stored in settings, not in a table, and there is only one at a time.
  - `days` = the smallest N (from 2 to 5, and never past payday) that keeps the daily target at 60% of the normal limit or more.
  - `target` = the normal limit minus the overspend spread across those N days.
- **Today:** the ring's label reads "recovery · day 2 of 3". A line under the quip says "Day 2 of 3 at ₹480. Yesterday: held."
- **Each day is judged at the day's end:**
  - At or under the target: held.
  - Over the target: the day slips, the mission stretches by one day (up to 5 in all), and a callout goes out.
- **End:**
  - Every day held: a moment ("Recovered. Back to ₹650 a day.").
  - Out of days: the mission closes and says so plainly. No streak of shame is kept.
- The maths lives in `src/math/recovery.ts` and is pure and tested. It is not a second budget; the engine's figures stay the truth.

## 2. Pattern callouts and caps

- **Callout:** a merchant or category crosses both of these this week:
  - 3 or more payments, and
  - at least 1.5× its weekly average over the previous 4 weeks, and at least ₹300.
  - Example: "4th Swiggy this week. ₹1,280. That's double your usual."
  - It appears on Today under the week strip and as a notification, at most once per merchant per week.
- **Cap:** one tap sets a weekly cap on that merchant or category (a new `SpendCaps` table, migration v19).
  - Every matching payment is checked: at 80% there's a warning, and past 100% a reprimand.
  - Caps can be listed and removed in Settings. A cap never blocks anything; it only speaks.

## 3. Warn before, not after

- **Risky windows** are learned from the last 8 weeks, in 4 blocks per weekday: morning, afternoon, evening, night.
  - A window is risky if its average spend is at least 1.5× the average block, and at least ₹250.
  - The riskiest one or two are scheduled as local notifications about an hour before the block starts.
  - Example: "Friday nights cost you ₹900 on average. Today's got ₹420 left. Choose violence carefully."
- **Payday:** the day after payday gets a heads-up, because that's when a splurge usually happens.
- Everything is rescheduled on each app open. It is offline, uses local notifications only, and respects quiet hours.

## Tone: savage by default

This overrides the 0.9.14 "witty but kind" rule for reprimands only. Rules:

- Roast the spending, never the person. No comments on body, intelligence, family or worth.
- The number is always in the line.
- Savage lines apply only to reprimands (overspend, a slipped recovery day, a broken cap). Moments and good news stay warm.
- A "Roast me" switch in Settings, on by default, drops back to the firm lines for anyone who wants that. The user chose savage; the switch is the escape hatch a bad week needs.

## Also in 0.9.19: today's spending was counted twice

`getBudgetSnapshot` divided a pool that already had today's spending taken out by the days left, today included, and then subtracted today's spending again. Mid-month, that made "left today" a few percent too low. On the last day of a period it was double: spending ₹100 dropped "left today" by ₹200.

Today's limit is now the one the day started with: `(pool + spentToday) / daysRemaining`. Insights and the weekly recap use the same figure. Covered by `tests/todayLimit.test.ts`.
