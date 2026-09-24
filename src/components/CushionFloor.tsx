import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatMoney } from '../utils/format';
import { layer, palette, place, spacing, typography } from '../theme/theme';
import { MASK } from '../security/MoneyReveal';

/**
 * The cushion drawn as a floor under the bank balance (0.9.21, docs/FIX_QUEUE.md).
 *
 * The cushion is not money somewhere else. It is a label on money still in
 * the account, and that is exactly why it used to feel spendable: the bank
 * balance showed all of it. So the balance is drawn as one bar with a line
 * across it. What sits below the line is the cushion, and only what is above
 * it is yours to spend.
 *
 * While the balance is hidden (security/MoneyReveal.tsx) the bar is not
 * drawn at all: next to the cushion's own rupee figure, where the floor
 * falls along the bar would give the balance away. Only the cushion line
 * shows.
 */
export default function CushionFloor({
  balance,
  saved,
  target,
  masked = false,
}: {
  /** What is in the bank. */
  balance: number;
  /** What the cushion holds today. */
  saved: number;
  /** A full cushion. */
  target: number;
  masked?: boolean;
}) {
  const floor = Math.max(0, saved);
  const above = balance - floor;
  const underwater = above < -0.5;
  // Drawn against whichever is bigger, so a cushion the balance no longer
  // covers still shows the gap instead of overflowing the bar.
  const scale = Math.max(balance, floor, 1);
  const floorAt = Math.min(1, floor / scale);
  const fillTo = Math.max(0, Math.min(1, balance / scale));

  return (
    <View
      style={styles.wrap}
      accessibilityLabel={
        masked
          ? `Cushion ${formatMoney(saved)} of ${formatMoney(target)}, kept under your balance`
          : `${formatMoney(Math.max(0, above))} above the cushion. Cushion ${formatMoney(saved)} of ${formatMoney(target)}`
      }
    >
      {masked ? null : (
        <View style={styles.bar}>
          <View style={[styles.cushion, { width: `${Math.min(fillTo, floorAt) * 100}%` }]} />
          {fillTo > floorAt ? (
            <View
              style={[
                styles.spendable,
                { left: `${floorAt * 100}%`, width: `${(fillTo - floorAt) * 100}%` },
              ]}
            />
          ) : null}
          {floor > 0 ? (
            <View
              style={[
                styles.floorLine,
                { left: `${floorAt * 100}%` },
                underwater && { backgroundColor: palette.warning },
              ]}
            />
          ) : null}
        </View>
      )}
      <View style={styles.legend}>
        <Text style={styles.cushionText}>
          cushion {formatMoney(saved)}
          <Text style={styles.of}> / {formatMoney(target)}</Text>
        </Text>
        <Text style={[styles.aboveText, underwater && !masked && { color: palette.warning }]}>
          {masked
            ? `${MASK} above the floor`
            : underwater
              ? `${formatMoney(-above)} under the floor`
              : `${formatMoney(above)} above the floor`}
        </Text>
      </View>
    </View>
  );
}

const BAR_HEIGHT = 10;

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  bar: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: palette.surfaceElevated,
    overflow: 'hidden',
  },
  cushion: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: layer(place.wealth, 0.35),
  },
  spendable: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: palette.textPrimary,
  },
  floorLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: place.wealth,
  },
  legend: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  cushionText: { ...typography.caption, color: palette.textSecondary },
  of: { color: palette.textMuted },
  aboveText: { ...typography.caption, color: palette.textSecondary },
});
