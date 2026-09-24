# Design direction — Raycast ink (0.9.14)

The user chose this direction over three rounds of multiple-choice questions
on 2026-09-24, after saying the 0.9.12/0.9.13 UI looked "AI-generated" and
"not my style". Where it conflicts with `SPOTIFY_FINANCE_UI_PROMPT.md`, this
document wins. See the conflicts section below.

## 0.9.18 — colour that speaks, and a feel layer

The user, after using 0.9.17 on the phone: "it works but UI needs to be
tinkered with so I can feel the app", then "I want the UI colours to speak to
me a little". Chosen by MCQ on 2026-09-24. **This supersedes "Fine is not a
colour" below.** Colour now has four jobs, one each, all muted:

| Job | Colour | Where |
|---|---|---|
| How you're doing | green `good` → amber → red | Today's ring, its label, today's week bar, Today's tab icon |
| Money in vs out | in is green; out stays ink | every amount in a list, the detail sheet, Review, linked groups |
| What you spend on | the category hue, as an 8px dot | transaction rows (`Row mark`), Insights' category bars and shifts |
| Where you are | Plans violet, Wealth teal, People blue (`place`) | the hero label, jars, chart, Wealth's ticks, the active tab icon |

People's faces use the money colours (green for owed to you, amber for you owe),
not the tab hue: on that screen the colour is the news. Numerals stay ink.

Feel ("subtle, Linear-like"):

- **Press:** rows, chips and buttons scale slightly while held; a link's arrow leans 3px forward.
- **Haptics:** Android view haptics (`src/components/haptics.ts`), which follow the phone's touch-feedback setting.
  - A tick for tabs, chips and the Plans switch.
  - Toggle on/off for switches, and a key press for buttons.
  - Nothing on plain rows.
- **Motion:**
  - Tabs cross-fade (180ms).
  - Jars fill from the bottom, the chart draws left to right, and faces step in.
  - All of it happens once and is skipped with reduce-motion on.
- **Moments** (`src/components/Moment.tsx`): one line rises above the tab bar with a confirm haptic.
  - It fires for payday done, a goal fully funded, or a milestone.
  - It fires only on the change itself, never when you open a tab and find something already done (`src/math/moments.ts`).

## What made it feel AI-generated (the user's own diagnosis)

- Boxes everywhere: a card around every concept.
- Too much explaining: helper lines and subtitles under everything.
- A template layout: hero number, then a row of buttons, then a list.
- Coloured icon tiles and dots.

## The language

- **Palette: Raycast ink.**
  - `#0A0A0A` ground, `#141414` / `#1C1C1C` surfaces, `#FAFAFA` text.
  - One accent, coral `#FF6363`, used rarely.
- **Fine is not a colour.** A healthy state is white. Colour appears only when
  something needs attention (amber warning, red over) or on a small set of
  meaningful accents:
  - text links
  - the live-outing dot
  - round-ups switched on
  - today's bar in the week strip
- **Numbers are the heroes.**
  - Thin (weight 300) and huge, in the system sans.
  - Page titles use the same thin weight, so a page is named rather than announced.
- **One thing per screen.**
  - Each tab opens on one centred `Hero`: the number, a small label, one soft line, and a muted meta line.
  - Everything else is a scroll away.
- **Today:** a thin 3px ring around the number.
  - The ring empties as you spend: white when fine, amber when close, red when over.
  - It has a faint glow in its own colour. This is the one gradient in the app, and it is allowed because the colour is information.
- **No boxes.**
  - Sections are hairline-separated `Group`s under an overline label.
  - There are no card surfaces, icon tiles, avatars or category covers.
  - Quoted evidence, such as a raw SMS in Review, is a left hairline rather than a grey box.
- **Quiet actions.**
  - One outlined, small, sentence-case button per screen, in the `TopBar`.
  - There are no filled shouting pills or FABs.
  - Switches are white when on.
- **Voice: witty but kind, and short.**
  - "A little over, by ₹X. Tomorrow resets."
  - "You owe nobody. Rare."
  - Never explain what the screen is.
- **Three tabs.**
  - **Today.**
  - **Plans:** Saving and Going out, via an overline switch.
  - **People:** split.
  - Insights is reached from Today ("The long version").
- **Motion.** 150–220ms for transitions. The ring's 700ms fill is a one-off entrance, and it respects reduce-motion.

## Conflicts with `SPOTIFY_FINANCE_UI_PROMPT.md` (stated, not silent)

| Spotify spec | Now | Why |
| --- | --- | --- |
| Vibrant green accent | Coral `#FF6363`, used rarely; healthy states are white | The user rejected green, then terracotta, and chose Raycast ink |
| Five bottom tabs (`PRODUCT_SPEC.md` §2) | Three: Today / Plans / People | The user's explicit choice; Insights moves into a stack screen |
| No gradients | One subtle glow, on the Today ring only | The user said "Yes, subtly" |
| Bold typography, uppercase pill buttons | Thin numerals and titles; sentence-case outlined buttons | The user asked for "thin & huge" and "make it quieter" |
| Hero amount 32–42px | Hero at 64px; Today's ring numeral at 68px | A bigger number is the single most effective change |

`PRODUCT_SPEC.md` is higher than either UI document. Its five-tab list in §2
is a navigation decision that the user has overridden in this conversation.
That is recorded here, and the product spec should be amended if the user
confirms it as permanent. None of the financial rules or data model changed.

## 0.9.15: a fourth tab

Wealth was added as its own tab at the user's explicit request, so the app now has four tabs: Today / Plans / Wealth / People. The screen follows this language: a thin hero, hairline groups, one outlined action, and coral only on the current ladder rung. See `docs/WEALTH.md`.
