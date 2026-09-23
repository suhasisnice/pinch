# UI refinement pass — less generated, more decided

Status doc for this pass. Updated at each milestone so nothing is lost if the
conversation is compacted.

## Status

| Milestone | State |
|---|---|
| 1. Research + audit + plan (this doc) | done |
| 2. System-level refinements (tokens, kit, money typography) | done — 653/653 tests, typecheck clean. `Money.tsx` (MoneyAmount, used by AnimatedMoney), U+2212 minus in formatMoney, TABULAR on type tiers, spacing.gutter 20 + 24px section gap, no card shadow, Field focus ring, typographic EmptyState, SectionHeader + Divider, tab bar pill removed, 22 uppercase eyebrows → typography.sectionLabel, heroLabel sentence case |
| 3. Today hierarchy | done — hero first, uncarded, left-aligned 48px; review banner icon chevron; Today's spending as a SectionHeader section; sentence-case microcopy. 653/653, typecheck clean. Not visually verified (no emulator) |
| 4. Verify (tests, typecheck), commit, build 0.9.8, copy to phone keeping old APKs | done — commit dae8423, 653/653, typecheck clean; fast path (no prebuild) built in 1m46s, `Pinch-0.9.8.apk` (27.9 MB) copied to Download; 0.9.7 left in place |

Queued after this pass (not part of it): Insights restructure — see memory
`pinch-work-queue` (approved items 1, 2, 6).

## What the research says makes UI look AI-generated

Sources agree closely. The tells are not ugliness — they are the *absence of
decisions*:

- **Default typeface, no typographic decisions.** Called "the single
  highest-leverage move against slop" ([Mania](https://www.mania.design/blog/spot-the-slop-a-ui-designers-guide-to-fixing-ai-defaults/), [925 Studios](https://www.925studios.co/blog/ai-slop-design-tells)).
- **Uniform spacing and radius everywhere** — the same 16px padding and
  corner on every box ([Mania](https://www.mania.design/blog/spot-the-slop-a-ui-designers-guide-to-fixing-ai-defaults/)).
- **A grid of near-identical cards**; the same screen repeated with different
  labels ([Superdesign](https://superdesign.dev/blog/why-ai-design-looks-generic), [SaaS UI](https://www.saasui.design/blog/saas-ui-looks-ai-generated)).
- **No single winner on the screen.** "Decide what the single most important
  thing on the screen is and let it visually win" ([SaaS UI](https://www.saasui.design/blog/saas-ui-looks-ai-generated)).
- **Generic thin-line icons, icon-in-a-tinted-circle empty states.**
- **Decorative colour** instead of colour that means something.
- **Weightless or inconsistent copy.**

What crafted finance apps do instead: money typography with tabular figures
([fintech typography](https://medium.com/design-bootcamp/the-elements-of-fintech-typography-part-1-readable-money-b6c1226acbde));
a quiet dark canvas where only data is bright, surfaces separated by tone not
borders or shadows ([Copilot Money](https://blakecrosley.com/guides/design/copilot-money));
dense, tightly spaced lists on near-black ([Spotify Encore](https://blakecrosley.com/guides/design/spotify)).

## Spec check (the spec outranks the research)

`SPOTIFY_FINANCE_UI_PROMPT.md` says **"Use a modern system sans-serif with
excellent number rendering."** The research's #1 fix — bundling a custom
typeface — therefore conflicts with the spec. Following the spec: system font
kept, "excellent number rendering" done properly (tabular figures, a money
component). A custom font is left as a decision for the user.

The spec also requires things the app does not currently do:

- **Page padding 20–24px** — app uses 16. Violation.
- **Prefer contrast between surfaces over shadows** — every card carries an
  MD3 drop shadow that is invisible on #121212 and only muddies edges.
- **Cards for grouped concepts, not every row / "Are there unnecessary cards?"**
- Named components `MoneyAmount`, `SectionHeader`, `Divider` — none exist.

## Audit — measured

| Tell | Where | Count |
|---|---|---|
| No custom font, no tabular figures | everywhere | 0 uses of `tabular-nums` |
| Negative money as hyphen `-₹` | `formatMoney`, `formatMoneyCompact` | screens hand-type `−` alongside it — two different minus signs |
| Card per concept | Insights 24, Settings 14, Today 9, Split 5 | |
| Uppercase letter-spaced micro labels | 26 sites | spec only mandates uppercase for **button** labels |
| Drop shadows on cards | `Card` (all) | |
| MD3 underlined text field | `Field` (all forms) | |
| Icon in green circle empty state | `EmptyState` | |
| MD3 pill behind active tab | tab bar | |
| Text glyph `›` used as a chevron | Today review banner | |
| Emoji + "bestie 💀" notification voice | `notifications/messages.ts` | 14 lines |

### Today (first screen, most seconds)

The code comment calls "Safe to spend today" *the number — everything else
explains it*, but it is the **third** box on screen, after Balance and
Available budget, and boxed like everything else. Hierarchy is inverted.
Copy switches voice between sentence case and lowercase ("tap to see how
this is worked out", "over. tomorrow resets.").

## Plan for this pass

System level (reaches every screen):

1. **Tabular figures** on every money/number type tier. Correction to the
   audit: Android's Roboto already draws equal-width digits, so this is not
   a visible change today — it keeps amounts aligned if a custom typeface is
   ever adopted (most have proportional figures by default).
2. **`MoneyAmount`** — the rupee sign set smaller and lighter than the digits,
   a true minus (−), used for hero figures.
3. **One minus sign** — `formatMoney`/`formatMoneyCompact` emit U+2212.
4. **Page gutter 20px, 24px between sections** (spec); related things stay 8px apart.
5. **No card shadows** — surface tone only (spec).
6. **Sentence-case section labels**, weight for hierarchy instead of tracking
   and capitals. Button labels stay uppercase (spec-mandated).
7. **Field** — softly rounded filled input with a focus ring, replacing the
   MD3 underline.
8. **EmptyState** — typographic; no icon-in-a-green-circle.
9. **Tab bar** — no MD3 pill; active is the accent icon + white label.

Today:

10. **Safe to spend today first**, out of its card, on the background with
    room around it — the one thing that wins the screen.
11. One voice in the microcopy; the icon chevron instead of `›`.

Delivery:

12. `copy-to-phone.ps1` stops deleting older APKs (user request); bump to 0.9.8.

## Decisions left to the user

- **Custom typeface** (spec says system sans). If wanted, candidates with
  tabular figures and a Circular-like feel that are *not* the overused AI
  defaults (Inter, Geist, Space Grotesk, Plus Jakarta): Figtree, Manrope,
  Hanken Grotesk. Costs one dependency and a clean prebuild.
- **Notification voice.** 14 messages use "bestie", "rn", 💀 😭 💅. Research
  flags forced-relatable copy as a generated tell; it may also be exactly the
  voice you want for students. Not changed.
- **Insights** card count (24) is handled by the queued Insights restructure.
- **Settings** (14 cards) — grouping into a sectioned list is a good next pass.
