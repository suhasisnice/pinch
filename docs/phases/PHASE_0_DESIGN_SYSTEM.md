# Phase 0 — Design System

## Objective

Replace the Material Design 3 dark-violet token system (`src/theme/theme.ts`)
with the Spotify-dark-green language `SPOTIFY_FINANCE_UI_PROMPT.md` mandates,
and remove the two forbidden patterns baked into the shared component kit
(`src/components/ui.tsx`) that every screen inherits automatically: the
atmospheric `BlurOrb` wash behind every `Screen`, and the extended,
Material-style FAB.

This phase changes **tokens and shared primitives only**. It does not
redesign any screen's layout, hierarchy, or card structure — that work
belongs to each screen's own phase (3, 5, 6, …) and to Phase 10's final
audit. A screen that compiled against the old tokens must compile and render
against the new ones without a rewrite; only call sites that referenced a
token this phase retires get touched, and only enough to keep them valid.

## Read first

- `PRODUCT_SPEC.md` §8–9
- `SPOTIFY_FINANCE_UI_PROMPT.md` (color system, typography, layout, buttons)
- `docs/AUDIT.md` §7 ("Major UI / design problems")

## Scope

### 1. Palette

MD3 gave the app five tonal surface steps, a violet primary, and a purple
secondary/tertiary/error family with "container"/"on-container" pairs for
every one of them. The spec has three surfaces and one accent. The mapping
below is a collapse, not a recolor of equivalent slots — several MD3 roles
merge into one Spotify token because the spec simply has fewer of them:

| Old (MD3) | New (spec) | Note |
| --- | --- | --- |
| `surfaceContainerLowest` | `background` (`#121212`) | |
| `surfaceContainerLow`, `surfaceContainer` | `surface` (`#181818`) | two MD3 steps become one |
| `surfaceContainerHigh`, `surfaceContainerHighest` | `surfaceElevated` (`#1f1f1f`) | two MD3 steps become one — a progress track and a pressed input field now share a tone, which is the spec's own three-surface model, not an oversight |
| `primary` | `accent` (`#1ed760`) | |
| `onPrimary` | `onAccent` (computed via `onColor(accent)`) | |
| `secondaryContainer` | `accentMuted` (`layer(accent, 0.16)`) | a translucent tint, not a second solid color — spec: "green is an accent... not a paint bucket" |
| `onSecondaryContainer` | reuses `accent` directly | text/icon on a muted-accent chip or the active tab pill is literal spec text: "Active tab uses Spotify green" |
| `violet` | `info` (`#539df5`) | violet had no financial meaning in the code (outing tags, badge defaults) — retired in favor of the spec's own "Announcement/Informational" blue, which the old palette never used at all |
| `neonGreen`, `mint` | `accent` | both were second/third greens for "positive" states (goal complete, credit amount) — the spec has one green, and "positive states" is explicitly a listed use of it |
| `danger` | `danger` (`#f3727f`, was `#FF4D4D`) | same role, spec's exact value |
| `errorContainer` / `onErrorContainer` | `dangerMuted` / `onDanger` | same pattern as accent/accentMuted |
| `warningAmber` | `warning` (`#ffa42b`, was `#FFBF00`) | renamed to match spec vocabulary |
| `outline`, `outlineVariant` | `border` | one subtle translucent line, not two solid grays |
| `textPrimary` | `#ffffff` (was `#E6E0E9`) | spec's exact white |
| `textSecondary` | `#b3b3b3` (was `#CAC4D0`) | spec's exact silver |
| `textMuted` | kept, redefined as a third, dimmer tier | **not** in either spec document; kept as a deliberate, documented extension because 46 call sites use it as a genuinely distinct tier from `textSecondary` (inactive tab icons, micro captions, empty-state body) and collapsing it to two tiers would flatten hierarchy across half the app in a phase that isn't touching screen layout to compensate |
| `tertiary`, `onTertiary` | removed | existed only for `BlurOrb` and the extended `FAB`, both removed below |
| `primaryContainer`, `onPrimaryContainer`, `borderStrong`, `glassOverlay` | removed | zero call sites; dead weight left over from the MD3 scale |
| `sky`, `pink` | removed | zero call sites |

