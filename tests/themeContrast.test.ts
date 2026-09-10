import { categoryColors, onColor, palette } from '../src/theme/theme';

/**
 * Contrast is a property of the palette, so it can be checked like any other
 * property of it.
 *
 * A dark tonal scale is easy to get wrong in a way nobody notices in review:
 * every surface is a near-black and every muted text colour is a mid-grey,
 * and the gap between two of them can quietly close when a tone is nudged to
 * look better in isolation. This fails the build instead.
 */

/** Relative luminance, per WCAG 2.1. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4]
    .map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** WCAG AA for body text. */
const AA = 4.5;

describe('palette contrast', () => {
  const bodyPairs: Array<[string, string, string]> = [
    ['textPrimary on the page', palette.textPrimary, palette.background],
    ['textPrimary on a card', palette.textPrimary, palette.surfaceContainerLow],
    ['textSecondary on a card', palette.textSecondary, palette.surfaceContainerLow],
    ['textMuted on a card', palette.textMuted, palette.surfaceContainerLow],
    // The tightest pair in the app: the faintest text on the most raised
    // surface it is ever placed on. If anything is going to fail, it is this.
    ['textMuted on a raised surface', palette.textMuted, palette.surfaceContainerHigh],
    ['primary as a link on a card', palette.primary, palette.surfaceContainerLow],
  ];

  it.each(bodyPairs)('%s clears AA', (_label, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(AA);
  });

  const onColourPairs: Array<[string, string, string]> = [
    ['a filled button', palette.onPrimary, palette.primary],
    ['a tonal button', palette.onSecondaryContainer, palette.secondaryContainer],
    ['a FAB', palette.onTertiary, palette.tertiary],
    ['a destructive button', palette.onErrorContainer, palette.errorContainer],
  ];

  it.each(onColourPairs)('the label on %s clears AA', (_label, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(AA);
  });

  it('keeps every surface tone distinguishable from the one below it', () => {
    // Tonal elevation only reads as depth if consecutive steps actually
    // differ. Too small a gap and the whole system collapses back to flat.
    const ladder = [
      palette.surfaceContainerLowest,
      palette.surfaceContainerLow,
      palette.surfaceContainer,
      palette.surfaceContainerHigh,
      palette.surfaceContainerHighest,
    ];

    for (let i = 1; i < ladder.length; i += 1) {
      expect(luminance(ladder[i])).toBeGreaterThan(luminance(ladder[i - 1]));
    }
  });
});

describe('onColor', () => {
  const tints = [
    palette.violet,
    palette.mint,
    palette.warningAmber,
    palette.neonGreen,
    // The one that motivated this: a mid-tone red where a fixed dark label
    // would have landed at 4.02:1 and nothing would have flagged it.
    palette.danger,
    palette.sky,
    palette.pink,
    palette.primary,
    palette.tertiary,
  ];

  it.each(tints)('picks a label that clears AA on %s', (tint) => {
    expect(contrast(onColor(tint), tint)).toBeGreaterThanOrEqual(AA);
  });

  it('clears AA on every category colour a chip could be tinted with', () => {
    for (const tint of Object.values(categoryColors)) {
      expect(contrast(onColor(tint), tint)).toBeGreaterThanOrEqual(AA);
    }
  });
});
