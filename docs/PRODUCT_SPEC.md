# College Budget Phone — Product Specification

## 0. Purpose

Build an offline-first personal-finance application designed around the financial reality of a college student living on an allowance.

The product is not merely an expense tracker. It continuously translates money movement into four practical questions:

1. How much money can I safely spend?
2. What future spending have I planned for?
3. What am I saving toward, and what can I realistically afford to save?
4. What money is currently owed between me and other people?

The fifth surface, Insights, explains patterns and helps the user make better decisions.

## 1. Core product principles

### 1.1 Bank balance is not spendable money

The user may have money in the bank that is reserved for savings, outings, bills, or other commitments.

`Bank balance >= available budget`

The app should clearly distinguish:

- Bank balance: actual reported/observed cash balance.
- Protected money: money reserved for future purposes.
- Available budget: money the user has chosen to make available for ordinary spending.
- Safe-to-spend amount: the portion of available budget that can reasonably be spent now while remaining on plan.

### 1.2 One underlying ledger

There is one canonical transaction ledger. Features enrich or reference transactions; they do not duplicate them.

A single real-world payment can simultaneously be:

- a cash movement,
- a personal expense,
- part of an outing,
- a shared expense,
- and the source of receivables.

### 1.3 Cash movement and financial meaning are separate

The system must distinguish:

- Expense
- Income
- Transfer
- Allocation
- Loan given
- Loan received
- Reimbursement
- Repayment
- Refund
- Investment contribution
- Withdrawal
- Fee
- Adjustment

### 1.4 Automatic when confident, ask when uncertain

Automatic ingestion should prioritize trust over fake completeness.

- High-confidence events may be recorded automatically.
- Ambiguous events go to a lightweight review queue.
- Failed or missing ingestion must be recoverable through manual entry/reconciliation.
- Never silently invent a transaction.

### 1.5 Offline-first

V1 requires no backend, account system, cloud database, or internet connection for core functionality.

All core calculations and storage happen locally.

Future external financial data sources may be added later behind a source-adapter interface, but are not required for V1.

### 1.6 User remains in control

The app can recommend allocations and changes, but should not silently change budgets, goals, or spending limits.

## 2. Main navigation

Bottom navigation has exactly five primary destinations:

1. Today
2. Outings
3. Savings
4. Split
5. Insights

No hamburger menu for core functionality.

## 3. Feature responsibilities

### Today

Question: **What can I safely spend today?**

### Outings

Question: **What future occasion am I preparing financially for?**

Outings are short/medium-term planned discretionary spending.

### Savings

Question: **What do I want to eventually afford, and what can I realistically save?**

### Split

Question: **What do I owe, and what do other people owe me?**

### Insights

Question: **Where is my money going, what changed, and what could I realistically improve?**

## 4. Financial concepts

### 4.1 Transaction

A canonical representation of a real-world financial movement.

### 4.2 Raw event

An observation from a source such as SMS, notification, or manual input. Multiple raw events may correspond to one canonical transaction.

### 4.3 Allocation

A local budgeting decision that earmarks existing money for a purpose. It does not itself change bank cash.

Examples:

- ₹2,000 allocated to Laptop savings goal.
- ₹1,000 reserved for Birthday outing.

### 4.4 Obligation

Money owed between people.

Examples:

- Rahul owes the user ₹600.
- User owes Rahul ₹600.

### 4.5 Expense

The portion of money attributable to the user's own consumption or giving.

Example:

₹2,400 restaurant bill; four equal participants; user paid all.

- Cash movement: -₹2,400
- Personal expense: ₹600
- Receivable: ₹1,800

## 5. Ledger rules

### Rule A — Self-transfer

Moving ₹1,000 from the user's HDFC account to their SBI account is not spending.

### Rule B — Loan

Sending ₹2,000 to Rahul as a loan is not an ordinary expense.

### Rule C — Repayment

Receiving ₹2,000 back from Rahul closes the loan; it is not ordinary income.

### Rule D — Borrowing

Receiving ₹2,000 borrowed from Rahul is not income.

### Rule E — Reimbursement

If the user paid ₹2,000 for a ₹500 personal share and ₹1,500 for others, only ₹500 counts as the user's expense.

### Rule F — Shared expense paid by someone else

If Rahul pays ₹2,400 for four people and the user owes ₹600, the user has a ₹600 expense but zero current bank cash movement.

### Rule G — Repaying a shared expense

Later paying Rahul ₹600 closes the obligation. It must not create another ₹600 expense.

### Rule H — Refund

A refund should link to the original expense where possible and reduce net expense rather than being presented as arbitrary income.

### Rule I — Failed payment

