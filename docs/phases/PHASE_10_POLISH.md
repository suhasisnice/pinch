*(Original phase document below the `---`. This section records the audit
actually performed and what it found.)*

## What this pass could and couldn't do

This environment has no attached device or emulator and the repository has
no screen-rendering test infrastructure (confirmed in Phase 8, unchanged
here). Every item below is a **code-level** audit — reading the
implementation, grepping for the patterns the checklist names, and
reasoning from the design tokens/tests already in place — not a visual
walkthrough. Where that limit matters for a specific finding, it's called
out rather than glossed over.

## Fixed

- **Icon-picker accessibility (Goals + Outings).** Both the goal-icon and
  outing-icon selection grids (`GoalsScreen.tsx`, `OutingsScreen.tsx`) had
  no `accessibilityRole`, `accessibilityLabel`, or `accessibilityState` at
  all — a screen-reader user got nothing describing each icon, and which
  one was selected was communicated by colour alone (`palette.info` vs
  `palette.textMuted`), the exact "non-color-only status communication"
  failure the checklist names. Both now expose the icon's own name
  (`'laptop'`, `'party'`, …) as the label and `selected` as state.
- **Settings gear touch target (Today).** A `Text` wrapping a 22px icon,
  with only its own padding as a hit area — no `hitSlop`, and `Text` in
  this RN version doesn't accept one at all (a real `tsc` error once
  added, not a style nit). Converted to a `Pressable` with `hitSlop={12}`,
  matching the pattern `BalanceCard`'s own eye-toggle already used.
