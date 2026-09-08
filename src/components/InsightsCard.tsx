import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import BentoCard from './BentoCard';
import { InsightsSummary } from '../math/insights';
import { palette, spacing, typography } from '../theme/theme';

interface InsightsCardProps {
  summary: InsightsSummary;
}

function formatRupees(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return `₹${rounded.toLocaleString('en-IN')}`;
}

function InsightRow({ label, value, subtext }: { label: string; value: string; subtext: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabelBlock}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSubtext}>{subtext}</Text>
      </View>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

/** Minimalist, high-contrast summary of spending patterns pulled from local history. */
export default function InsightsCard({ summary }: InsightsCardProps) {
  return (
    <BentoCard style={styles.card}>
      <Text style={typography.cardTitle}>Insights</Text>

      <View style={styles.list}>
        <InsightRow
          label="Micro-Transactions"
          value={formatRupees(summary.microTransactionTotal)}
          subtext={`${summary.microTransactionCount} spend${summary.microTransactionCount === 1 ? '' : 's'} under ₹100`}
        />
        <InsightRow
          label="Late-Night Spends"
          value={formatRupees(summary.lateNightTotal)}
          subtext={`${summary.lateNightCount} spend${summary.lateNightCount === 1 ? '' : 's'} · 11 PM – 4 AM`}
        />
        <View style={styles.row}>
          <View style={styles.rowLabelBlock}>
            <Text style={styles.rowLabel}>Biggest Debtor</Text>
            <Text style={styles.rowSubtext}>
              {summary.topDebtor ? summary.topDebtor.contactName : 'Nobody owes you right now'}
            </Text>
          </View>
          {summary.topDebtor ? (
            <Text style={styles.rowValue}>{formatRupees(summary.topDebtor.totalOwed)}</Text>
          ) : null}
        </View>
      </View>
    </BentoCard>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
  },
  list: {
    marginTop: spacing.sm,
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabelBlock: {
    flex: 1,
    marginRight: spacing.sm,
  },
  rowLabel: {
    ...typography.bodyBold,
    color: palette.textPrimary,
  },
  rowSubtext: {
    ...typography.caption,
    color: palette.textSecondary,
    marginTop: 2,
  },
  rowValue: {
    ...typography.bodyBold,
    color: palette.textPrimary,
  },
});
