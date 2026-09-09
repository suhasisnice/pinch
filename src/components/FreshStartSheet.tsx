import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import * as db from '../db/dbService';
import { setMonthlyAllowance } from '../settings/settingsStore';
import { getSpendingHistorySummary, SpendingHistorySummary } from '../services/budgetService';
import { formatMoney } from '../utils/format';
import { palette, radii, spacing, typography } from '../theme/theme';
import { Button, Field, Sheet } from './ui';
import Icon from './Icon';

const HISTORY_WINDOW_DAYS = 90;

/** "Food (62%) and Transport (25%)" from the largest one or two categories. */
function describeCategories(categories: SpendingHistorySummary['topCategories']): string {
  return categories
    .slice(0, 2)
    .map((c) => `${c.category} (${Math.round(c.fraction * 100)}%)`)
    .join(' and ');
}

/**
 * One factual line about where the last few months actually went.
 *
 * Never mentions the total, on purpose — a rupee figure here reads as a
 * suggestion for the new number, which is exactly the trap this sheet
 * exists to avoid. Shape (subscriptions, biggest categories) is useful
 * context; the size of the old habit is not.
 */
function historyLine(summary: SpendingHistorySummary): string {
  const parts: string[] = [];
  if (summary.recurringCount > 0) {
    const count = summary.recurringCount;
    parts.push(
      `${formatMoney(summary.recurringMonthly)}/mo already going to ${count} subscription${count === 1 ? '' : 's'}`
    );
  }
  const categories = describeCategories(summary.topCategories);
  if (categories) parts.push(`most of it was ${categories}`);
  return parts.join(' · ');
}

/**
 * Starts the budget over from what is actually in the account today.
 *
 * The normal allowance flow assumes the past predicts the future — that what
 * was spent last month is the shape of this month. That assumption breaks
 * constantly: a couple of months of buying things for family is not a
 * spending habit, and letting it set the baseline makes every number wrong
 * and every warning noise.
 *
 * So this asks one question the user can answer exactly — how much have you
 * got right now — and refuses to look at history at all.
 */
export default function FreshStartSheet({
  visible,
  onClose,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [balance, setBalance] = useState('');
  const [days, setDays] = useState('30');
  const [forgetHistory, setForgetHistory] = useState(false);
  const [counts, setCounts] = useState<{ transactions: number } | null>(null);
  const [history, setHistory] = useState<SpendingHistorySummary | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setBalance('');
    setDays('30');
    setForgetHistory(false);
    setHistory(null);
    db.countData().then(setCounts).catch(() => setCounts(null));
    getSpendingHistorySummary(new Date(), HISTORY_WINDOW_DAYS)
      .then(setHistory)
      .catch(() => setHistory(null));
  }, [visible]);

  const parsedBalance = Number(balance.replace(/[^\d.]/g, ''));
  const parsedDays = Number(days.replace(/[^\d]/g, '')) || 30;
  const canSave = Number.isFinite(parsedBalance) && parsedBalance > 0;

  const perDay = canSave ? parsedBalance / parsedDays : 0;

  async function start() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      if (forgetHistory) {
        await db.resetData({ ledger: true });
      }

      // Every old period goes, so nothing that overlaps today can win the
      // "which period am I in" race and drag old spending back into view.
      await db.resetData({ periods: true });

      await setMonthlyAllowance(parsedBalance);
      await db.startBudgetPeriod({ allowance: parsedBalance, days: parsedDays });

      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Start fresh">
      <View style={styles.intro}>
        <Icon name="wallet" size={22} color={palette.primary} />
        <Text style={styles.introText}>
          Forget what happened before. Tell Pinch what you have now, and today becomes day one.
        </Text>
      </View>

      {history ? (
        <View style={styles.historyNote}>
          <Icon name="insights" size={14} color={palette.textMuted} />
          <Text style={styles.historyText}>
            Last {HISTORY_WINDOW_DAYS} days, for context: {historyLine(history)}. Doesn't set your
            number — that part's still yours.
          </Text>
        </View>
      ) : null}

      <Field
        label="How much do you have right now?"
        value={balance}
        onChangeText={setBalance}
        keyboardType="numeric"
        placeholder="0"
        hint="Whatever is actually in your account and cash in hand."
      />

      <Field
        label="How long does it need to last?"
        value={days}
        onChangeText={setDays}
        keyboardType="numeric"
        placeholder="30"
        hint="Until your next allowance lands, not the 1st of the month."
      />

      {canSave ? (
        <View style={styles.preview}>
          <Text style={styles.previewLabel}>That works out to</Text>
          <Text style={styles.previewAmount}>{formatMoney(perDay)}</Text>
          <Text style={styles.previewSub}>a day for {parsedDays} days</Text>
        </View>
      ) : null}

      <View style={styles.toggleRow}>
        <View style={styles.toggleText}>
          <Text style={styles.toggleLabel}>Also delete past transactions</Text>
          <Text style={styles.toggleHint}>
            {counts
              ? `Off by default — your ${counts.transactions} old transactions stay for Insights, but none of them count against this budget.`
              : 'Old transactions stay for Insights but do not count against this budget.'}
          </Text>
        </View>
        <Switch
          value={forgetHistory}
          onValueChange={setForgetHistory}
          trackColor={{ false: palette.surfaceHigh, true: palette.danger }}
          thumbColor={palette.textPrimary}
        />
      </View>

      <Button
        label={saving ? 'Starting…' : 'Start from today'}
        onPress={start}
        disabled={!canSave || saving}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  intro: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  introText: { ...typography.body, color: palette.textSecondary, flex: 1, lineHeight: 20 },

  historyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  historyText: { ...typography.caption, color: palette.textMuted, flex: 1, lineHeight: 17 },

  preview: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.md,
    backgroundColor: palette.surfaceElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.border,
  },
  previewLabel: { ...typography.micro, color: palette.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  previewAmount: { ...typography.display, color: palette.primary },
  previewSub: { ...typography.caption, color: palette.textMuted },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  toggleText: { flex: 1 },
  toggleLabel: { ...typography.body, color: palette.textPrimary },
  toggleHint: { ...typography.micro, color: palette.textMuted, marginTop: 2, lineHeight: 15 },
});
