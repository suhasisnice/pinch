# UI rehaul (0.9.12)

Goal: take every screen from "works" to "looks finished" without changing a
single financial rule. No schema change, no migration, no new dependency in
the shipped app.

## How it was checked

There is no emulator here and the phone wasn't connected, so the app now also
runs in a browser for design review only (it never ships):

- `npm run preview` serves the real screens on :8090. Metro picks
  `App.web.tsx`, and `src/db/expoAdapter.web.ts` runs the real SQL on sql.js.
  The data is invented and comes from `src/dev/demoData.ts`.
- `npm run shoot -- today savings --h=1400` takes phone-sized screenshots into
  `.shots/` (gitignored). It uses headless Chrome/Edge with a throwaway
  profile.

Every screen below was shot before and after its change.

## System

- **Buttons.** Only the filled primary action is uppercase. The others are
  sentence case, and text/outlined buttons are white, not green. Danger
  buttons are red on muted red, so they read as live rather than disabled.
  Added a `size="small"` option.
- **ScreenTitle action.** The giant full-width green pill at the top of each
  tab ("Start an outing", "New goal", "Split a bill") is now a small tonal
  action beside the title.
- **Chips.** These are filled pills, green only when selected. `ChipRow`
  scrolls sideways instead of wrapping onto a second line.
- **New kit.** `SearchBar` (icon, no label), `Avatar` (initials for people),
  `StatPair` (two figures on one surface).
- **Icon tiles.** Rounded tiles instead of outlined blue circles.
- **Blue removed as paint.** Progress is green, amounts are white, and blue
  is left for information only.
- **Text.** The tiny bold grey "micro" text is replaced with regular captions
  everywhere except the tab bar and chart axes.
- **Headers.** Stack screens no longer repeat their title under the back
  arrow, and no longer inset the status bar twice (`Screen underHeader`).
- **Sheets.** The sheet's "Done" is quiet white, not a green uppercase label.

## Screens

- **Today** is laid out as:
  - Hero with the one note that changes its meaning: over today, *money
    lasts N days, not M*, or a streak. That note used to sit at the very
    bottom.
  - Add expense / Split a bill.
  - A compact "Payments to check" row.
  - A **This period** group:
    - Left this period, with a bar showing how much is gone.
    - In the bank (row, still hidden by default).
    - The balance-gap note, with a "Fix" action.
    - "Can I afford it?", which now opens `AffordSheet` instead of being a
      permanent card with an empty field.
  - Today's spending, with times instead of "3h ago". "For someone?" now
    only appears on spends of ₹200 or more.
- **Savings.**
  - "New goal" moves to the header.
  - The held-back figure is white.
  - Goal cards: status and pace merged into one line, green progress, and a
    small "Add money" button instead of a big "Add money or edit".
- **Outings.** "Start" moves to the header, section titles are readable, and
  bars are green.
- **Split.**
  - "Split a bill" moves to the header.
  - The two stat cards become one `StatPair`, coloured only when there is
    something to act on.
  - People show initials avatars and "Owes you / You owe / All square".
  - "Add a debt" is the list's action.
  - Dropped the "no track record yet" filler.
- **Transactions.**
  - Chips sit on one scrolling line.
  - Search bar replaces the labelled field.
  - Days read "Tue, 22 Sep" as grouped sections.
  - Rows show the time instead of the source.
  - **Bug fixed:** rows were grouped by the UTC date, so a payment made
    between midnight and 5:30 am IST was filed under the day before. They
    are now grouped by the phone's local day.
- **Review.**
  - Merchant and amount share a line, with income in green.
  - Confidence is a small tinted tag.
  - The sender is a name: "Google Pay", not
    `com.google.android.apps.nbu.paisa.user`. This uses the existing
    `PACKAGE_LABELS`, now exported as `senderLabel`.
  - "Not a payment" replaces the two-line "NOT A TRANSACTION".
- **Recap.** Pages are sized from the pager's own layout, not the window, so
  text is no longer cut off on foldables or in split screen.

## Not changed

- The `Switch` colours. Android draws them correctly; only the web preview
  shows a teal thumb.
- The contents of the other sheets. They inherit the new buttons, chips,
  captions and "Done", but their layouts weren't individually redesigned,
  because the preview can't open a sheet from a URL.
