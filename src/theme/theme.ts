/**
 * Spotify-dark, resolved for finance.
 *
 * `SPOTIFY_FINANCE_UI_PROMPT.md` and `PRODUCT_SPEC.md` §8 give this system
 * three surfaces, one accent, and a small set of status colours — a
 * deliberate collapse from the five-step Material You tonal scale this file
 * used to implement (see `docs/AUDIT.md` §7 and `docs/phases/PHASE_0_DESIGN_SYSTEM.md`
 * for the full old-token → new-token mapping and the reasoning behind each merge).
 *
 * Two colour groups live here and they do different jobs. Do not merge them:
 *
 *   - Surfaces and `accent` dress the app: "this is the background", "this is
 *     a button", "this is the thing you tap". Green is semantic even here —
 *     it is the one accent, used for primary actions and active state, not
 *     decoration.
 *
 *   - The status colours (`danger`, `warning`, `info`, and `categoryColors`)
 *     mean something read in half a second, independent of chrome: green is
 *     "you are fine", amber is "careful", red is "you are over".
 *     `accentForState` and `balanceColor` are the only things that should
 *     pick between them.
 */

// ---------------------------------------------------------------------------
// Surfaces.
//
// Exactly the three steps the spec names. A progress track and a pressed
// input field now share `surfaceElevated` where the old MD3 scale gave them
// separate tones — that loss of one intermediate step is the spec's own
// three-surface model, not an oversight.
// ---------------------------------------------------------------------------
const surfaces = {
  background: '#121212',
  surface: '#181818',
  surfaceElevated: '#1f1f1f',
} as const;

// The two hex values every derived colour below reads from. Declared ahead
// of `channels`/`onColor`/`layer`'s textual position in this file, which is
// safe: both are `function` declarations, fully hoisted before any of this
// module's top-level code runs.
const ACCENT = '#1ed760';
const DANGER = '#f3727f';

export const palette = {
  ...surfaces,

  // -- Accent: the one green, used for primary actions, active state and
  // positive readings. Never a second colour standing in for it. ----------
  accent: ACCENT,
  /** Computed, not guessed: a fixed dark label reads wrong the moment the accent shifts. */
  onAccent: onColor(ACCENT),
  /** A translucent tint for a selected chip or the active tab pill — not a second solid fill. */
  accentMuted: layer(ACCENT, 0.16),

  danger: DANGER,
  onDanger: onColor(DANGER),
  dangerMuted: layer(DANGER, 0.16),

  warning: '#ffa42b',
  /** The spec's "Announcement/Informational" blue — previously unused; retired `violet` (a decorative-only tag colour with no financial meaning) in its favour. */
  info: '#539df5',

  border: 'rgba(255,255,255,0.07)',
  scrim: 'rgba(0,0,0,0.72)',

  textPrimary: '#ffffff',
  textSecondary: '#b3b3b3',
  /**
   * A third, dimmer text tier. Not named in either spec document — kept as a
   * deliberate, documented extension because 46 existing call sites
   * (inactive tab icons, micro captions, empty-state body) use it as a
   * genuinely distinct step from `textSecondary`, and this phase does not
   * touch screen layout to compensate for flattening that hierarchy.
   */
  textMuted: '#8a8a8a',
} as const;

/**
 * State layers.
 *
 * A pressed control does not change colour outright — it takes on a
 * translucent film of its own content colour. That is why a pressed button
 * still looks like itself over any surface, without special-casing each one.
 */
export const stateLayer = {
  hover: 0.08,
  focus: 0.1,
  press: 0.12,
  drag: 0.16,
} as const;

