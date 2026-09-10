/**
 * Material You (Material Design 3), in the dark.
 *
 * The published MD3 palette is a light one. This is the same system —
 * tonal surfaces, a seed-derived colour family, state layers, generous
 * radii — resolved for a dark app, because Pinch is one: a student checks
 * this at night, in bed, right after spending money they were not planning
 * to. A white screen at that moment is the wrong answer.
 *
 * Two colour systems live here and they do different jobs. Do not merge them:
 *
 *   - The MD3 roles (primary, secondary, tertiary, surface…) dress the app.
 *     They say "this is a button", "this is a container", "this is the thing
 *     you tap". Seeded from #6750A4, the violet the spec calls for, resolved
 *     to their dark-scheme tones.
 *
 *   - The status colours (neonGreen through danger, and categoryColors)
 *     mean something. Green is "you are fine", amber is "careful", red is
 *     "you are over". They are not decoration and are not chosen to match
 *     the seed — they are chosen to be read in half a second without
 *     parsing the number underneath. accentForState and balanceColor are
 *     the only things that should pick between them.
 *
 * A button being violet while the Safe-to-Spend figure is green is correct,
 * not a clash: one is chrome, the other is a reading.
 */

// ---------------------------------------------------------------------------
// Tonal surfaces.
//
// MD3's central idea, and the one most often skipped: depth comes from
// stepping the *tone* of a surface, not from stacking shadows on flat grey.
// Every value below carries a little of the seed's violet, which is why they
// read as a warm near-black rather than the dead #000 of a terminal.
// ---------------------------------------------------------------------------
const surfaces = {
  /** The page itself. Nothing sits behind this. */
  surfaceContainerLowest: '#0F0D13',
  /** Cards at rest. */
  surfaceContainerLow: '#1D1B20',
  /** The default container tone. */
  surfaceContainer: '#211F26',
  /** Raised: inputs, chips, a card being pressed. */
  surfaceContainerHigh: '#2B2930',
  /** Highest: sheet handles, progress tracks, the top of the stack. */
  surfaceContainerHighest: '#36343B',
} as const;

export const palette = {
  // -- MD3 roles ----------------------------------------------------------
  primary: '#D0BCFF',
  onPrimary: '#381E72',
  primaryContainer: '#4F378B',
  onPrimaryContainer: '#EADDFF',

  secondary: '#CCC2DC',
  onSecondary: '#332D41',
  secondaryContainer: '#4A4458',
  onSecondaryContainer: '#E8DEF8',

  tertiary: '#EFB8C8',
  onTertiary: '#492532',
  tertiaryContainer: '#633B48',
  onTertiaryContainer: '#FFD8E4',

  error: '#F2B8B5',
  onError: '#601410',
  errorContainer: '#8C1D18',
  onErrorContainer: '#F9DEDC',

  ...surfaces,

  /**
   * The page and the default card, named for their job rather than their
   * position in the stack. Both are MD3 role names in their own right; the
   * surfaceContainer* ladder above is what everything else reaches for,
   * because "high" and "highest" say where a tone sits relative to the rest
   * in a way that "elevated" never quite did.
   */
  background: surfaces.surfaceContainerLowest,
  surface: surfaces.surfaceContainerLow,

  outline: '#938F99',
  outlineVariant: '#49454F',
  /** Borders are a fallback in MD3 — reach for a surface tone first. */
  border: 'rgba(255,255,255,0.07)',
  borderStrong: 'rgba(255,255,255,0.14)',
  glassOverlay: 'rgba(255,255,255,0.06)',
  scrim: 'rgba(0,0,0,0.72)',

  textPrimary: '#E6E0E9',
  textSecondary: '#CAC4D0',
  textMuted: '#938F99',

  // -- Status. Meaning, not decoration. See the note at the top. ----------
  neonGreen: '#39FF14',
  mint: '#5BE9B9',
  warningAmber: '#FFBF00',
  danger: '#FF4D4D',
  violet: '#A78BFA',
  sky: '#60A5FA',
  pink: '#F472B6',
} as const;

