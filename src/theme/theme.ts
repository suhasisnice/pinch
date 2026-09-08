export const palette = {
  background: '#121212',
  cardBackground: '#1C1C1E',
  cardBackgroundElevated: '#242426',
  border: 'rgba(255,255,255,0.08)',
  glassBorder: 'rgba(255,255,255,0.16)',
  glassOverlay: 'rgba(255,255,255,0.06)',
  scrim: 'rgba(0,0,0,0.55)',
  textPrimary: '#FFFFFF',
  textSecondary: '#9A9A9E',
  textMuted: '#6B6B70',
  neonGreen: '#39FF14',
  warningAmber: '#FFBF00',
  danger: '#FF4D4D',
} as const;

export const radii = {
  card: 24,
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
} as const;

export const typography = {
  brutalistNumber: {
    fontSize: 76,
    fontWeight: '900' as const,
    letterSpacing: -2,
  },
  brutalistNumberCompact: {
    fontSize: 48,
    fontWeight: '900' as const,
    letterSpacing: -1,
  },
  heroLabel: {
    fontSize: 13,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
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
} as const;

/** Colors that flip when Safe-to-Spend drops into Survival Mode. */
export function getAccentColor(survivalMode: boolean): string {
  return survivalMode ? palette.warningAmber : palette.neonGreen;
}
