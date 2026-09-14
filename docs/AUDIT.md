# Existing App Audit — 2026-09-14

Audit of the Pinch repository against `PRODUCT_SPEC.md` and
`SPOTIFY_FINANCE_UI_PROMPT.md`. No implementation was changed. Baseline at the
time of audit: `npm test` 42 suites / 500 tests green, `npm run typecheck`
clean, working tree carries uncommitted parser/category work from a prior
session.

---

## 1. Stack

| Layer | Choice |
| --- | --- |
| Runtime | Expo SDK 51, React Native 0.74.5, React 18.2, TypeScript 5.3 |
| Navigation | React Navigation 6 — bottom tabs + native stack |
| Storage | `expo-sqlite` 14, forward-only migrations on `user_version` |
| Preferences | AsyncStorage (`src/settings/settingsStore.ts`) |
| Native | `modules/pinch-capture` — Expo module, Kotlin: SMS receiver, NotificationListenerService, contacts reader |
| Notifications | `expo-notifications` with a local rate-limited nudge engine |
| Charts | `react-native-svg`, hand-drawn |
| Tests | jest + ts-jest, 42 suites; `sql.js` gives tests the real `DbAdapter` surface |
| Build | Local Gradle `assembleRelease` → copied to the phone by PowerShell |

Android-only by design: SMS and notification capture do not exist elsewhere.
The app degrades to manual entry when the native module is absent.

## 2. Architecture as built

```
App.tsx                 init → migrations → notifications → revalidation → capture drain
  navigation/           5 tabs (Today, Outings, Goals, Squad, Insights) + 3 stack screens
  screens/              8 screens, 450–700 lines each, own their data loading
  components/           ui.tsx design kit + 8 feature sheets/modals
  services/             orchestration: capture, budget, classification, transfer,
                        settlement, revalidation, onboarding
  math/                 pure functions, no I/O: budget, splitEngine, transfers,
                        classification, insights, merchantClassifier
  db/                   connection + dbService barrel + repos/* + migrations.ts
modules/pinch-capture/  Kotlin capture, buffered in SharedPreferences, drained by JS
```

The layering is genuinely good and mostly matches what the spec asks for:
pure math isolated from I/O, one database surface (`dbService`) instead of
screens reaching into tables, native capture buffered so nothing is lost while
JS is asleep. The weaknesses are in the *model*, not the file layout.

## 3. The financial model as built

Ledger: one `Transactions` table. Two orthogonal fields carry meaning —

- `direction`: `DEBIT | CREDIT` — what the bank did.
- `kind`: `SPEND | INCOME | SETTLE_IN | SETTLE_OUT | REFUND` — what it meant.

Plus `transfer_pair_id` (self-transfer, the other leg) and `non_spend_reason`
(`WALLET_TOPUP | CARD_BILL | CASH_WITHDRAWAL`). `excluded_at` soft-deletes
instead of dropping the row, so a re-import cannot resurrect junk.

Obligations: `IOUs` + `Settlements`. `openAmount` is always derived from the
settlements ledger, never stored — it cannot drift.

Allocations: `Goals` + `GoalContributions`. Contributions deliberately never
write a Transaction, because the money has not moved.

Budget (`src/math/budget.ts`):

```
spendablePool = allowance + topUps − grossSpend + settledIn − settledOut
                + expectedRecovery − openPayables − goalReserve
dailyLimit    = spendablePool / daysRemaining
```

`expectedRecovery` discounts each receivable by the person's demonstrated
settle speed and the debt's age. This is better than the spec asks for and
should be kept.

**Spec rules already satisfied:** A (self-transfer), B (loan), C (repayment),
D (borrowing), E (reimbursement), F (shared expense paid by someone else),
G (repaying a shared expense), H (refund, as a `REFUND` kind), I (failed
payment, rejected at the parser).

**Spec rule not satisfied:** J — pending → completed. There is no transaction
lifecycle at all; a pending observation and its completion are two unrelated
parses that survive or collide by luck in the dedup window.

## 4. Ingestion as built

`SmsReceiver` / `PinchNotificationListener` → `CaptureBuffer` (SharedPreferences)
→ JS drain → `ingestMessage`:

1. `isBlocked(sender, body)` — user blocklist.
2. `parseMessage` — reject lists, amount extraction, direction verbs, structural
   account gate, additive confidence scoring.
