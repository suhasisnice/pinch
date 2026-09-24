# Simplify pass — fewer words, clear segments

Shipped in 0.9.10. 667/667 tests, typecheck clean. Not visually verified
(no emulator) — check on the phone.

## Research

- **People read about a fifth of the words on a screen.** Cut anything that
  doesn't change what the user does; aim for short sentences and scannable
  copy. ([UX Writing Hub](https://uxwritinghub.com/3-microcopy-rules-every-ux-writer-must-know/),
  [Toptal](https://www.toptal.com/designers/ui/microcopy))
- **Things inside a shared boundary read as one group** (common region). It's
  the strongest grouping cue, stronger than spacing alone.
  ([NN/g common region](https://www.nngroup.com/articles/common-region/),
  [NN/g proximity](https://www.nngroup.com/articles/gestalt-proximity/))
- **Progressive disclosure:** show the key figure; put the reasoning one tap
  away. ([NN/g](https://www.nngroup.com/articles/progressive-disclosure/))

## Diagnosis

The previous pass removed card-per-concept boxes (correctly — the spec rules
out a card per row), but put nothing in their place. Insights and Today became
one continuous scroll of headings and rows: the "one big mush". On top of
that, most explanations were printed in full for everyone.

## What changed

- **`Group`** (in `ui.tsx`): a section heading on the page, its rows together
  on one surface, hairlines between rows, and an optional one-line footer.
  A surface per *section*, never per row. Used on Insights (every section),
  Today (today's spending) and Settings (everything).
- **Settings** was 14 stacked cards of buttons and paragraphs. It's now
  grouped lists: Budget, shortcuts, Automatic capture, Messages, Blocked
  senders, Not counted, Notifications, Start over. Actions are rows with a
  chevron, not a stack of full-width buttons.
- **Copy:** 2,626 → 2,158 words across screens and sheets, and 77 → 49
  strings of 12+ words (measured by script over the JSX; the Insights finding
  text in `math/insightsSummary.ts` is on top of that and was roughly halved).
  Every figure the tests check is still there.

Tried and dropped: an "Explain" disclosure toggle. After the cuts, no
explanation was long enough to need hiding, so it would have been one more
control.
