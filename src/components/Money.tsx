import React from 'react';
import { StyleSheet, Text, TextStyle } from 'react-native';
import { formatAmount } from '../utils/format';

/**
 * A money figure set the way a person typesets one, not the way a string
 * prints.
 *
 * The digits carry the amount, so the rupee sign is set smaller and lighter
 * beside them rather than competing at full size — at hero sizes a
 * full-height ₹ is a second, meaningless focal point. A negative amount uses
 * a true minus (−), which is the width of a digit and sits on the same line
 * as the plus sign, instead of the short hyphen a raw string would give.
 *
 * `MoneyAmount` in SPOTIFY_FINANCE_UI_PROMPT.md's component list.
 */
export default function MoneyAmount({
  amount,
  style,
  showPlus = false,
  numberOfLines,
  adjustsFontSizeToFit,
}: {
  amount: number;
  style?: TextStyle | TextStyle[];
  /** Prefix a positive amount with "+", for money coming in. */
  showPlus?: boolean;
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
}) {
  const safe = Number.isFinite(amount) ? amount : 0;
  const flat = StyleSheet.flatten(style) ?? {};
  const size = typeof flat.fontSize === 'number' ? flat.fontSize : 16;

  const sign = safe < 0 ? '−' : showPlus && safe > 0 ? '+' : '';

  // Below body size the difference would read as a rendering glitch rather
  // than a decision, so small figures keep one size throughout.
  const symbolStyle: TextStyle | null =
    size >= 20
      ? { fontSize: Math.round(size * 0.6), fontWeight: '500', letterSpacing: 0 }
      : null;

  return (
    <Text style={style} numberOfLines={numberOfLines} adjustsFontSizeToFit={adjustsFontSizeToFit}>
      {sign}
      <Text style={symbolStyle ?? undefined}>₹</Text>
      {formatAmount(Math.abs(safe))}
    </Text>
  );
}