`categoryColors` (one hex per spend category) is **not** touched. Neither
spec names category colors, and a consistent per-category color is a
distinguishing pattern, not the "rainbow chart" decoration the spec warns
against. Screen-level use of it is each screen's own phase to reconsider.

The contrast helpers (`channels`, `luminance`, `contrastRatio`, `onColor`,
`layer`) are palette-agnostic and unchanged.

### 2. Radii

Spec: small controls 6–8px, cards/surfaces 8–16px, large sheets/dialogs
16–24px, pills full radius, circular controls 50%. MD3's scale ran past this
on the large end (`hero: 48`, `xxl: 32`, `xl: 28`).

| Old | New | Value |
| --- | --- | --- |
| `md` | `md` | 16 (unchanged — already in range) |
| `card` (was 24) | `card` | 16 |
| `xl` (was 28, sheet top corners) | `sheet` | 20 |
| `input` | `input` | 12 (unchanged) |
| `pill`, `chip` | `pill`, `chip` | 999 (unchanged) |
| `hero` (48), `xxl` (32), `fab` | removed | see call-site fixes below |

Three call sites referenced a retired token and needed a one-line fix to
keep compiling — not a redesign:

- `ui.tsx`'s `FAB` used `radii.fab`; the rebuilt FAB (below) is a circle and
  uses `radii.pill`, which clips to a circle at any size just as well.
- `ui.tsx`'s `Sheet` top corners used `radii.xl`; now `radii.sheet`.
- `TodayScreen`'s hero card used `radii.hero` (48px — explicitly the "giant
  rounded rectangle" the spec's anti-patterns list names). Changed to
  `radii.card` (16px) as the minimum fix to keep it valid. Today's hero
  layout itself — the `BlurOrb` glow behind it, its card-wrapped hierarchy —
  is Phase 3's to redesign properly; this phase only had to stop it
  referencing a token that no longer exists.

### 3. Typography

Spec scale: screen title 24px/700, feature heading 18px/600, body 15–16px,
caption 13–14px, small bold 12px/700, primary action 14px/700/uppercase,
hero amount 32–44px.

