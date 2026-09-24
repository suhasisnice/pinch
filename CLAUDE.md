# Pinch — Claude Code working agreement

## Project

Offline-first personal finance app for Indian college students, Android-only.
Expo 57 / React Native 0.86 / React 19 / TypeScript 6 (upgraded from Expo 51
in 0.9.17), `expo-sqlite` with SQLCipher for storage, plus a
custom native module (`modules/pinch-capture`) that captures SMS and
notifications on-device.

This is an **existing app being rehauled**, not a greenfield build. It already
ships working budget, split, goals, outings, insights and automatic-ingestion
code. Read before rewriting.

## Specification hierarchy

1. `docs/PRODUCT_SPEC.md` — product behaviour, financial rules, architecture, data model.
2. `docs/SPOTIFY_FINANCE_UI_PROMPT.md` — visual language, typography, colour, components, motion.
3. `docs/phases/PHASE_X_*.md` — scope and acceptance criteria for one phase.

Higher wins on conflict. Never silently pick a side: state the conflict, follow
the higher document, and report it.

Phase docs 0, 1, 4, 8 and 9 are required by `PRODUCT_SPEC.md` §14 but do not
exist in the repo yet. Ask for the missing document rather than inventing its scope.

## Current phase

**All ten phases complete.** Details and deferred scope for each are in
its own doc under `docs/phases/`:

- **Phase 0** (Design System) — MD3 dark-violet → Spotify dark-green token migration.
- **Phase 1** (Financial Engine) — outing reserves, transaction status, protected money/available budget/bank balance as explicit fields.
- **Phase 2** (Manual Transactions) — all seven types (Expense, Income, Transfer, Loan given/received, Refund, Adjustment) creatable from one Add flow; fixed an orphan-reference bug in `deleteTransaction`.
- **Phase 3** (Today) — `availableBudget`/`protectedMoney`/`bankBalance` (computed since Phase 1, shown nowhere) wired into the screen; a period-level budget bar; a balance-consistency note.
- **Phase 4** (Savings, no prior doc — written this pass) — ON TRACK/BEHIND status and a projected completion date for goals without a deadline; tab renamed to "Savings".
- **Phase 5** (Outings) — reserve/release UI wired to the Phase 1 ledger that had zero UI reading or writing it; Planned/Reserved/Spent shown as three numbers, not one; a Comfortable/Tight/Disruptive affordability read while creating one.
- **Phase 6** (Split) — PERCENTAGE split mode; found and fixed a real bug where an incoming payment could close the wrong direction of debt for a contact owed in both directions.
- **Phase 7** (Auto-Ingestion) — `RawEvents`/`ParsedEvents`: every captured message is now retained and its outcome explained, closing the exact bug that opened this session; a multi-signal (reference + merchant) dedup matcher replacing the amount+direction-only one; "Recover missed messages" in Settings actually reprocesses and can recover a message a since-fixed rule once dropped.
- **Phase 8** (Insights, no prior doc — written this pass) — the one concrete gap versus spec: findings and category rows are now tappable ("View X spending →"), navigating to a newly filterable Transactions screen.
- **Phase 9** (Investments, no prior doc — written this pass) — **resolved a real spec conflict** (§2 fixes five tabs and never names Investments; §14 still asks for a Phase 9 doc) by following the higher document: no sixth tab, "Investment contribution" as a recognised transaction concept instead, living on the Savings screen. Found and fixed a bug where the reclassification sweep would have silently wiped a manual investment tag on its very next run.

- **Phase 10** (Polish, no prior doc — written this pass) — a code-level audit (no device/emulator available in this environment): fixed missing accessibility labels/state on both icon-picker grids, a `Text`-based touch target with no valid `hitSlop`, and a `fontSize` override sitting below the smallest defined type-scale tier. Confirmed no literal colours/shadows/gradients exist outside `theme.ts`, confirmed existing test coverage for every data-integrity scenario the phase's checklist names, and flagged two items deliberately not changed blind: `Screen`'s plain `ScrollView` has no virtualization for very large lists, and two sheet/card motion durations exceed the stated 150–220ms (with their own documented rationale already in code).

All ten phase docs are now written and every phase this repository's specs
name is complete. `npm test` (575/575, 44 suites) and `npm run typecheck`
are green. Waiting for the user's next instruction — there is no further
numeric phase to advance to.

## Financial invariants

These are the reason the schema looks the way it does. Do not duplicate this
logic into a screen.

- **Direction ≠ meaning.** `direction` (DEBIT/CREDIT) is what the bank did.
  `kind` (SPEND / INCOME / SETTLE_IN / SETTLE_OUT / REFUND) is what it meant.
  Summing raw debits double-charges repayments; summing raw credits invents income.
- **One canonical transaction per real-world payment.** Many raw observations
  (SMS + notification + manual) may describe one payment. Merge; never create a second row.
