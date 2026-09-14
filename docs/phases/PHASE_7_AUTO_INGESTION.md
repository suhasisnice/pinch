*(Original phase document below the `---`. This section records what shipped.)*

## What shipped

This is the phase the whole engagement started from — the user's very first
message was a payment whose SMS never became a transaction, and the reason
turned out to be structural: a message the parser rejected left **no row
anywhere**, so there was nothing to diagnose it from. Everything below
either closes that gap directly or was found while closing it.

### Raw-event retention (migration v12)

`RawEvents` stores every captured message exactly once, unconditionally,
before `ingestMessage` runs a single gate on it. `ParsedEvents` records
what happened on *each* attempt — one row per attempt, never overwritten —
naming the outcome (`POSTED`/`QUEUED`/`SKIPPED_BLOCKED`/`SKIPPED_NO_PARSE`/
`SKIPPED_DUPLICATE`/`SKIPPED_ADD_FAILED`), the specific reason for a reject
(`explainRejection`, a permanent version of the throwaway diagnostic harness
built by hand earlier in this engagement to answer "why did this one SMS
not show up"), and a link to the transaction or capture it produced when it
produced one.

`ingestMessage` was refactored into a thin wrapper that records the
`RawEvent` and a shared `processMessage` that does the actual parse →
dedup → post/queue work and writes exactly one `ParsedEvent` per call. This
split is what makes reprocessing possible without inventing a parallel
pipeline: `reprocessRawEvent`/`reprocessUnresolvedRawEvents` call the exact
same `processMessage`, just fed from a stored `RawEvent` instead of a live
`CapturedMessage`.

**This is retention *and* recovery, not just diagnostics.** From this
phase onward, a message dropped by a rule that later gets loosened, or by
a duplicate match that later gets more precise, can be re-tried and
recovered — closing the actual complaint that opened this engagement, not
only making the next one easier to answer. Wired into Settings as
"Recover missed messages," next to the existing "Import recent SMS."

### The multi-signal dedup matcher

`findProbableDuplicate` matched on amount + direction + a 6-minute window
only, which the very first audit in this engagement flagged as exactly the
false positive this phase's own spec warns against: two different people
paying the same round amount minutes apart used to collapse into "one
payment reported twice." Fixed with two additional signals, layered so
neither breaks the original behaviour for a caller that doesn't have them:

- **Reference number**, checked first and independent of the time window
  — a bank's own SMS confirmation for a UPI payment has been seen arriving
  hours after the paying app's push notification, well outside any window
  that wouldn't also false-match unrelated payments.
- **Merchant similarity** (`sameMerchant`, already built for merchant-rule
  learning), checked only when a merchant is supplied. Without one, the
  original amount+direction+window heuristic is unchanged — this was kept
  strictly additive rather than replacing behaviour four other tests
  already pinned down.

`ingestMessage` now passes both signals through; every existing dedup test
kept passing unmodified, and new tests prove the actual fix (two different
merchants, same amount, same window → no longer a false match) and the
old behaviour (no merchant supplied → original heuristic, unchanged).

### Explicitly out of scope / deferred

- **Structured extraction beyond what the parser already returns.**
  `ParsedEvents` stores amount/direction/merchant/confidence — the fields
  `ingestMessage` already had in hand. Payment method, richer status
  indicators, and the parser's internal "stages" (source ID → normalise →
  extract → merchant-normalise → type-candidate → confidence) as separate,
  independently testable functions were not built; the parser's regex core
  is unchanged, only what happens around a rejection.
- **A configurable reconciliation window and lifecycle beyond `status`.**
  Phase 1 already added `Transactions.status`
  (`COMPLETED`/`PENDING`/`FAILED`/`REVERSED`/`REFUNDED`) as a prerequisite
  for this phase; nothing yet writes a non-`COMPLETED` row, since the
  parser still hard-rejects failed/pending language outright rather than
  recording it as such. Teaching the parser to recognise `PENDING` and
  transition it to `COMPLETED` on a follow-up message is real, separate
  parsing work.
- **The full synthetic/adversarial test corpus** the original document
  asks for (duplicate SMS, SMS+notification duplicates, failed-then-
  successful UPI, partial refund, pass-through transfer, …). Coverage
  added this phase is targeted at the raw-event and dedup-matcher changes
  specifically, reusing existing real-SMS fixtures; it is not the
  standalone corpus file the phase describes.
- **A UI surface for `ParsedEvents`' full history** (a per-message timeline
  a user could actually open). "Recover missed messages" in Settings uses
  the data; nothing yet lets someone inspect *why* one specific message
  was skipped from inside the app — that's still a `getParsedEventsForRawEvent`
  query away, not a screen.
- **Merchant learning, recurring detection, refund matching to a specific
  original expense.** Merchant learning already existed pre-Phase-7
  (`classificationService.ts`); recurring detection already existed
  (`detectRecurring` in `math/insights.ts`). Refund-to-original-expense
  linking was already deferred explicitly in Phase 2's own doc, for the
  same reason: it needs a real matching design, not a column.

## Acceptance tests

All from the original document below, plus:

- A message that fails any gate (blocked, unparseable, duplicate) still
  produces exactly one `RawEvent`.
- Reprocessing a `RawEvent` never creates a second `RawEvent` for the same
  message, and never overwrites an earlier `ParsedEvent` — both attempts
  stay on record.
- A message recorded while blocked, then reprocessed after being
  unblocked, posts successfully and the original rejection is still
  queryable via `getParsedEventsForRawEvent`.
- Two different merchants paying the identical amount within the
  duplicate-matcher's window are never merged once a merchant signal is
  supplied; the original window-only behaviour is unchanged when it isn't.
- A full `resetData({ ledger: true })` clears `RawEvents` (and, by cascade,
  every `ParsedEvent` on it) along with the rest of the ledger it fed.
- `npm test` and `npm run typecheck` stay green.

---

# Phase 7 — Automatic Transaction Ingestion *(original)*

## Objective

Introduce local automatic ingestion only after manual accounting is proven correct.

Core principle:

**One real-world transaction may produce many observations.**

The app must treat raw events as evidence and create one canonical transaction when appropriate.

## Read first

- `PRODUCT_SPEC.md`
- `PHASE_1_FINANCIAL_ENGINE.md`
- `PHASE_2_MANUAL_TRANSACTIONS.md`

## Source abstraction

Create a source-adapter interface conceptually supporting:

- SMS
- Notifications
- Manual
- Future bank/account source

All sources produce a normalized `RawEvent`.

## Raw event retention

Never discard raw evidence merely because it is merged.

Retain enough local metadata to debug and reprocess.

## Parsing pipeline

### Stage 1 — Source identification

Identify sender/package/source family where available.

### Stage 2 — Text normalization

Normalize:

- INR/₹/Rs variants
- commas
- decimals
- whitespace
- case
- Unicode punctuation

### Stage 3 — Structured extraction

Extract candidate:

- amount
- direction
- account
- merchant
- counterparty
- payment method
- reference/transaction ID
- timestamp
- status indicators

### Stage 4 — Merchant normalization

Map variants to canonical merchant names.

Example:

`ZOMATO LTD`, `zomato`, `ZOMATO ONLINE` → `Zomato`

### Stage 5 — Transaction-type candidates

Candidate types may include:

- expense
- income
- transfer
- refund
- repayment
- loan
- investment
- fee
- pending
- failed
- reversal

### Stage 6 — Classification confidence

Return category/type plus confidence.

Do not use a black-box model as the sole truth source.

## Deduplication

Do not use amount-only matching.

Compare multiple signals:

- amount
- timestamp proximity
- direction
- account
- merchant/counterparty
- payment method
- reference ID
- source

A very close match across multiple signals should be merged into one canonical transaction.

## Reconciliation window

New events should be allowed a short reconciliation window so that SMS and notification observations can converge on one transaction.

The exact duration should be configurable and data-driven.

## Transaction lifecycle

Support:

- observed
- pending
- completed
- failed
- reversed
- refunded
- unknown

Pending → completed should remain one lifecycle.

Failed payment should not count as completed spending.

## Review thresholds

Suggested initial policy:

- High confidence: auto-record
- Medium confidence: record with easy correction
- Low confidence: review queue

Exact thresholds should be configurable and tested against a representative corpus.

## Missed transactions

The app must support user-entered expected/current balance reconciliation because offline ingestion may miss events.

Example:

Expected balance ₹8,200.
User verifies bank and enters ₹7,900.

Show:

`₹300 unaccounted`

Actions:

- Find transaction
- Add manually
- Ignore

Do not fabricate the missing transaction.

## Merchant learning

When users repeatedly correct a merchant/category mapping, store user-specific mapping locally.

Do not assume a merchant always belongs to one category across all users.

## Recurring detection

Only surface recurring expenses after enough evidence exists.

Allow correction.

## Refund matching

Match refunds to original expenses where possible.

Net spending should remain correct.

## Counterparty/obligation matching

When an incoming payment matches an outstanding obligation, propose settlement rather than creating income.

## Source permissions

Do not assume platform permissions or policy compliance are automatic. Implement source adapters so ingestion can be enabled/disabled based on what the device and distribution environment allow.

## Test corpus requirement

Create a local synthetic/adversarial corpus containing at least:

- duplicate SMS
- SMS + notification duplicates
- same amount different merchants
- same merchant different payments
- failed then successful UPI
- pending then completed
- refund
- partial refund
- self-transfer
- pass-through transfer
- loan
- repayment
- reimbursement
- bill split
- cash transaction not observed
- unknown merchant
- malformed SMS
- missing amount
- missing counterparty
- multiple accounts
- recurring payment
- fee/tax

## Acceptance tests

The engine must:

- avoid common duplicate insertions,
- avoid turning transfers into expenses,
- match lifecycle events correctly,
- handle refunds,
- preserve unknown transactions for review,
- and recover gracefully when parsing fails.

No automatic-ingestion feature may compromise the canonical ledger.

## Out of scope

- cloud sync
- server-side transaction storage
- investment recommendations
- online account aggregation
