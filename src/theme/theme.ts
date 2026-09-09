export const palette = {
  background: '#0E0E10',
  surface: '#171719',
  surfaceElevated: '#1F1F22',
  surfaceHigh: '#28282C',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',
  glassOverlay: 'rgba(255,255,255,0.06)',
  scrim: 'rgba(0,0,0,0.65)',

  textPrimary: '#FFFFFF',
  textSecondary: '#9A9AA0',
  textMuted: '#6B6B72',

  neonGreen: '#39FF14',
  mint: '#5BE9B9',
  warningAmber: '#FFBF00',
  danger: '#FF4D4D',
  violet: '#A78BFA',
  sky: '#60A5FA',
  pink: '#F472B6',
} as const;

/** One colour per spend category, used consistently across every chart. */
export const categoryColors: Record<string, string> = {
  Food: '#FF8A5B',
  Outing: '#A78BFA',
  Transport: '#60A5FA',
  Shopping: '#F472B6',
  Subscriptions: '#5BE9B9',
  Academics: '#FBBF24',
  Health: '#4ADE80',
  Other: '#94A3B8',
  Uncategorised: '#64748B',
};

export function categoryColor(category: string | null | undefined): string {
  if (!category) return categoryColors.Uncategorised;
  return categoryColors[category] ?? categoryColors.Other;
}

export const radii = {
  card: 24,
  sheet: 28,
  pill: 999,
  input: 14,
  chip: 12,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const typography = {
  hero: {
    fontSize: 64,
    fontWeight: '800' as const,
    letterSpacing: -2.5,
  },
  heroCompact: {
    fontSize: 44,
    fontWeight: '800' as const,
    letterSpacing: -1.5,
  },
  display: {
    fontSize: 30,
    fontWeight: '800' as const,
    letterSpacing: -0.8,
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: '800' as const,
    letterSpacing: -0.6,
  },
  heroLabel: {
    fontSize: 12,
    fontWeight: '700' as const,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
  },
  body: {
    fontSize: 14,
    fontWeight: '400' as const,
  },
  bodyBold: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  caption: {
    fontSize: 12,
    fontWeight: '500' as const,
  },
  micro: {
    fontSize: 11,
    fontWeight: '600' as const,
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
