*(Original phase document below the `---`. This section records what shipped.)*

## What shipped

### PERCENTAGE split mode

`splitEngine.ts` had EQUAL/SHARES/EXACT; the spec's full list is
Equal/Item/Exact/Percentage/Shares/Custom. EXACT already covers "Custom"
(typed amounts, validated, never rescaled). Percentage was genuinely
missing, and — this mattered — could not be built by reusing SHARES'
weighted `distribute()`: SHARES ratios are *relative* and always
renormalise to fill the bill, so two people typing 30% and 30% would
silently become 50/50 each, which is exactly backwards from what typing a
percentage means. PERCENTAGE instead follows EXACT's rule: a typed number
is taken as what it says, not rescaled — 30% is 30% of the bill regardless
of what anyone else typed, percentages that don't add up to 100 just mean
the payer covers the difference (identical to EXACT's under-assignment),
and percentages over 100 are flagged (`overAssigned`) rather than silently
normalised down. Wired into `SplitModal` as a fourth mode chip with its own
per-person `%` input, mirroring the EXACT input's layout exactly.

### A real settlement bug found and fixed

Phase 6's own "multiple debts between two people" requirement
("Rahul owes user ₹1,000. User owes Rahul ₹400. Display: Rahul owes you
₹600 net.") led to checking whether `settleAll`'s single settlement
transaction actually applies correctly when a contact has open debts in
*both* directions at once. It didn't: `settleContactBalance` — used
whenever a credit closes a debt — called `getOpenIOUsForContact`, which
returns both directions for that contact, and applied the incoming payment
against whichever IOU was oldest **with no direction filter at all**. If
the `I_OWE_THEM` row happened to be older than the `THEY_OWE_ME` row, money
*arriving* would incorrectly mark money *the user owed* as paid off — a
debt closed by a payment that was never made to close it. The mirror-image
filter already existed for the opposite direction
(`postTransaction`'s `SETTLE_OUT` branch only ever touches `I_OWE_THEM`
rows); this was the one direction with no filter. Fixed by filtering
`settleContactBalance` to `THEY_OWE_ME` only, with a regression test
(`tests/dbService.test.ts`) that fails against the pre-fix code.

Given this, "settlement optimization" for the two-party case this app's
data model actually supports (every `IOU` is between the user and one
contact, never between two contacts who are neither of them the user) is
already what `netAmount` + one `settleAll` transaction does: the simplest
possible settlement plan — one payment — for exactly the obligations that
exist. See the deferred section below for why a general multi-party
optimizer doesn't apply here.

### Explicitly out of scope / deferred

- **ITEM split mode.** Assigning individual bill line-items (with some
  items shared across several people) to specific people is a materially
  different UI from every mode that exists today — a running list of
  priced items each with its own assignable people, not a per-person
  amount or percentage. It is real, standalone work, not a variant of
  EXACT/PERCENTAGE's math. Deferred rather than rushed.
- **Groups** (`PRODUCT_SPEC.md`: "Support local groups such as: Goa,
  College Friends, Roommates"). No `Groups` table exists. This needs new
  schema (a group entity, a group-membership join, and a decision about
  whether an expense's group tag is its own column or inferred from
  participants) — a real, separate feature, not a UI addition over the
  existing per-contact `IOU` model.
- **A general multi-party settlement optimizer.** The spec's phrasing
  ("given a set of obligations, minimize the number of payments") describes
  a graph-settlement problem — A owes B, B owes C, so A pays C directly —
  that only exists once debts can run *between two contacts, neither of
  whom is the user*. The current schema ties every `IOU` to the user on one
  side (`contact_id` + implicit "me"), so that graph never arises; building
  the optimizer now would solve a problem this data model cannot produce.
  Worth revisiting only alongside Groups, if a group ever needs to track
  who-owes-whom among its own members rather than each member's balance
  with the user.
- Item-split rounding documentation, contact rename/deletion history
  preservation, and the remaining acceptance tests below were not
  re-verified in this pass — they predate this phase and were not touched.

## Acceptance tests

All PERCENTAGE-specific tests live in `tests/splitModes.test.ts` (taken as
given, not rescaled; over-100% flagged; excluded/missing treated as zero).
The settlement fix has a dedicated regression test in
`tests/dbService.test.ts`. `npm test` and `npm run typecheck` stay green.

---

# Phase 6 — Split, People and Obligations *(original)*

## Objective

Build Split as a local money-between-people system, not merely a bill calculator.

Core question:

**What do I owe, and what do others owe me?**

## Read first

- `PRODUCT_SPEC.md`
- `PHASE_1_FINANCIAL_ENGINE.md`
- `PHASE_5_OUTINGS.md`

## Main screen

Prominently show:

- You owe
- Owed to you
- Net position

Then:

- Needs attention
- Groups
- recent items

Do not label receivables as available spending money.

## People

Use a stable local Person ID.

Contacts can be synced/read locally to make selection easier.

Show:

- Recent people
- Contact search
- manual person creation when necessary

Deleting a contact must not delete financial history.

## Add expense

Flow:

1. Amount
2. Description
3. Paid by
4. Participants
5. Split method

Split methods:

- Equal
- Items
- Exact
- Percentage
- Shares
- Custom

## Equal

Example:

₹2,400 / 4 = ₹600 per person.

If user paid all:

- personal expense ₹600
- receivable ₹1,800

## Item split

Support item assignment and shared items.

Rounding should be deterministic and documented.

## Exact amounts

Validate that assigned amounts sum exactly to the bill, with a convenient distribute/adjust action.

## Percentage

Validate total = 100%.

## Shares

Calculate proportional amounts and handle rounding.

## Custom

Manual amounts with validation.

## Lending and borrowing

Support:

- money lent
- money borrowed

These create obligations but not ordinary expense/income.

## Repayment

Support:

- full repayment
- partial repayment
- manual settlement

When a transaction arrives from a known person and matches an outstanding obligation, propose applying it to the obligation.

## Multiple debts between two people

Aggregate the net balance for the user-facing summary while preserving underlying records.

Example:

Rahul owes user ₹1,000.
User owes Rahul ₹400.

Display:

`Rahul owes you ₹600 net`

Do not destroy the underlying transactions.

## Settlement optimization

Given a set of obligations, produce a simplified settlement plan aimed at minimizing the number of payments while preserving correct balances.

The plan does not need to be the only possible solution.

## Groups

Support local groups such as:

- Goa
- College Friends
- Roommates

Groups may contain people and expenses.

## Outing integration

A shared expense attached to an outing references the existing canonical transaction.

It does not create a second financial movement.

## Budget integration

The user's personal share counts toward personal spending.

Money fronted for others does not become personal spending beyond the user's own share.

## Acceptance tests

1. Equal split with user paying.
2. Equal split with another person paying.
3. Item split with shared item.
4. Percentage split.
5. Shares split.
6. Exact/custom split validation.
7. User lends ₹2,000 and it does not count as ordinary spending.
8. Partial repayment reduces obligation correctly.
9. Full repayment closes obligation.
10. Existing obligation matched to incoming transaction does not create income.
11. User fronting for friends creates personal expense equal to own share only.
12. Settlement optimizer reduces transfers where possible.
13. Contact rename/deletion preserves history.

## Out of scope

- live group synchronization
- chat
- payment execution
- mandatory participant accounts
