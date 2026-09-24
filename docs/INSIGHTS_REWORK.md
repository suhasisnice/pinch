# Insights rework — an answer, then the evidence

Status: built in 0.9.9. 667/667 tests, typecheck clean. Not visually verified
(no emulator) — check on the phone.

## What the research said

Reddit could not be read (blocked for both search and the browser in this
environment), so user voice comes from reviews, Hacker News and the Monzo
community forum instead.

- **Charts of the past don't change anything.** "A pie chart of last month's
  damage is an autopsy, not an intervention"; information without a next step
  creates anxiety instead of clarity. Show the forward number and what to do.
  ([Beaverise](https://beaverise.com/blog/why-budgeting-apps-dont-work),
  [SpendTrak](https://spendtrak.app/blog/why-people-quit-budgeting-apps))
- **Users ask for a projection from spending velocity**, money in vs out, and
  vendors/categories ranked — not more chart types.
  ([Monzo community](https://community.monzo.com/t/better-spending-insights/27909))
- **Tools that try to do too much** instead of making the basics effortless
  get abandoned. ([HN](https://news.ycombinator.com/item?id=46566663))
- **A number means more with its context beside it** than as a standalone
  chart card (Tufte's word-sized graphics).
  ([Tufte](https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/))
- Copilot's month review works because it's a short, high-level read, not a
  wall of widgets. ([Copilot help](https://help.copilot.money/en/articles/10310024-month-and-year-in-review))
- Generic templated copy reads as robotic; specific figures in plain words
  read as written by someone. ([PushPilot](https://pushpilot.ai/blog/fintech-push-notification-strategy))

## What changed

| Before | After |
|---|---|
| 11 cards of equal weight | 1 uncarded hero + 5 sections, no cards |
| Projection was the **last** card, using mean of spend-days | Hero, first: "₹X left over on 30 Sep, at this pace" / "₹X short…" with the run-out date and the daily figure that fixes it. Pace is per **calendar** day since the first recorded day (the old per-spend-day mean overstated burn). |
| Findings card with "View X spending →" text links | "Worth knowing": top 3, hero's own findings removed so nothing is said twice, whole row tappable with a chevron |
| "By category" by paid, rainbow bars + separate "What you actually bore" card | "Where it went", ranked by **yours** (new `getCategoryCost`); paid shown struck-through beside it where others owed a share; one neutral bar with others' share as a grey tail |
| Three charts of the same spending (This week vs last, Daily spend, Your week) + Habits card | "Your pace": one daily chart with the limit line, then rows — last 7 days vs before, a normal day, heaviest weekday, small spends, after 11pm |
| Month by month + What changed (two cards) | "Against a normal month": one sentence, the bars (current month white, not green — green is state, not paint), movers as tappable rows |
| "This period you are: The Feeder" | Removed. `spendingPersonality` stays in `math/insights.ts`, unused. |
| "Biggest debtor" row | Removed — the Split tab owns who owes what. |

Also fixed: the period end label showed the exclusive end (1 Oct) rather
than the last day (30 Sep).
