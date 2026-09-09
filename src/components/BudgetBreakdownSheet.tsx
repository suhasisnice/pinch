import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BudgetSnapshot } from '../services/budgetService';
import { formatMoney } from '../utils/format';
import { layer, palette, radii, spacing, typography } from '../theme/theme';
import { Sheet } from './ui';
import Icon from './Icon';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

interface Line {
  label: string;
  amount: number;
  /** Which window this figure was measured over. */
  window: string;
  /** Positive terms add to what you can spend. */
  positive: boolean;
}

/**
 * Shows the arithmetic behind Safe-to-Spend, one term at a time.
 *
 * The headline number mixes two kinds of figure, and that is exactly what
 * makes it feel wrong when it disagrees with the user's memory: allowance and
 * spending are measured over the current period, while debts and goal
 * reserves are running balances that do not reset when a new period starts.
 * Starting fresh therefore clears the spending but not the 4,000 still owed
 * to a friend — which is correct, and completely invisible unless the app
 * says so. Every row below names its own window for that reason.
 */
export default function BudgetBreakdownSheet({
  visible,
  snapshot,
  onClose,
}: {
  visible: boolean;
  snapshot: BudgetSnapshot | null;
  onClose: () => void;
}) {
  if (!snapshot) return null;

  const b = snapshot.budget;
  const periodWindow = `since ${shortDate(snapshot.periodStart)}`;

  const lines: Line[] = [
    { label: 'Allowance', amount: b.allowance, window: periodWindow, positive: true },
    { label: 'Money in', amount: b.topUps, window: periodWindow, positive: true },
    { label: 'Spending', amount: b.grossSpend, window: periodWindow, positive: false },
    { label: 'Friends paid you back', amount: b.settledIn, window: periodWindow, positive: true },
    { label: 'You paid friends back', amount: b.settledOut, window: periodWindow, positive: false },
    {
      label: 'Expected back from friends',
      amount: b.expectedRecovery,
      window: 'all open debts, weighted by who actually pays',
      positive: true,
    },
    { label: 'You still owe others', amount: b.openPayables, window: 'all open debts', positive: false },
    {
      label: 'Set aside for goals',
      amount: b.goalReserve,
      window: snapshot.goalReserveCapped
        ? `held back from ${formatMoney(snapshot.goalReserveRequested)} your goals asked for`
        : 'all active goals',
      positive: false,
    },
  ].filter((line) => Math.abs(line.amount) > 0.009);

  const carriedOver = b.expectedRecovery - b.openPayables - b.goalReserve;

  return (
    <Sheet visible={visible} onClose={onClose} title="Where this number comes from">
      <View style={styles.periodBox}>
        <Icon name="calendar" size={15} color={palette.textSecondary} />
        <Text style={styles.periodText}>
          Counting from {shortDate(snapshot.periodStart)} to {shortDate(snapshot.periodEnd)} ·{' '}
          {snapshot.daysRemaining} days left
        </Text>
      </View>

      <View>
        {lines.map((line) => (
          <View key={line.label} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{line.label}</Text>
              <Text style={styles.rowWindow}>{line.window}</Text>
            </View>
            <Text
              style={[
                styles.rowAmount,
                { color: line.positive ? palette.mint : palette.textPrimary },
              ]}
            >
              {line.positive ? '+' : '−'}
              {formatMoney(Math.abs(line.amount))}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.total}>
        <Text style={styles.totalLabel}>Safe to spend</Text>
        <Text
          style={[
            styles.totalAmount,
            { color: b.spendablePool < 0 ? palette.danger : palette.neonGreen },
          ]}
        >
          {formatMoney(b.spendablePool)}
        </Text>
      </View>

      {Math.abs(carriedOver) > 0.009 ? (
        <View style={styles.noteBox}>
          <Icon name="info" size={15} color={palette.warningAmber} />
          <Text style={styles.noteText}>
            {formatMoney(Math.abs(carriedOver))} of this comes from debts and goals rather than
            this period. Those are running balances — starting a fresh budget clears your
            spending, but it does not clear what you owe or what you have set aside.
          </Text>
        </View>
      ) : null}

      <Text style={styles.footnote}>
        Spending here is only what happened since {shortDate(snapshot.periodStart)}. Anything
        earlier is kept for Insights but does not count against this budget.
      </Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  periodBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surfaceElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.sm,
  },
  periodText: { ...typography.caption, color: palette.textSecondary, flex: 1 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  rowText: { flex: 1 },
  rowLabel: { ...typography.body, color: palette.textPrimary },
  rowWindow: { ...typography.micro, color: palette.textMuted, marginTop: 1 },
  rowAmount: { ...typography.bodyBold },

  total: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  totalLabel: { ...typography.cardTitle, color: palette.textPrimary },
  totalAmount: { ...typography.bodyBold, fontSize: 24 },

  noteBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: layer(palette.warningAmber, 0.1),
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.warningAmber,
    padding: spacing.sm,
  },
  noteText: { ...typography.caption, color: palette.warningAmber, flex: 1, lineHeight: 17 },

  footnote: { ...typography.micro, color: palette.textMuted, lineHeight: 15 },
});
