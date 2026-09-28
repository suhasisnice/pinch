# Fix queue

Fixes waiting to be batched into one build. The user asked (2026-09-24) to let them queue up
rather than ship one at a time. Tick them off as they land and note the version.

- [x] **"Set aside" looks high next to "saved."** *Fixed in 0.9.21. There was a real double count: an open
      outing's reserve stayed at full size after money was spent on it, so that spending was charged
      twice (`getTotalOutingReserved` now subtracts it). There was also a labelling problem: the goals line
      mixed money saved with money only held back to keep goals on pace. It is now two lines in "Where
      this number comes from".* `protectedMoney` on Today (0.9.14 onwards) reads
      larger than the amount saved toward goals. Check what it adds up (goal reserve, outing
      reserves, plan/SIP reserve, cushion). It may be a real double count, or it may only need a
      clearer label. First flagged in the 0.9.14 pass.

- [ ] **Months verdict can contradict itself.** Found 2026-09-29 in the 0.9.25 polish pass.
      `compareMonths` (`src/math/insights.ts`) divides by *active* days, meaning days that had any
      spending. It then projects the month as pace × 30. A month with quiet days therefore reads
      "slower than usual" and "heading for" a total above every past month, both at once. Seed data
      shows it: Sep ₹10,190 so far, "59% slower than usual, heading for ₹17,982". Proposed fix: pace
      per *elapsed calendar day* (days in the month so far; a past month counts all its days), and
      project on that. Real UPI users with near-daily spending see this much less. Needs the test
      "compares per active day" in `tests/insightsHistory.test.ts` rewritten, so ask first.

## Built but never shown (scan of 2026-09-29, to discuss)

These are backend features that no screen reaches. The scan script is `orphans.js` in the session
scratchpad: an export counts as "shown" if a screen, component or navigator uses it, directly or
through live backend code. 88 exports came up. Most are tuning constants or helpers only tests use,
and those are fine. These are the ones that matter:

- [ ] **Settle-up reminders never fire.** Settings has a working toggle (`settleRemindersEnabled`), and
      `planSettleReminder` in `notifications/engine.ts` is built and tested, but nothing ever calls it.
      The switch does nothing.
- [ ] **A wrong self-transfer can't be undone.** Transfers are paired automatically, and the detail
      sheet shows "Transfer". `unmarkTransfer` exists but only tests use it. A mis-paired UPI payment
      disappears from spending, and the user can't bring it back.
- [ ] **Learned payee aliases are invisible.** Capture learns aliases (`addContactAlias`, in
      `captureService.ts:943`), but there is no screen to see or remove them (`getContactAliases`),
      so a bad alias keeps mis-attributing payments.
- [ ] **No "try again" for a rejected message.** `reprocessRawEvent` re-runs the parser on stored
      evidence, but no screen offers it. Settings' "revalidate history" covers some of this.
- [ ] **Bank balance history is kept but never drawn.** `getBalanceHistory` and
      `getLatestBalanceSnapshot` are unused; Today and Wealth read `getBalanceState` only.
- [ ] **Outing reserve history** (`getReserveHistory`): stored, never shown.
- [ ] **Split "exact amounts" suggestion** (`suggestExactAmounts`): built and tested, and SplitModal
      doesn't use it.
- [ ] **Budget preview during onboarding** (`budgetPreview`): built and tested, never shown.
- [ ] **Date presets for the transaction filter** (`resolveDateRange`): built and tested, and
      Transactions has no date filter.
- [ ] **Probably dead code (remove after a check):**
  - the pre-0.9.21 categoriser (`categoriseMerchant`, `smartCategoriseMerchant`,
    `getCategoryTokenWeights`)
  - `findTransfers` (not even tested)
  - `findStaleCaptures`
  - `updateBudgetPeriod`
  - `setTransactionStatus`
  - `getIOUById`, `getContactById`, `getOutingById`

## Redesigns (need the user's input first)

Before building either one, ask the user what they want (MCQ with mock-ups). Don't design them blind.

- [x] **Redesign the cushion.** *Built in 0.9.21 (`CushionFloor`, on Today's balance row and Wealth rung 1).* *Decided 2026-09-24: a "floor" under the bank balance: spendable
      above the line, the cushion below it (`₹6,300 / 13,500`), so cushion money stops reading as
      spendable.* Originally: The emergency-cushion goal (`getCushionGoalId`, the payday plan's
      CUSHION slice) and how it is presented.
- [x] **Redesign the savings bar.** *Built in 0.9.21 (`ProgressBar` `marker`, `goalPace`).* *Decided 2026-09-24: a slightly thicker bar with a pace tick
      showing where you should be today. When you are behind, the gap shows in the warning colour,
      with a line like "₹2,000 behind · ₹4,500/mo gets you there by Mar".* Originally: How savings progress is drawn (the goal jars and progress bars
      on Plans and Savings), using the user's input.

## Features

- [x] **Biometrics to see the bank balance.** *Built in 0.9.21 (`security/MoneyReveal.tsx`).* Hide the balance by default and reveal it with a
      fingerprint or face unlock. This is separate from the whole-app lock added in 0.9.17
      (`LockGate`), so reuse its biometric code. Things to decide with the user: which figures
      are hidden (only the bank balance, or net worth too), and how long a reveal lasts.
      *Decided 2026-09-24: hide the bank balance and net worth, and keep them revealed until the app
      goes to the background.*