3. `buildDedupKey` — reference number, else amount + 120s bucket.
4. `findProbableDuplicate` — fuzzy backstop, amount ±0.01 + direction, ±360s.
5. `isBlocked(merchant)`.
6. Confidence ≥ `ACCEPT_THRESHOLD` (0.8) → post; below → `CaptureInbox` review queue.
7. Post-post: transfer matching, settlement matching, categorisation, nudge.

Categorisation runs a three-stage cascade: user `MerchantRules`, then a
multinomial naive-Bayes classifier over merchant tokens
(`CategoryTokenWeights`, Lidstone smoothing 0.1, threshold 0.55), then
uncategorised. Corrections upsert a rule so the fix sticks.

`PARSER_RULES_VERSION` gates a one-time revalidation sweep so tightened rules
are applied to already-imported history.

This is a serious, well-reasoned pipeline. The problems are structural, listed
below.

## 5. Classification of existing systems

### KEEP

| System | Why |
| --- | --- |
| `src/math/*` — pure, tested, no I/O | The right shape. `budget.ts`, `splitEngine.ts`, `transfers.ts`, `insights.ts` are the strongest code in the repo. |
| `direction` vs `kind` separation | Exactly the cash-movement/meaning split the spec demands, already load-bearing. |
| Migration runner (`user_version`, forward-only) | Correct and tested. |
| `DbAdapter` + sql.js test adapter | Tests exercise real SQL. Rare and valuable. |
| `IOUs` + `Settlements` with derived `openAmount` | Cannot drift. Partial repayment works. |
| Receivable confidence weighting | Beyond spec, and the honest answer. |
| `CaptureInbox` review queue | The reason auto-capture is safe to ship. |
| Native capture module + buffer | Hard-won. SMS multipart concatenation, JSI sync methods, buffering before JS wakes. |
| Merchant classifier + correction learning | Matches Phase 7's "merchant learning" requirement. |
| `excluded_at` soft-delete | Right call over `DELETE`. |
| `classification.ts` non-spend detection | Wallet top-up / card bill / ATM handled with real nuance. |

### REFACTOR

| System | Why |
| --- | --- |
| `Outings` | Has `budget_amount` (planned) and spend rollup, but **no reserve**. Phase 5 needs planned / reserved / spent as three separate numbers, and reserving must reduce available budget without touching cash. |
| Budget engine inputs | Allowance-anchored. Spec wants bank balance → protected money → available budget → safe-to-spend. `BalanceSnapshots` exists but only feeds a card; it is not wired into the budget. |
| `Goals` | Sound, but "reserve" belongs in one allocation concept shared with outings rather than a goal-specific formula. |
| `splitEngine.ts` | EQUAL / SHARES / EXACT are correct including largest-remainder rounding. Phase 6 additionally needs items, percentage and custom, plus groups. |
| Screens (450–700 lines each) | Each owns its own loading, refresh and sheet state. Extract data hooks and shared rows before adding more. |
| `settingsStore` in AsyncStorage | Fine now; a settings table would let migrations reason about it. |
| `parserService.ts` | One 700-line function chain. Phase 7 wants explicit stages (identify → normalise → extract → normalise merchant → type candidates → confidence). Same logic, addressable seams. |

### REBUILD

| System | Why |
| --- | --- |
| **Theme / design system** | Material Design 3, violet `#D0BCFF`, near-black `#0F0D13`, MD3 type scale, radii to 48px, `BlurOrb` atmospherics, extended FAB. The spec mandates Spotify-dark with `#1ed760` / `#121212` / `#181818` / `#1f1f1f`, 8–16px radii, no FABs, no glassmorphism. The token layer is well built — it is simply built to the wrong specification. |
| **Raw-event retention** | There is no raw-event table. A message the parser rejects leaves **no trace anywhere**; only low-confidence parses reach `CaptureInbox`. This violates `PRODUCT_SPEC` §11 and Phase 7 "Raw event retention", and it is the direct cause of the missing-SMS bug reported before this audit: a dropped payment cannot be diagnosed or reprocessed because the evidence was discarded. |
| **Deduplication** | `findProbableDuplicate` matches on amount + direction + ±360s and **deliberately ignores merchant**. Phase 7 explicitly forbids amount-dominant matching. Two genuinely different ₹50 payments six minutes apart silently collapse into one. |
| **Transaction lifecycle** | No `status` column. Pending → completed, failed, reversed, refunded cannot be represented, so Rule J cannot hold. |

### REMOVE

