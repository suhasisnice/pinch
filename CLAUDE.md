# Pinch — Claude Code working agreement

## Project

Offline-first personal finance app for Indian college students, Android-only.
Expo 57 / React Native 0.86 / React 19 / TypeScript 6, `expo-sqlite` with SQLCipher
for storage, plus a custom native module (`modules/pinch-capture`) that captures SMS
and notifications on-device.

An **existing app being rehauled**, not a greenfield build. Read before rewriting.

To find a file, read `docs/CODEMAP.md` (can be stale; the code wins) or run
`graphify query "<question>"` before searching the tree. Local-model helpers: `docs/LOCAL_MODEL.md`.

## Team: hand work down, first match wins

Labour goes to helpers, smart work stays with Claude (Pro): design, money logic, protected code,
hard bugs, and the final say on what gets committed. Hand labour down first; do it myself only
after a helper failed twice (second try with a narrower prompt), and say so.
Protected (Claude only): `src/math`, `src/db` (incl. migrations), capture/parser/classification
services, money services, `smsPrivacy`, `src/security`, `modules/pinch-capture`, backup/erase.
Helpers never commit or push. Copilot is parked until Copilot Student activates.

The two labour workers:
- **Antigravity** (`agy`, Gemini 3.1 Pro on the student plan): the stronger one. Headless it reads
  and edits files but can run NO shell command (every command is auto-denied), so tell it
  "use only your file tools". The user may also iterate with `agy` directly; then I review the diff.
- **Free worker** (`scripts/free.js`: Claude Code on the first free Gemini that answers): weaker and
  sometimes out of quota, but runs git and the test scripts; protected paths are denied by rule.

| Job | Call | If it fails |
|---|---|---|
| Real SMS, phone logs, user data | `npm run llm -- log -` (local) | do it myself; never send it out |
| Edit screens, components, copy, tests, docs outside protected code | `npm run gem:edit -- "<task>"` | `npm run free:edit -- "<task>"` |
| Labour that needs git or tests (check a change, find a failing test, trace history) | `npm run free -- "<task>"` | `npm run gem -- "<task>"` with files I name |
| Review a diff before commit | `npm run review` (free worker runs git itself) | `npm run review:quick` (diff to Gemini, no tools), else `/code-review` |
| Read or explain a lot of code, second opinion | `npm run gem -- "<task>"` (read-only) | `npm run free -- "<task>"` |
| Quick, low-stakes answer only (summary, commit explainer, brief) | `npm run llm -- <job> --cloud` | same job without `--cloud` |

Free models (quota resets daily; spikes pass in minutes) and helpers are slow (20s-3min), so run
them in the background and keep thinking. One editor at a time: before a helper edits, note
`git status`; after, read `git diff --name-only`. A change inside protected code is reverted and
redone by me. Then `test:q` + `typecheck`, then `review`; I decide what is committed.
Helper output is a draft, never trusted blind.

## Specification hierarchy

1. `docs/PRODUCT_SPEC.md` — product behaviour, financial rules, architecture, data model.
2. `docs/DESIGN_DIRECTION.md` (user-chosen, overrides 3 where they conflict).
3. `docs/SPOTIFY_FINANCE_UI_PROMPT.md` — visual language, typography, components, motion.
4. `docs/phases/PHASE_X_*.md` — scope and acceptance criteria per phase.

Higher wins on conflict. Never silently pick a side: state the conflict, follow
the higher document, and report it.

## Current state

All ten phases (0–10) are complete; each has its doc under `docs/phases/`. Later
user-chosen releases (0.9.14–0.9.24) are in `docs/DESIGN_DIRECTION.md`,
`docs/INTERVENTIONS.md`, `docs/WEALTH.md`, `docs/CATEGORISER_REHAUL.md`. Pending
fixes are batched in `docs/FIX_QUEUE.md`. Wait for the user's next instruction.

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
  merged, rejected or superseded. A personal SMS is never raw evidence: it is dropped before storage
  (Play's SMS policy, DPDP data minimisation), and OTP codes are masked.
- The database is opened once per JS runtime (`src/db/expoAdapter.ts`).

## Offline-first

No backend, no account, no network for anything core. All calculation and
storage is on-device. Future external sources go behind a source-adapter interface.

## UI rules

- Design tokens only (`src/theme/theme.ts`). No literal colours, sizes or radii in screens.
  No MD3 role names (`primary`/`secondaryContainer`/…), no fourth surface step.
- Build the reusable component, not a one-off. Shared kit lives in `src/components/ui.tsx`.
- Lists and hierarchy over a card per row. No boxes, no giant FABs, gradients, glassmorphism,
  rainbow charts, decorative motion or fake scores. Thin huge numerals; one outlined
  sentence-case action per screen. Copy is witty but kind.
- Four tabs: Today / Plans / Wealth / People. Each owns one hero *shape*
  (`src/components/Heroes.tsx`): Today a centred ring, Plans the figure alone (no jars),
  Wealth a chart, People faces. Don't give a tab another tab's hero.
- Colour speaks: healthy and money-in are `palette.good` green; each category has a dot;
  each tab has a hue. Pick via `accentForState` / `amountColor` / `categoryColor` / `place`,
  never a literal. The coral accent is used rarely.
- Feel layer: `haptics.ts`, the press scale in `ui.tsx`, `Moment.tsx`. Transitions 150–220ms.
- Interventions (recovery missions, caps, heads-ups): maths in `src/math/{recovery,patterns,riskWindows}.ts`,
  glue in `src/services/interventionService.ts`, copy in `src/notifications/roasts.ts`.
  Roast the spending, never the person.
- Categoriser: 13 categories plus sub-categories; source is USER, SURE or GUESS; people are
  learned per payee, never from their name's words; matching is whole-word only.

## Reuse / refactor / rebuild

Classify before touching: KEEP, REFACTOR, REBUILD, REMOVE, UNKNOWN.
Do not delete code because a rewrite looks cleaner. Do not preserve bad
architecture because it already exists.

## Testing

- `npm test` and `npm run typecheck` must both be green before work is done.
  Use `npm run test:q` (summary only) to keep output small; full `npm test` only to debug a failure.
- Tests run real SQL via `tests/utils/sqljsAdapter.ts` (same `DbAdapter` surface as on-device).
- Financial logic needs concrete edge cases — shared bill, loan, partial repayment,
  self-transfer, refund, failed payment — not just happy paths.
- Schema changes are forward-only migrations in `src/db/migrations.ts`, keyed on
  `user_version`. Never edit a shipped migration; add the next one.
- tsconfig targets Metro (`moduleResolution: bundler`); `jest.config.js` overrides it
  to CommonJS for ts-jest. Keep that override.
- Privacy rules with tests: only financial SMS are stored (`FinancialSms.kt` + `smsPrivacy.ts`),
  OTPs are masked, and "Erase everything" leaves no personal table with rows
  (`tests/backup.test.ts`). See `docs/PLAY_READINESS.md`.
- No `tsx`/`ts-node`. To run ad-hoc TypeScript, write it as a jest test.
- Builds: `npm run aab` (private Play upload key), `npm run apk` (debug-signed).

## Phase boundary rule

Implement only the phase or fix explicitly requested. When done: run the checks,
summarise what changed, report what is still broken, then stop with:

`STOPPED AT PHASE BOUNDARY — waiting for next instruction.`
