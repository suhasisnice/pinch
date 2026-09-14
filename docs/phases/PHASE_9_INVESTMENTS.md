# Phase 9 — Investments

No document existed for this phase (`PRODUCT_SPEC.md` §14 requires one; the
audit flagged its absence, and found nothing implemented). Written now —
and, unlike Phases 4 and 8, only after resolving a real conflict between
`PRODUCT_SPEC.md`'s two halves.

## The conflict, and how it was resolved

`PRODUCT_SPEC.md` §2: *"Bottom navigation has exactly five primary
destinations: Today, Outings, Savings, Split, Insights. No hamburger menu
for core functionality."* Investments is not one of the five, and the spec
does not describe an "Investments" surface anywhere in its body —
`SPOTIFY_FINANCE_UI_PROMPT.md` likewise only ever names those same five
screens. §14, separately, still lists `PHASE_9_INVESTMENTS.md` among the
documents the repository should maintain.

Per `CLAUDE.md`'s own instruction — *"Higher wins on conflict. Never
silently pick a side: state the conflict, follow the higher document, and
report it"* — `PRODUCT_SPEC.md`'s body (a higher authority than its own
appendix-like file list, and certainly higher than an unwritten phase doc)
wins: **there is no sixth screen or tab.** What §1.3 actually asks for is
"Investment contribution" as one of the transaction *meanings* the ledger
must distinguish, in the same list as Transfer, Refund, Fee and Adjustment
— a recognised transaction concept, not a destination. This phase builds
that, and nothing that would require a sixth tab.

## Objective (as scoped by the resolution above)

Let a transaction be recorded as money moving into or out of an
investment, correctly excluded from both spending and income, without
adding new navigation.

## Read first

- `PRODUCT_SPEC.md` §1.3, §2
- `PHASE_2_MANUAL_TRANSACTIONS.md` (Adjustment is the closest precedent —
  a transaction concept added without a new `kind`)

## What shipped

- **`NonSpendReason` gained `'INVESTMENT'`** (`math/classification.ts`),
  alongside the existing `WALLET_TOPUP`/`CARD_BILL`/`CASH_WITHDRAWAL`. A
  contribution (debit) is money moved into something the user still owns
  in a different form — identical reasoning to a wallet top-up. A
  withdrawal (credit) is that same money coming back — identical reasoning
  to why a friend's repayment is not income. `removesFromSpending` returns
  true for it on **both** directions; `getGrossSpendBetween`/
  `getIncomeBetween` already filter on `non_spend_reason IS NULL`
  regardless of which side sets it, so neither query needed to change.
- **Manual-only, deliberately.** `classifyNonSpend` has no pattern that
  could ever recognise an investment platform from SMS text — building a
  keyword list for every broker/fund/SIP is real, separate, and riskier
  work (false positives on an ordinary payment to a company that happens to
  share a name) than this phase's actual ask. `postInvestment`
  (`captureService.ts`) creates the transaction and calls
  `setNonSpendReason` directly, the same two-call composition Phase 2 used
  for loans.
- **A real bug found and fixed while wiring this up.** `classifyNewTransaction`/
  `classifyStoredTransactions` (the sweep that runs on every
  `PARSER_RULES_VERSION` bump and every "Recheck history" tap) reset
  `non_spend_reason` to `NULL` whenever `classifyNonSpend` returned no
  match — which, for `INVESTMENT`, is *always*, since nothing auto-detects
  it. Without a guard, the very first sweep after a manual investment tag
  was set would have silently wiped it back to counting as ordinary
  spending or income. Fixed by short-circuiting the sweep for any row
  already tagged `INVESTMENT`, with a regression test
  (`tests/liveClassification.test.ts`) proving the tag survives a
  reclassification pass on both directions.
- **`getTotalInvested()`**: contributions minus withdrawals, net, across
  every platform. Explicitly not a valuation — the app has no market data
  and V1 is offline-first by `PRODUCT_SPEC.md` §1.5, so this is "how much
  you've put in and not taken back," never "what it's worth today." Shown
  on the Savings screen (not a new tab) as "Invested so far," visible only
  once it's non-zero.
- `AddExpenseSheet` gained two types, "Invest" and "Investment withdrawal,"
  alongside the seven Phase 2 already added.

## Explicitly out of scope / deferred

- **Any valuation, return, or performance tracking.** Needs live market
  data, which is out of scope for V1 by the offline-first requirement
  itself (§1.5) and explicitly named out of scope in §13
  ("Automated investment recommendations"). `getTotalInvested` reports
  contributed capital, full stop.
- **Automatic detection from SMS/notifications.** No regex added to
  `classifyNonSpend` for brokers or funds — see above. A contribution
  today is exactly as automatic as a loan or a transfer was after Phase 2:
  not automatic, entered by hand, and correct once entered.
- **Per-platform breakdown, goal-linked investing** ("investing toward my
  laptop goal"), **or a recurring-SIP concept.** `getTotalInvested` is a
  single net figure. Splitting it by platform, or letting an investment
  contribution *also* count as progress on a savings goal, are both real
  product decisions with their own edge cases (does a withdrawal reduce
  goal progress too?) that deserve to be designed on their own.
- **Fee and Withdrawal as their own distinguished concepts** —
  `PRODUCT_SPEC.md` §1.3 lists these separately from Investment
  contribution. "Investment withdrawal" is built (the mirror of
  contribution); a generic account "Fee" or a non-investment "Withdrawal"
  concept was not, since neither was asked for by name in this phase's own
  resolved scope and Adjustment already covers an ad-hoc correction of
  either kind reasonably well.

## Acceptance tests

- A contribution and a withdrawal each count toward neither
  `getGrossSpendBetween` nor `getIncomeBetween`.
- `getTotalInvested` nets contributions against withdrawals across
  multiple platforms correctly, and is unaffected by an ordinary
  transaction that merely shares a merchant name with a platform but was
  never tagged.
- `classifyNewTransaction` and `classifyStoredTransactions` never clear a
  manually-set `INVESTMENT` tag, on either direction.
- `classifyNonSpend` never auto-detects `INVESTMENT` from any input — it
  is unreachable except by the manual path, confirmed by test.
- No new route, tab, or screen was added.
- `npm test` and `npm run typecheck` stay green.
