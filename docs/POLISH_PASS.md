# Polish pass (0.9.25)

The user asked on 2026-09-29 for three things, done overnight without check-ins ("finish the entire
task and get back to me"):

1. Make Insights more interactive, and visually appealing yet simple.
2. Rename things and re-assign symbols so the app stops looking vibe-coded.
3. Give the whole app depth with aesthetic touches, without overdoing it.

## 1. Insights you touch

**Before:** a long static list. It had ten category bars in ten colours (a rainbow), a daily pace
chart you could only look at, a months chart, and a recap card taking a row of its own.

**Idea:** every chart becomes a *scrub*, the way a stocks app works. You press and slide, the piece
under your finger lights up, a haptic tick marks each step, and a readout above says what it is.
Colour is only for the piece you are pointing at; the rest stay ink. So a chart is quiet until you ask
it something.

The new shared kit is in `src/components/Charts.tsx`:

- `ScrubBars`: vertical bars you can scrub. The selected bar is lit, and a bar can carry its own colour
  (amber for a day over the limit). It can draw a hairline at a limit and put labels or edge labels
  underneath.
- `ShareStrip`: one strip split by share, like a storage bar. Only the selected segment wears its
  category colour.
- `Readout`: the name, then the figure (thin, display size), then one short note.
- Screen readers get it too: each chart is `adjustable`, so a swipe up or down steps through the
  pieces, and the readout is a polite live region.
- Scrubbing takes a sideways drag only. A drag that starts upward still scrolls the page.
- `haptic.scrub()` is the lightest system tick (`Segment_Frequent_Tick`).

The new Insights layout, from the top:

| Section | What changed |
|---|---|
| TopBar | "Last week" (play icon) is the screen's one action. It replaces the recap card row. |
| Hero | Unchanged, plus a faint glow in the verdict's colour. |
| Noticed | Was "Worth knowing"; still up to three findings. |
| Daily | A scrubbable bar per day of the period. Quiet days now show as ₹0 bars instead of being skipped. The readout says "Today · ₹60 · inside the limit". The header toggles **By weekday**: seven bars, Mon–Sun, opening on your priciest day ("Tuesdays, your priciest day · on average"). The pace rows follow the chart. |
| Categories | Was "Where it went". There is one `ShareStrip` plus a readout ("Shopping · ₹2,198 · 26% of your ₹8,390"). Below it are the top five rows with category dots, and "N more" to expand. What you paid is still struck through where a bill was shared. |
| Months | Six scrubbable bars, current month selected. The current month keeps its faster/slower verdict. A past month says how far above or below usual it was. The category shifts follow the chart. |
| Recurring | Was "Every month". The content is unchanged. |

## 2. Names and symbols

**What read as vibe-coded:**

- Two icon families mixed together (Feather and Material Community Icons), at different weights.
- Cliché glyphs: a party popper, fire, a ghost, sparkles.
- A cute headline on every section ("The habit", "Small change, big number", "Been there").

**The rule now:** a section title is a plain label. The wit lives in the sentence under it, where it
has room to land.

**Icons:** there is now one set, Lucide outline, drawn at a 1.75 stroke through `react-native-svg`
(ISC licence, with the path data inlined in `Icon.tsx`). No icon font ships any more.

- Today's tab icon is custom: the open ring of its own hero.
- Glyphs nothing used were removed: delete, refresh, whatsapp, send, archive, error, streak, flat,
  moon, receipt, sparkle, and every category glyph (categories are dots).
- Goal and outing label keys are stored in the DB `emoji` column, so the **keys stayed the same** and
  only the drawings changed. Old rows still resolve.

| Name | Lucide glyph | Name | Lucide glyph |
|---|---|---|---|
| today | custom open ring | goals | flag |
| outings | map-pin | squad | users-round |
| insights | chart-no-axes-column | savings | vault |
| warning | triangle-alert | ghost | eye-off |
| split | split | contacts | contact-round |
| party | party-popper | beach | tree-palm |
| movie | clapperboard | concert | mic-vocal |
| hike | mountain | bowling | gamepad-2 |
| cricket | trophy | road | car |
| phone | smartphone | shoes | footprints |
| book | book-open | | |

**Renames:**

| Where | Before | After |
|---|---|---|
| Wealth | The habit | Saving rate |
| Wealth | Small change, big number | In ten years |
| Wealth | The ladder | Ladder |
| Wealth | If you leave it alone | Projection |
| Wealth sheet | The cushion | Cushion |
| Wealth TopBar | "Your split" with a **+** | a pencil (or a vault for "Pay yourself first") |
| Outings | Start one / Start an outing | New outing |
| Outings | Been there | Past |
| Today | The month | This month |
| Insights | Worth knowing / Your pace / Where it went / Against normal / Every month | Noticed / Daily / Categories / Months / Recurring |

## 3. Depth, lightly

Each touch has one job, and none of them moves:

- **`Glow`** (in `ui.tsx`): a wide radial light at about 12% opacity behind each hero, fading to
  nothing, in the tab's hue: Plans violet, Wealth teal, People blue. Insights uses the verdict's
  colour. Today keeps the ring's own glow.
- **Wealth chart:** the area under the line fades from 24% to 0 at the floor, where it used to be a
  flat 10% fill.
- **Lit edges:** the outlined button has a slightly brighter top border and a 3% ink wash, like a key
  lit from above. The sheet's top edge catches the same light, so it reads as lifted off the page.
- **People faces:** "owes you" is now a green ring over a faint green wash. It used to be a solid
  green disc, the loudest thing on the tab. "You owe" stays an amber ring.

Things considered and left out: blur (`expo-blur` is installed but stays unused), drop shadows (they
are invisible on near-black), animated glows, and a tab-bar highlight.

## Conflicts, stated

- `DESIGN_DIRECTION.md` says the glow is on the Today ring *only* and is "the one gradient in the
  app". The user's request for depth across the whole app is newer, so it wins. Heroes now carry a
  faint glow, and the Wealth chart has a fading fill. `DESIGN_DIRECTION.md` has been updated.

## How it was done

- Protected code was not touched, and there are no DB, math or migration changes.
- Labour went to helpers first. Antigravity did the Wealth renames, then hit its weekly quota. The free
  worker failed twice (the `OMNIROUTE_KEY` variable wasn't in this shell, then "unrecognized_model"
  for `gemini-3.6-flash`). The remaining five string edits were done by Claude.
- Checks: `npm run typecheck` is clean, `npm run test:q` passes 898 of 898, and preview shots of all
  four tabs plus Insights were checked by eye.

## Found, not fixed

- `compareMonths` compares months per *active* day, and projects the month by multiplying that by 30.
  Logged in `FIX_QUEUE.md`.