- **Cash movement, personal expense, allocation and obligation are four different things.**
  Fronting ₹2,400 for four people is a ₹2,400 cash movement, a ₹600 expense and a ₹1,800 receivable.
- **Allocations do not move cash.** Goal contributions and outing reserves reduce
  available budget and leave the bank balance alone. They never write a Transaction row.
- **A settlement is not income or expense.** The expense was booked when the bill was paid.
- **Never fabricate a transaction.** Low confidence goes to the review inbox (`CaptureInbox`),
  not the ledger. `ACCEPT_THRESHOLD` in `src/services/parserService.ts` is the gate.
- **Keep raw evidence — of financial messages only.** Do not discard a raw source event because it was
  merged, rejected or superseded. But a personal SMS is never raw evidence: it is dropped before storage
  (Play's SMS policy, DPDP data minimisation; narrowed in 0.9.17), and OTP codes are masked.

## Offline-first

No backend, no account, no network for anything core. All calculation and
storage is on-device. Future external sources go behind a source-adapter
interface; they are not required for V1.

## UI principles

Target is the dark, green-accented, typography-led language in
`docs/SPOTIFY_FINANCE_UI_PROMPT.md`. Financial numbers are the heroes.

`src/theme/theme.ts` now implements this directly (Phase 0) — `palette.accent`
is the one Spotify green, three surfaces (`background`/`surface`/`surfaceElevated`),
`danger`/`warning`/`info` at the spec's exact hex values. The MD3 tonal/violet
system it replaced is gone; don't reintroduce MD3 role names
(`primary`/`secondaryContainer`/`tertiary`/…) or a fourth surface step.

Screen-level layout has not been touched by Phase 0 — a screen still built
around card-per-concept, MD3 hierarchy, or the old (unused) `Goals`/`Squad`
tab labels is that screen's own phase to fix (3, 5, 6, …), not a sign the
token migration is incomplete.

Rules that hold regardless of which palette is in force:

- Design tokens only (`src/theme/theme.ts`). No literal colours, sizes or radii in screens.
- Build the reusable component, not a one-off. Shared kit lives in `src/components/ui.tsx`.
- Lists and hierarchy over a card per row.
- Green (or the accent in force) is semantic — state, progress, primary action. Not paint.
- No giant FABs, gradients, glassmorphism, rainbow charts, decorative motion or fake scores.
  (One exception: the subtle glow on Today's ring, per `docs/DESIGN_DIRECTION.md`.)

**0.9.14 direction (user-chosen, overrides the Spotify doc where they conflict):**
Raycast ink, a coral accent used rarely, "fine is not a colour" (healthy = white),
thin huge numerals, no boxes, one outlined sentence-case action per screen, and
three tabs (Today / Plans / People), four since 0.9.15 with Wealth (`docs/WEALTH.md`).
Copy is witty but kind. See `docs/DESIGN_DIRECTION.md`.
Each tab owns one hero *shape* (0.9.17, `src/components/Heroes.tsx`): Today a
centred ring, Plans jars, Wealth a chart, People faces. Distinction comes from
shape, not new colours. Don't give a tab another tab's hero.
- Transitions 150–220ms.

## Reuse / refactor / rebuild

Classify before touching: KEEP (sound), REFACTOR (useful, weak architecture),
REBUILD (incompatible), REMOVE (obsolete), UNKNOWN (investigate).

Do not delete code because a rewrite looks cleaner. Do not preserve bad
architecture because it already exists.

## Testing

- `npm test` (jest + ts-jest) and `npm run typecheck` must both be green before a phase is done.
- Tests run real SQL: `tests/utils/sqljsAdapter.ts` gives jest the same `DbAdapter`
  surface `expo-sqlite` implements on-device, so query logic is genuinely exercised.
- Financial logic needs concrete edge cases — shared bill, loan, partial repayment,
  self-transfer, refund, failed payment — not just happy paths.
- Schema changes are forward-only migrations in `src/db/migrations.ts`, keyed on
  `user_version`. Never edit a migration that has already shipped; add the next one.
- tsconfig targets Metro (`moduleResolution: bundler`); `jest.config.js` overrides it
  to CommonJS for ts-jest. Keep that override when touching either file.
- Privacy rules with tests behind them: only financial SMS are ever stored
  (`FinancialSms.kt` + `smsPrivacy.ts`), OTPs are masked, and "Erase everything"
  must leave no personal table with rows (`tests/backup.test.ts`). See `docs/PLAY_READINESS.md`.
- No `tsx`/`ts-node` is installed. To run ad-hoc TypeScript, write it as a jest test.

## Phase boundary rule

Implement only the phase explicitly requested. Do not continue into the next one.

When a phase is done: run the checks, summarise what changed, report what is
still broken, then stop with:

`STOPPED AT PHASE BOUNDARY — waiting for next instruction.`