A failed payment should not count as completed spending.

### Rule J — Pending then completed

Pending and completed observations should resolve to one transaction lifecycle, not two expenses.

## 6. Budget model

The budget engine should be explicit and deterministic.

Conceptual relationship:

`Bank balance = available budget + protected money + unallocated/protected reserves`

The exact implementation may support additional states, but the user-facing concept must remain simple.

### Safe-to-spend today

A recommended amount based on:

- available budget remaining,
- days/time remaining in the relevant budget period,
- already-reserved outing money,
- savings commitments,
- fixed/known commitments,
- and configured buffer.

Do not simply divide bank balance by remaining days.

## 7. Local people/contact model

Contacts may be read locally to make it easier to add people.

A financial `Person` entity must have its own stable internal ID. Contact names/numbers are references, not the financial identity itself.

Deleting or renaming a device contact must not delete historical financial records.

People do not need accounts and do not need to install the app.

## 8. Design language

The visual reference is Spotify's dark, bold, premium design language, adapted to finance rather than music.

### Color direction

- Brand/accent green: `#1ed760`
- Page background: `#121212`
- Surface: `#181818`
- Elevated surface: `#1f1f1f`
- Primary text: `#ffffff`
- Secondary text: `#b3b3b3`
- Negative/error: `#f3727f`
- Warning: `#ffa42b`
- Informational: `#539df5`

Green is an accent, not a paint bucket. Do not make every component green.

### Typography

Use the platform's best available modern sans-serif with excellent numeral rendering. If a project font is already chosen, use it consistently.

Approximate scale:

- Screen title: 24–32px, semibold/bold
- Feature/metric: 18–24px
- Body: 15–16px
- Caption: 13–14px
- Micro/badge: 10–12px
- Large money amount: 32–44px depending on context

### Spacing

Use a consistent 8-point rhythm, with 24px default horizontal page padding.

### Radius

- Small controls: 6–8px
- Cards/surfaces: 8–16px
- Large bottom sheets/dialogs: 16–24px
- Pills: full radius
- Circular controls: 50%

### Elevation

Prefer surface contrast and subtle borders over heavy shadows. Use elevated surfaces selectively.

## 9. Design rules to avoid AI/vibe-coded aesthetics

Do not use:

- excessive gradients,
- excessive glassmorphism,
- giant rounded cards for every row,
- rainbow charts,
- random icon styles,
- emoji as primary app navigation icons,
- oversized floating action buttons,
- gratuitous shadows,
- excessive badges,
- generic dashboard grids,
- arbitrary AI/chat UI,
- fake financial scores,
- excessive animation,
- decorative UI without purpose.

The app should feel like one coherent product designed by one experienced product team.

## 10. Motion

Motion should communicate state change:

- transaction arrival,
- allocation movement,
- progress changes,
- debt settlement,
- page hierarchy.

Keep transitions subtle, generally 150–220ms for standard navigation/controls.

No excessive bounce, confetti, or decorative spring motion.

## 11. Data integrity

Never delete raw source events merely because they were merged. Keep raw evidence, parsed interpretation, and canonical transaction relationship information so the system can be debugged/reprocessed.

Do not duplicate canonical transactions across feature modules.

## 12. Testing philosophy

Every implementation phase must have deterministic acceptance tests.

A phase is complete only when:

1. Requirements are implemented.
2. Acceptance tests pass.
3. Existing functionality still works.
4. No unrelated features were added.
5. Edge cases are covered for that phase.
6. The UI remains consistent with the design system.

## 13. Out of scope for V1 unless explicitly added later

- Required online account/login
- Cloud sync
- Live group collaboration
- Social feed
- Chat
- Booking travel or restaurants
- Brokerage execution
- Automated investment recommendations
- Server-side AI dependence
- Mandatory UPI payment execution
- Mandatory installation by friends

## 14. Required repository documentation

The repository should maintain:

- `PRODUCT_SPEC.md`
- `PHASE_0_DESIGN_SYSTEM.md`
- `PHASE_1_FINANCIAL_ENGINE.md`
- `PHASE_2_MANUAL_TRANSACTIONS.md`
- `PHASE_3_TODAY.md`
- `PHASE_4_SAVINGS.md`
- `PHASE_5_OUTINGS.md`
- `PHASE_6_SPLIT.md`
- `PHASE_7_AUTO_INGESTION.md`
- `PHASE_8_INSIGHTS.md`
- `PHASE_9_INVESTMENTS.md`
- `PHASE_10_POLISH.md`

Claude Code must read the relevant phase document and `PRODUCT_SPEC.md` before modifying implementation for a phase.