- **A `fontSize: 9` override, below every token in the type scale**
  (`InsightsScreen`'s monthly-comparison chart label) — `typography.micro`
  itself is 12px; this sat 3px under the smallest defined tier, which is
  the kind of `CLAUDE.md` "no literal sizes in screens" violation the
  audit was looking for, and a real readability concern on its own terms.
  Removed the override.

## Checked and found already correct (not re-fixed)

- **No literal hex colours, `rgba()`, gradients, or ad-hoc shadows anywhere
  outside `theme.ts`** — grepped across every screen and component; zero
  hits. Every shadow goes through `elevation.levelN`.
- **The other ~13 `fontSize: N` overrides found** (`GoalsScreen`,
  `InsightsScreen`, `OutingsScreen`, `SquadScreen`, `BalanceCard`,
  `BudgetBreakdownSheet`, `ui.tsx`) all keep a token's *weight and
  letter-spacing* (`...typography.bodyBold`, `...typography.hero`, …) and
  only adjust size for a specific hierarchy need — a large debt figure
  sized past `hero`'s own 40px, a percentage sized a hair above `body`.
  This is a deliberate, consistent pattern rather than 13 arbitrary
  numbers, and rewriting it would mean redesigning the type scale, not
  fixing a defect — left alone.
- **Destructive-action confirmations.** Every delete (`TransactionDetailSheet`,
  `GoalsScreen`, `OutingsScreen`, `SettingsScreen`'s reset) already
  confirms via `Alert.alert` with `Cancel` first and a `style: 'destructive'`
  action, consistent throughout.
- **Empty states**: present on every screen with data-driven content
  (`Today`, `Outings`, `Savings`, `Split`, `Insights`, `Review`,
  `Transactions`). Settings has none, correctly — it's a fixed list of
  controls, not content that can be empty.
- **Malformed-event handling** in the native capture buffer
  (`CaptureBuffer.kt`): JSON parsing is wrapped in `runCatching`, falling
  back to an empty result rather than crashing on a corrupted buffer entry.
- **The data-integrity scenarios the checklist names** — duplicate
  prevention, self-transfer, pass-through/round-trip transfers, partial
  repayment, reimbursement, debt netting, loan/repayment, outing and
  savings allocation vs. spending — all have direct test coverage already,
  built up across Phases 1, 2, 5, 6 and 7 rather than freshly added here;
  confirmed present, not re-litigated.
- **Query shape at the data layer.** Spot-checked the list-view queries
  most likely to hide an N+1 (`getOutings`, `getActiveGoals`,
  `getContactBalances`) — each is one query with correlated
  subqueries/joins, not a loop issuing one query per row.

## Found, and deliberately not changed blind

- **Large lists have no virtualization.** `Screen` (`ui.tsx`) wraps every
  screen's content in a plain `ScrollView`; `TransactionsScreen` renders
  every matching row (grouped into day-cards) with no windowing. Phase 3's
  own acceptance test asks the page to "remain readable with 100+
  transactions," and this phase's checklist raises the bar to 1,000+ — at
  that scale a plain `ScrollView` mounting every row is a real, plausible
  jank/memory risk, not a hypothetical one. Not fixed here: `Screen` is
  the shared wrapper for every single screen in the app, and swapping its
  rendering model (or `TransactionsScreen`'s alone) for `FlatList`-style
  virtualization is a structural change with real regression surface
  (pull-to-refresh, sheet layering, scroll-position behaviour) that
  deserves to be verified on-device, which this environment cannot do.
  Flagged rather than guessed at.
- **Sheet/card motion runs longer than the stated 150–220ms.**
  `duration.quick` (300ms, cards arriving) and `duration.long` (450ms, a
  sheet sliding up) both exceed it — deliberately, per the code's own
  comment ("Large surfaces: a sheet coming up from the bottom"), and
  `PRODUCT_SPEC.md` §10 itself allows a slower transition when it
  "materially improves understanding." Whether a sheet genuinely needs
  450ms to read as physical is a judgement call that wants to be seen, not
  guessed at from source — left as a reported finding rather than a
  unilateral change to a value with its own stated rationale.

## Explicitly out of scope

- **Backup/export.** Not implemented anywhere in the app. `PRODUCT_SPEC.md`'s
  own phrasing ("if implemented") makes this correctly a no-op audit item,
  not a gap.
- **A genuine 1,000+-transaction / 100+-goal load test.** Would need a
  seeded database and either a device or a rendering harness this
  environment has neither of. The query-shape spot-check above is the
  closest available substitute.
- **Re-running every acceptance test from every prior phase doc.** Taken
  on the record of `npm test` (575/575 passing across 44 suites) and each
  phase's own acceptance criteria already verified when it shipped, rather
  than re-litigated line-by-line here.

## Acceptance tests

- `npm test` and `npm run typecheck` stay green (575/575, 44/44 suites; 0
  typecheck errors).
- Both icon-picker grids expose a role, label and selected-state per
  choice.
- No screen or component file contains a literal hex colour, `rgba()`
  value, or a `fontSize` below the smallest defined typography tier.

---

# Phase 10 — Product Polish, Reliability and 10/10 Pass *(original)*

## Objective

Perform a dedicated final pass for visual consistency, interaction quality, accessibility, performance and data reliability.

This is not a feature-building phase.

## Read first

- `PRODUCT_SPEC.md`
- all relevant phase documents

## Visual audit

Check every screen for:

- consistent spacing
- typography hierarchy
- consistent iconography
- color-token usage
- appropriate use of cards
- alignment
- touch target sizes
- dark-theme contrast
- bottom navigation consistency
- consistent empty/error states

## Anti-vibe-coded audit

Remove:

- unnecessary cards
- duplicate UI patterns
- random border radii
- arbitrary colors
- oversized headings
- gratuitous gradients
- excessive shadows
- excessive badges
- decorative animations
- inconsistent icon styles
- fake AI features

## Interaction audit

Verify:

- every action has clear feedback
- destructive actions have appropriate confirmation
- bottom sheets are dismissible
- keyboard/amount entry behaves correctly
- navigation state persists sensibly
- transactions can be edited without duplication
- review queue is efficient

## Motion audit

Motion should be purposeful and subtle.

Standard transitions should remain around 150–220ms unless a slower transition materially improves understanding.

## Accessibility

Support:

- scalable text
- sufficient contrast
- semantic labels
- screen-reader descriptions
- non-color-only status communication
- sufficient touch targets

## Performance

Test:

- 1,000+ transactions
- 100+ people
- 100+ goals/outings combined
- large Insights time ranges
- app cold start
- database reads/writes
- transaction-ingestion bursts

No visible jank in normal flows.

## Offline behavior

Test with:

- airplane mode
- no network ever enabled
- app restart
- device reboot if practical
- database migration

Core functions must remain usable offline.

## Data integrity audit

Specifically test:

- duplicate transaction prevention
- transfer handling
- loan/repayment
- refunds
- pending/completed
- outing allocation vs spending
- savings allocation vs spending
- shared expenses
- partial repayment
- debt netting
- cancellation/completion releases

## Backup/export

Verify that local data can be exported and imported if implemented.

If an encrypted export is implemented, verify integrity and error handling.

## Empty/error states

Every major screen needs intentional states for:

- no data
- loading where applicable
- permission unavailable
- parsing failure
- corrupted/malformed event
- missing transaction
- invalid amount
- invalid split
- invalid goal

## Final acceptance

The app should feel like one product, not ten separately generated screens.

A user should be able to:

1. receive allowance,
2. see available budget,
3. spend money,
4. have transactions recorded,
5. reserve money for an outing,
6. save toward a goal,
7. split an expense with contacts,
8. settle obligations,
9. inspect Insights,

without encountering inconsistent accounting or visual language.

No new feature work should be introduced during this phase unless it is required to fix a defect discovered by the audit.