| System | Why |
| --- | --- |
| `src/types.ts` | Dead pre-v3 model (`Transaction` with `type`/`rawSms`, `IOU` with `counterparty`). Superseded by `src/db/types.ts`; nothing should import it. Verify, then delete. |
| `SPOTIFY_FINANCE_UI_PROMPT (1).md` (repo root) | Byte-identical duplicate of the canonical copy now in `docs/`. Left in place pending the user's word. |
| `BlurOrb`, extended `FAB` | Explicitly ruled out by both specs. Remove as part of the design-system rebuild, not before. |

### UNKNOWN

| System | Why |
| --- | --- |
| Notification engine (`engine.ts`, `messages.ts`) | Well built and rate-limited, but no phase document describes it. Phase 8/9 scope is unwritten. Do not extend until scoped. |
| `survivalMode.ts` | A second, simpler budget formula (balance ÷ days left in calendar month) parallel to `math/budget.ts`. Unclear which is authoritative; the spec forbids dividing balance by days. |
| Investments (Phase 9) | Nothing exists. Phase doc missing. |
| Export / import | Nothing exists. Phase 10 asks for it "if implemented". |

## 6. Critical financial-correctness problems

Ordered by how much damage each does.

1. **Rejected raw events are destroyed.** No `RawEvents` table. A parse failure
   returns `SKIPPED` and the message is gone — unrecoverable, undiagnosable,
   unreprocessable. Only `backfillFromInbox` (re-reading the device SMS inbox,
   limited and time-bounded) can recover anything. Violates `PRODUCT_SPEC` §11.
2. **Dedup can eat a real payment.** Amount + direction + 6 minutes, merchant
   excluded by design. Two different same-amount payments close together →
   the second is silently dropped, with no row and no review item.
3. **Bank balance is not part of the budget.** The spec's core identity is
   `bank balance = available budget + protected money`. The engine starts from
   a user-typed allowance instead; `BalanceSnapshots` is display-only. Nothing
   enforces `available budget ≤ bank balance`.
4. **Outing reserves do not exist.** Phase 5's central mechanic — reserve money,
   available budget drops, bank cash does not — is unimplemented. Outings
   currently only tag spending after the fact.
5. **No transaction lifecycle.** Pending/completed/failed/reversed cannot be
   modelled. A pending notification followed by a completion SMS is two
   observations racing a 6-minute window.
6. **`sweepExpiredPeriod` moves money on a schedule.** An expired period's
   leftover is auto-contributed to an auto-created "Savings" goal. That is the
   app changing an allocation without asking, against `PRODUCT_SPEC` §1.6.
7. **Two competing budget formulas.** `math/budget.ts` and `math/survivalMode.ts`
   answer the same question differently; the latter is the naive division the
   spec explicitly rules out.
8. **Merchant rules over-match on substrings.** `ola` catches Motorola, `bar`
   catches Barista, `jio` catches JioMart, `book` catches Bookmyshow *and*
   textbooks. Known, unfixed, mis-categorises real spending.
9. **Manual entry is incomplete.** Phase 2 requires expense, income, transfer,
   loan given, loan received, refund and adjustment. `AddExpenseSheet` offers
   spent/received only; loans are a retrofit on an existing row
   (`MarkAsLoanSheet`), and transfer/refund/adjustment have no manual path.

## 7. Major UI / design problems

1. **Wrong design language.** MD3 violet throughout vs the mandated Spotify
   dark green. Every token, every screen. This is the single largest piece of
   outstanding work.
2. **Forbidden patterns in use.** `BlurOrb` behind the Today hero
   (glassmorphism), extended FAB, 48px hero radii, 56px hero type.
3. **Card-per-concept drift.** Today wraps the hero, the affordability tool,
   the transaction list and the warning banner each in their own `Card`.
   Both specs call this out explicitly.
4. **Tab naming diverges.** `Goals` / `Squad` vs the spec's `Savings` /
   `Split`. Structure matches; labels do not.
5. **Component kit is thinner than the spec's list.** `ui.tsx` has ~14
   primitives; `SPOTIFY_FINANCE_UI_PROMPT` names ~27 (`MoneyAmount`,
   `TransactionRow`, `MetricBlock`, `SegmentedControl`, `StatusLabel`,
   `AmountInput`, `InsightBlock`…). Screens hand-roll these today, which is
   why rows differ subtly between screens.
6. **Today's hierarchy is not the spec's.** Spec order is bank balance →
   available budget → protected → bar → safe-to-spend. Built order leads with
   safe-to-spend; protected money is not surfaced at all because it is not modelled.
