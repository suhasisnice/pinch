import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { canIAfford } from '../math/budget';
import { BudgetSnapshot } from '../services/budgetService';
import { formatMoney } from '../utils/format';
import { palette, radii, spacing, typography } from '../theme/theme';
import { Field, Sheet } from './ui';

/**
 * "Can I afford it?" — the question people actually open a budget app with.
 *
 * It used to be a permanent card on Today with an empty field in it, which
 * cost a screen's worth of space for something asked a few times a week. Here
 * it is one row away, and the answer gets the room it needs.
 */
export default function AffordSheet({
  visible,
  snapshot,
  onClose,
}: {
  visible: boolean;
  snapshot: BudgetSnapshot;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState('');
  const parsed = Number(amount.replace(/[^\d.]/g, ''));
  const verdict =
    Number.isFinite(parsed) && parsed > 0
      ? canIAfford(parsed, snapshot.budget, snapshot.avgDailyBurn || null)
      : null;
  const days = snapshot.daysRemaining;

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        setAmount('');
        onClose();
      }}
      title="Test a purchase"
    >
      <Field
        label="How much is it?"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        placeholder="e.g. 800"
      />

      {verdict ? (
        <View style={styles.answer}>
          <Text style={[styles.head, { color: verdictColor(verdict.severity) }]}>
            {verdictHeadline(verdict.severity)}
          </Text>
          <View style={styles.facts}>
            {verdict.affordable ? (
              <Fact
                label={`Daily limit after, for ${days} ${days === 1 ? 'day' : 'days'}`}
                value={formatMoney(verdict.newDailyLimit)}
              />
            ) : (
              <Fact
                label="More than you have left"
                value={formatMoney(Math.abs(verdict.newDailyLimit * days))}
              />
            )}
            {verdict.daysOfTypicalSpending ? (
              <Fact
                label="Your normal spending for"
                value={`${verdict.daysOfTypicalSpending.toFixed(1)} days`}
              />
            ) : null}
          </View>
        </View>
      ) : (
        <Text style={styles.hint}>Checks it against what's left this period, not just today.</Text>
      )}
    </Sheet>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function verdictColor(severity: string): string {
  switch (severity) {
    case 'RECKLESS':
      return palette.danger;
    case 'TIGHT':
      return palette.warning;
    default:
      return palette.textPrimary;
  }
}

function verdictHeadline(severity: string): string {
  switch (severity) {
    case 'RECKLESS':
      return "You can't, really";
    case 'TIGHT':
      return 'Yes, but it stings';
    case 'FINE':
      return "Yes, that's fine";
    default:
      return 'Go for it';
  }
}

const styles = StyleSheet.create({
  answer: { gap: spacing.sm },
  head: { ...typography.display, fontSize: 24, lineHeight: 30 },
  facts: {
    backgroundColor: palette.surfaceElevated,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 12,
  },
  factLabel: { ...typography.body, color: palette.textSecondary, flex: 1 },
  factValue: { ...typography.bodyBold, color: palette.textPrimary },
  hint: { ...typography.caption, color: palette.textMuted },
});