/**
 * State layers.
 *
 * MD3 does not change a component's colour when you touch it — it lays a
 * translucent film of the *content* colour over whatever is already there.
 * That is why a pressed button still looks like itself, and why this works
 * over a photo, a gradient or a plain surface without being special-cased.
 */
export const stateLayer = {
  hover: 0.08,
  focus: 0.1,
  press: 0.12,
  drag: 0.16,
} as const;

/** A content colour at state-layer opacity, ready to overlay. */
export function layer(hex: string, opacity: number): string {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/** One colour per spend category, used consistently across every chart. */
export const categoryColors: Record<string, string> = {
  Food: '#FF8A5B',
  Outing: '#A78BFA',
  Transport: '#60A5FA',
  Shopping: '#F472B6',
  Subscriptions: '#5BE9B9',
  Academics: '#FBBF24',
  Health: '#4ADE80',
  Cash: '#D0BCFF',
  Other: '#94A3B8',
  Uncategorised: '#64748B',
};

export function categoryColor(category: string | null | undefined): string {
  if (!category) return categoryColors.Uncategorised;
  return categoryColors[category] ?? categoryColors.Other;
}

/**
 * MD3's shape scale. Rounding here is architectural, not decoration: it is
 * most of what separates this from the rectangles of Material 2, and the
 * large end (28–48) is deliberately larger than feels safe.
 */
export const radii = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 28,
  xxl: 32,
  /** Hero containers and major sections. */
  hero: 48,
  pill: 999,

  // Named for their use, so components read clearly.
  card: 24,
  sheet: 28,
  /** MD3 filled text field: rounded at the top, square on the bottom edge. */
  input: 12,
  chip: 999,
  fab: 20,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/**
 * Elevation.
 *
 * Shadows are a supporting actor in MD3 — the tonal surface above does most
 * of the lifting. These stay soft and shallow on purpose; a hard drop shadow
 * on a dark background reads as a smudge, not as height.
 */
export const elevation = {
  level0: {},
  level1: {
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  level2: {
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  level3: {
    shadowColor: '#000',
    shadowOpacity: 0.36,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const;

/**
 * MD3's type scale.
 *
 * Roboto is not loaded as a font asset: Android's system face already is
 * Roboto, and this app is Android-only in every way that matters (SMS and
 * notification capture do not exist elsewhere). Shipping the file would add
 * weight to the bundle for a difference nobody could see on the device.
 *
 * The display sizes moved up to the MD3 scale; body and label sizes did not,
 * because they are load-bearing for every dense row in the app and growing
 * them would push amounts onto second lines. Line height and letter spacing
 * carry the MD3 feel there instead.
 */
export const typography = {
  hero: {
    fontSize: 56,
    fontWeight: '700' as const,
    letterSpacing: -1.5,
    lineHeight: 64,
  },
  heroCompact: {
    fontSize: 40,
    fontWeight: '700' as const,
    letterSpacing: -1,
    lineHeight: 48,
  },
  display: {
    fontSize: 32,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
    lineHeight: 40,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '500' as const,
    letterSpacing: -0.2,
    lineHeight: 36,
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: '500' as const,
    letterSpacing: 1.5,
    textTransform: 'uppercase' as const,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '500' as const,
    letterSpacing: 0.15,
  },
  body: {
    fontSize: 14,
    fontWeight: '400' as const,
    letterSpacing: 0.25,
    lineHeight: 20,
  },
  bodyBold: {
    fontSize: 14,
    fontWeight: '500' as const,
    letterSpacing: 0.15,
    lineHeight: 20,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400' as const,
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  micro: {
    fontSize: 11,
    fontWeight: '500' as const,
    letterSpacing: 0.5,
    lineHeight: 15,
  },
  /** MD3 label style for buttons: medium weight, slightly open. */
  label: {
    fontSize: 14,
    fontWeight: '500' as const,
    letterSpacing: 0.1,
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
      return palette.warningAmber;
    case 'STEADY':
      return palette.mint;
    default:
      return palette.neonGreen;
  }
}

/** Colour for a net balance: owed to you is good, owed by you is a liability. */
export function balanceColor(netAmount: number): string {
  if (Math.abs(netAmount) < 0.01) return palette.textSecondary;
  return netAmount > 0 ? palette.mint : palette.warningAmber;
}