7. **Emoji as primary identity.** Outings and goals store an `emoji` column and
   render it as the row's icon. `PRODUCT_SPEC` §9 rules out emoji as primary
   navigation iconography; the icon system (`Icon.tsx`, Feather/MCI) already
   exists and is the right answer.

## 8. Specification conflicts found

| Conflict | Resolution |
| --- | --- |
| `PRODUCT_SPEC` §2 names tabs Today/Outings/Savings/Split/Insights; code ships Today/Outings/Goals/Squad/Insights | Spec wins — rename in the relevant phase. Purely cosmetic. |
| `PRODUCT_SPEC` §8 and the UI prompt both mandate Spotify green; the code implements MD3 violet with a thoughtful written rationale in `theme.ts` | Spec wins. The rationale is good design writing for a different product. |
| `PRODUCT_SPEC` §14 requires 11 phase documents; 6 exist | Unresolvable here. Phases 0, 1, 4, 8, 9 have no document — their scope must come from the user. |
| Phase 7 forbids amount-dominant dedup; `findProbableDuplicate` is amount+direction only | Spec wins. Listed as REBUILD. |
| `PRODUCT_SPEC` §1.6 forbids silently changing allocations; `sweepExpiredPeriod` auto-moves leftovers into savings | Spec wins. Should become a prompt, not an action. |

## 9. Proposed target architecture

Keep the layering. Change the model. Four structural moves, in dependency order:

**A. Raw event layer (fixes problems 1, 2, 5; unblocks Phase 7)**

```
RawEvents      id, source, sender, body, received_at, captured_at, device_meta
ParsedEvents   id, raw_event_id, amount, direction, merchant, account_hint,
               reference, rail, confidence, parser_version, status, reject_reason
Transactions   canonical, unchanged in spirit
EventLinks     parsed_event_id → transaction_id  (many observations, one transaction)
```

Every captured message writes a `RawEvents` row *before* parsing, always,
including rejects. Parse results — including "rejected, because HARD_REJECT
matched /\botp\b/" — land in `ParsedEvents`. A raised `parser_version` can
reprocess history without re-reading the device inbox. Nothing is ever lost,
and "why did my payment not show up?" becomes a query.

**B. Multi-signal matcher (replaces `findProbableDuplicate`)**

Score candidates on reference ID, amount, time proximity, direction, account,
merchant, rail and source, with an explicit reconciliation window. Same
reference → merge outright. Same amount, different merchant → two transactions.
Ambiguous → review queue, never a silent drop.

**C. Allocation model (fixes 3, 4, 6; unblocks Phase 5)**

One `Allocations` table serving goals and outings alike: `purpose_type`,
`purpose_id`, `amount`, `created_at`, `released_at`. Then

```
protected money  = Σ open allocations
available budget = bank balance − protected money
safe to spend    = f(available budget, days remaining, commitments, buffer, pace)
```

anchored on `BalanceSnapshots` as ground truth, with the allowance as the
fallback when no balance has been entered. This makes the spec's headline
identity true by construction and gives Today its missing "Protected" line.

**D. Lifecycle column on Transactions**

`status: OBSERVED | PENDING | COMPLETED | FAILED | REVERSED | REFUNDED | UNKNOWN`.
Pending → completed mutates one row. Failed never counts. Rule J holds.

None of this requires discarding the existing math. `computeBudget` keeps its
shape; its inputs change source. `splitEngine` gains modes. The parser keeps
its regexes and gains explicit stages around them.

## 10. Suggested phase order

Not a decision — a recommendation, for the user to accept or reorder.

1. **Phase 1 (financial engine)** — allocations, lifecycle, balance-anchored
   budget. Doc missing; must be written first.
2. **Phase 7 (auto-ingestion)** — raw events and the multi-signal matcher.
   Out of numeric order deliberately: it is the live bug, and the raw-event
   layer is a prerequisite for diagnosing anything.
3. **Phase 0 (design system)** — the MD3 → Spotify token migration plus the
   full component kit, in one pass, before more screens are written against
   the wrong tokens. Doc missing.
4. **Phase 2 (manual transactions)** — complete the type coverage.
5. **Phases 3, 5, 6** — Today, Outings, Split re-laid on the new model.
6. **Phases 4, 8, 9, 10** — docs missing for 4, 8 and 9.

The one ordering constraint that is not negotiable: **the raw-event layer
should land before any further parser tuning**, because without it every
future ingestion bug is undiagnosable for exactly the reason the current one is.
