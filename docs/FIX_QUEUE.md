# Fix queue

Fixes waiting to be batched into one build. The user asked (2026-09-24) to let them queue up
rather than ship one at a time. Tick them off as they land and note the version.

- [ ] **"Set aside" looks high next to "saved."** `protectedMoney` on Today (0.9.14 onwards) reads
      larger than the amount saved toward goals. Check what it adds up (goal reserve, outing
      reserves, plan/SIP reserve, cushion). It may be a real double count, or it may only need a
      clearer label. First flagged in the 0.9.14 pass.

## Redesigns (need the user's input first)

Before building either one, ask the user what they want (MCQ with mock-ups). Don't design them blind.

- [ ] **Redesign the cushion.** The emergency-cushion goal (`getCushionGoalId`, the payday plan's
      CUSHION slice) and how it is presented.
- [ ] **Redesign the savings bar.** How savings progress is drawn (the goal jars and progress bars
      on Plans and Savings), using the user's input.

## Features

- [ ] **Biometrics to see the bank balance.** Hide the balance by default and reveal it with a
      fingerprint or face unlock. This is separate from the whole-app lock added in 0.9.17
      (`LockGate`), so reuse its biometric code. Things to decide with the user: which figures
      are hidden (only the bank balance, or net worth too), and how long a reveal lasts.
