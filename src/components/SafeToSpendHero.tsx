import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import BentoCard from './BentoCard';
import { getAccentColor, palette, spacing, typography } from '../theme/theme';
import { computeDailySurvivalCap, isSurvivalMode } from '../math/survivalMode';

interface SafeToSpendHeroProps {
  safeToSpend: number;
  /** Days left in the current budget window — calendar month, or a Mid-Month Calibration window. */
  daysLeft: number;
}

function formatRupees(amount: number): string {
  const rounded = Math.round(amount);
  return `₹${rounded.toLocaleString('en-IN')}`;
}

/**
 * The hero bento widget. Normally shows the brutalist Safe-to-Spend number
 * in neon green. Once the balance drops under the Survival Mode threshold,
 * it swaps to the amber "Daily Survival Cap" takeover per the Phase 3 spec.
 */
export default function SafeToSpendHero({ safeToSpend, daysLeft }: SafeToSpendHeroProps) {
  const survival = isSurvivalMode(safeToSpend);
  const accent = getAccentColor(survival);

  if (survival) {
    const dailyCap = computeDailySurvivalCap(safeToSpend, daysLeft);

    return (
      <BentoCard elevated accentColor={accent} style={styles.hero}>
        <View style={styles.survivalBadge}>
          <Text style={[styles.survivalBadgeText, { color: accent }]}>⚠ SURVIVAL MODE</Text>
        </View>
        <Text style={styles.label}>Daily Survival Cap</Text>
        <Text style={[typography.brutalistNumber, styles.number, { color: accent }]} numberOfLines={1} adjustsFontSizeToFit>
          {formatRupees(dailyCap)}
        </Text>
        <Text style={styles.subtext}>
          {formatRupees(safeToSpend)} left · {daysLeft} day{daysLeft === 1 ? '' : 's'} left in the month
        </Text>
      </BentoCard>
    );
  }

  return (
    <BentoCard elevated accentColor={accent} style={styles.hero}>
      <Text style={styles.label}>Safe to Spend</Text>
      <Text style={[typography.brutalistNumber, styles.number, { color: accent }]} numberOfLines={1} adjustsFontSizeToFit>
        {formatRupees(safeToSpend)}
      </Text>
      <Text style={styles.subtext}>This month, after allowance and expenses</Text>
    </BentoCard>
  );
}

const styles = StyleSheet.create({
  hero: {
    minHeight: 200,
    justifyContent: 'center',
  },
  label: {
    ...typography.heroLabel,
    color: palette.textSecondary,
    marginBottom: spacing.xs,
  },
  number: {
    marginBottom: spacing.xs,
  },
  subtext: {
    ...typography.body,
    color: palette.textSecondary,
  },
  survivalBadge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
  },
  survivalBadgeText: {
    ...typography.caption,
    fontWeight: '800',
  },
});