function channels(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** A content colour at state-layer opacity, ready to overlay. */
export function layer(hex: string, opacity: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/** Relative luminance, per WCAG 2.1. */
function luminance(hex: string): number {
  return channels(hex)
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * A foreground that stays readable on an arbitrary background.
 *
 * Components that accept a colour from their caller — a chip tinted by
 * category, say — cannot assume a fixed label colour. Pinning one works
 * until someone passes a mid-tone that fails contrast against it, and
 * nothing would have said so. Measuring both candidates and taking the
 * better one is correct for every colour instead of for the few that happen
 * to be in use today.
 */
export function onColor(background: string): string {
  const dark = '#121212';
  const light = '#FFFFFF';
  return contrastRatio(dark, background) >= contrastRatio(light, background) ? dark : light;
}

/** One colour per spend category, used consistently across every chart. Unchanged by the Phase 0 token migration — screen-level concern, not a design-token one. */
export const categoryColors: Record<string, string> = {
  Food: '#FF8A5B',
  Outing: '#A78BFA',
  Transport: '#60A5FA',
  Shopping: '#F472B6',
  Subscriptions: '#5BE9B9',
  Academics: '#FBBF24',
  Health: '#4ADE80',
  Bills: '#67E8F9',
  Rent: '#FCA5A5',
  Cash: '#D0BCFF',
  Other: '#94A3B8',
  Uncategorised: '#64748B',
};

export function categoryColor(category: string | null | undefined): string {
  if (!category) return categoryColors.Uncategorised;
  return categoryColors[category] ?? categoryColors.Other;
}

/**
 * Radii, per `SPOTIFY_FINANCE_UI_PROMPT.md`: small controls 6–8px,
 * cards/surfaces 8–16px, large sheets/dialogs 16–24px, pills full radius,
 * circular controls 50%.
 */
export const radii = {
  xs: 8,
  sm: 12,
  md: 16,
  pill: 999,

  // Named for their use, so components read clearly.
  card: 16,
  sheet: 20,
  input: 12,
  chip: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  /**
   * Side padding for a whole screen. SPOTIFY_FINANCE_UI_PROMPT.md asks for
   * 20–24px; content used to sit at 16, which is what made every screen
   * feel slightly crammed against the glass.
   */
  gutter: 20,
} as const;

/**
 * Elevation.
 *
 * The spec prefers surface contrast over shadow. These stay soft and
 * shallow; a hard drop shadow on a near-black background reads as a smudge,
 * not as height.
 */
export const elevation = {
  level0: {},
  level1: {
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  level2: {
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  level3: {
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const;

/**
 * Type scale, per `SPOTIFY_FINANCE_UI_PROMPT.md`.
 *
 * Roboto is not loaded as a font asset: Android's system face already is
 * Roboto, and this app is Android-only in every way that matters (SMS and
 * notification capture do not exist elsewhere). Shipping the file would add
 * weight to the bundle for a difference nobody could see on the device.
 *
 * NOT visually verified on-device — this environment has no attached
 * emulator and the repo has no snapshot tests. `body` and `caption` both
 * grew two points to match the spec exactly; see
 * `docs/phases/PHASE_0_DESIGN_SYSTEM.md` §3 before shipping this without a
 * visual pass on the densest lists (Transactions, Insights).
 */
/**
 * Every digit the same width, so amounts line up down a list and a figure
 * counting to a new value holds still instead of shuffling sideways.
 *
 * Android's Roboto already draws equal-width digits by default, so today
 * this mostly states intent — but it is what keeps the numbers right the
 * moment a typeface with proportional figures is swapped in, which is the
 * common case for anything other than the system font.
 */
const TABULAR = { fontVariant: ['tabular-nums'] as Array<'tabular-nums'> };

export const typography = {
  /** Large money amount (32–44px in the spec). */
  hero: {
    ...TABULAR,
    fontSize: 40,
    fontWeight: '700' as const,
    letterSpacing: -1,
    lineHeight: 46,
  },
  heroCompact: {
    ...TABULAR,
    fontSize: 32,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
    lineHeight: 38,
  },
  /** Extra tier for a big secondary stat (Insights) — not spec-named, kept between `cardTitle` and `hero`. */
  display: {
    ...TABULAR,
    fontSize: 28,
    fontWeight: '700' as const,
    letterSpacing: -0.3,
    lineHeight: 34,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    letterSpacing: -0.2,
    lineHeight: 30,
  },
  /** The line naming a hero figure ("Safe to spend today"). */
  heroLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
    letterSpacing: 0.1,
    lineHeight: 20,
  },
  /**
   * The small name over a group of things — a section, a stat, a field.
   * Sentence case, set apart by weight and colour rather than by capitals
   * and wide tracking: the all-caps eyebrow on every block is one of the
   * most recognisable marks of a generated interface, and the spec only asks
   * for uppercase on button labels.
   */
  sectionLabel: {
    ...TABULAR,
    fontSize: 13,
    fontWeight: '600' as const,
    letterSpacing: 0.1,
    lineHeight: 18,
  },
  /** Feature/section heading. */
  cardTitle: {
    ...TABULAR,
    fontSize: 18,
    fontWeight: '600' as const,
    letterSpacing: 0.1,
  },
  body: {
    ...TABULAR,
    fontSize: 16,
    fontWeight: '400' as const,
    letterSpacing: 0.15,
    lineHeight: 22,
  },
  bodyBold: {
    ...TABULAR,
    fontSize: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.1,
    lineHeight: 22,
  },
  caption: {
    ...TABULAR,
    fontSize: 14,
    fontWeight: '400' as const,
    letterSpacing: 0.25,
    lineHeight: 18,
  },
  /** "Small bold" in the spec: 12px/700. */
  micro: {
    ...TABULAR,
    fontSize: 12,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
    lineHeight: 16,
  },
  /** Primary action / button label: 14px/700/uppercase/slight letter-spacing, per spec. */
  label: {
    fontSize: 14,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
} as const;

export type TodayState = 'FRESH' | 'STEADY' | 'CLOSE' | 'OVER';

/**
 * The home screen's accent tracks how much of today's limit is gone. Green
 * through amber to red is doing real work here: the colour is the fastest
 * read on the screen, and it should agree with the number without anyone
 * having to parse the number first.
 */
export function accentForState(state: TodayState): string {
  switch (state) {
    case 'OVER':
      return palette.danger;
    case 'CLOSE':
      return palette.warning;
    default:
      return palette.accent;
  }
}

/** Colour for a net balance: owed to you is good, owed by you is a liability. */
export function balanceColor(netAmount: number): string {
  if (Math.abs(netAmount) < 0.01) return palette.textSecondary;
  return netAmount > 0 ? palette.accent : palette.warning;
}
