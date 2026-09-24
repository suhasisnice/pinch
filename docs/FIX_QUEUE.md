# Fix queue

Fixes waiting to be batched into one build. The user asked (2026-09-24) to let them queue up
rather than ship one at a time. Tick them off as they land and note the version.

- [ ] **"Set aside" looks high next to "saved."** `protectedMoney` on Today (0.9.14 onwards) reads
      larger than the amount saved toward goals. Check what it adds up (goal reserve, outing
      reserves, plan/SIP reserve, cushion). It may be a real double count, or it may only need a
      clearer label. First flagged in the 0.9.14 pass.