| Token | Old | New |
| --- | --- | --- |
| `hero` | 56px/700 | 40px/700 (spec's amount range is 32–44) |
| `heroCompact` | 40px/700 | 32px/700 |
| `screenTitle` | 28px/500 | 24px/700 (spec exact) |
| `cardTitle` | 16px/500 | 18px/600 (spec's "feature heading" exact) |
| `body` | 14px/400 | 16px/400 (spec exact) |
| `bodyBold` | 14px/500 | 16px/600 |
| `caption` | 12px/400 | 14px/400 (spec exact) |
| `micro` | 11px/500 | 12px/700, uppercase (spec's "small bold" exact) |
| `label` (button text) | — | 14px/700, uppercase, letter-spacing (spec's "primary action" line, exact) |
| `display` | 32px/700 | 28px/700 — kept as an extra tier between `cardTitle` and `hero` for big secondary stat numbers (Insights); not spec-named, documented here rather than left unexplained |

**This is not visually verified on-device.** This environment has no
attached emulator or phone, and the repo has zero snapshot/visual tests
(`docs/AUDIT.md` §1). Every type-size change here is a net *increase*
(`body` 14→16, `caption` 12→14) inside components built with flexible
row/padding layout rather than fixed heights, which is the low-risk
direction for reflow — but "low-risk" is not "verified." **Do a visual pass
on-device before shipping this**, specifically on the densest lists
(Transactions, Insights) where a two-point bump across many rows is most
likely to show as new wrapping.

### 4. Forbidden patterns removed from the shared kit

- **`BlurOrb`** and the `ScreenAtmosphere` wrapper that put two of them
  behind *every* `Screen()` call are deleted outright. This was
  glassmorphism running underneath every single screen in the app, which
  both specs explicitly forbid, not a one-off decoration on Today alone.
  `Screen()` still renders exactly what it rendered before minus the wash —
  no layout change.
- **`FAB`** is rebuilt as a compact circular icon button — no extended
  labeled variant, no MD3 tertiary color. `PHASE_3_TODAY.md` itself already
  says the Today add-action should be "a compact floating pill... rather
  than a giant floating circle," which argues for retiring the floating
  circle pattern from Today entirely in favor of a plain `Button`. That
  screen change is Phase 3's; this phase keeps `FAB`'s existing call site in
  `TodayScreen` compiling against a primitive that is at least no longer an
  *extended* FAB with a label riding along it.

### 5. Two fixes found during implementation, not in the original plan

- **`textMuted` failed AA.** The first value chosen (`#767676`) cleared
  contrast against `background`/`surface` but landed at 3.63:1 against
  `surfaceElevated` — under the 4.5:1 AA floor `themeContrast.test.ts`
  checks for "the faintest text on the most raised surface." Raised to
  `#8a8a8a` (4.77:1 on `surfaceElevated`), which still reads distinctly
  dimmer than `textSecondary` (`#b3b3b3`). Caught by the existing test, not
  by inspection — exactly what that test is for.
- **`Button`'s `tonal`/`secondary` variant was accent-tinted.** The
  mechanical rename mapped its old `secondaryContainer`/`onSecondaryContainer`
  background/label straight to `accentMuted`/`accent`, which produces a
  second, weaker green button. The spec is explicit: "Secondary: Dark pill,"
  distinct from "Primary: Filled Spotify-green pill." Changed `tonal`'s
  background to `surfaceElevated` and its label to `textPrimary`. The
  chip-selection pattern (`Chip`, the active tab pill) keeps the
  accent-tinted look deliberately — a selected filter or the active tab is a
  different, and spec-sanctioned, use of the accent ("Active tab uses
  Spotify green") from a secondary *button*.

### Explicitly out of scope

- Any screen's layout, card structure, or information hierarchy.
- The component kit's coverage gaps against `SPOTIFY_FINANCE_UI_PROMPT.md`'s
  named list (`MoneyAmount`, `TransactionRow`, `MetricBlock`,
  `SegmentedControl`, `StatusLabel`, `AmountInput`, `InsightBlock`, …) —
  building these against screens that don't exist yet in their target form
  is premature; each lands in the phase that first needs it.
- Renaming the `Goals`/`Squad` tabs to `Savings`/`Split` (navigation, Phase 3/6 territory).
- `categoryColors`.
- Visual on-device QA (see the typography caveat above).

## Acceptance tests

1. `npm run typecheck` and `npm test` stay green with zero test edits required
   by the palette/radii/typography rename (screens reference tokens by name,
   not value, so a pure rename should not touch behavior any test asserts on).
2. No remaining reference to a retired token (`primary`, `secondaryContainer`,
   `onSecondaryContainer`, `tertiary`, `onTertiary`, `neonGreen`, `mint`,
   `violet`, `warningAmber`, `outline`, `outlineVariant`, `glassOverlay`,
   `primaryContainer`, `onPrimaryContainer`, `borderStrong`, `sky`, `pink`,
   `radii.hero`, `radii.xl`, `radii.xxl`, `radii.fab`) anywhere in `src` or `App.tsx`.
3. `BlurOrb` has no remaining export or call site.
4. `themeContrast.test.ts` (WCAG contrast assertions against `onColor`) passes
   against the new palette values — the test itself needed a mechanical
   rewrite to the new token names (it references palette fields directly,
   which is the surface it exists to check), but no assertion was loosened.
   It did catch one real finding: see §5.
