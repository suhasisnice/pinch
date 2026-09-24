import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BalanceConsistency } from '../math/budget';
import { formatMoney } from '../utils/format';
import { palette, spacing, typography } from '../theme/theme';
import { Button, Sheet } from './ui';

/**
 * What to do about money the ledger cannot account for.
 *
 * The gap itself was already being computed and shown; what was missing was
 * anywhere to go with it. A number telling you the app is wrong, with no
 * way to act, is worse than not knowing — so this offers the three answers
 * that actually exist, and deliberately does not offer to "fix" it by
 * inventing a transaction of its own (PRODUCT_SPEC §1.4: never silently
 * fabricate one).
 *
 * The direction matters and is easy to get backwards. A bank balance
 * *lower* than the ledger expects means money left that was never recorded
 * — a payment is missing. *Higher* means money arrived that was never
 * recorded.
 */
export default function ReconcileSheet({
  visible,
  consistency,
  onClose,
  onFindIt,
  onAddIt,
  onIgnore,
}: {
  visible: boolean;
  consistency: BalanceConsistency | null;
  onClose: () => void;
  /** Somewhere the missing message might already be sitting. */
  onFindIt: () => void;
  /** Record it by hand, as the correction it is. */
  onAddIt: (amount: number, direction: 'DEBIT' | 'CREDIT') => void;
  onIgnore: () => void;
}) {
  if (!consistency) return null;

  const gap = consistency.discrepancy;
  const missingSpend = gap < 0;
  const amount = Math.abs(gap);

  return (
    <Sheet visible={visible} onClose={onClose} title="Unaccounted money">
      <View style={styles.head}>
        <Text style={styles.amount}>{formatMoney(amount)}</Text>
        <Text style={styles.label}>
          {missingSpend ? 'left your account unrecorded' : 'arrived unrecorded'}
        </Text>
      </View>

      <Text style={styles.body}>
        {missingSpend
          ? 'Your bank has less than Pinch expects. Something was spent it never saw — cash, or a missed message.'
          : 'Your bank has more than Pinch expects. Something arrived it never saw.'}
      </Text>

      <Button label="Look for the message" variant="secondary" onPress={onFindIt} />
      <Text style={styles.hint}>
        Checks Review and unread messages.
      </Text>

      <Button
        label={`Add ${formatMoney(amount)} by hand`}
        variant="secondary"
        onPress={() => onAddIt(amount, missingSpend ? 'DEBIT' : 'CREDIT')}
      />
      <Text style={styles.hint}>
        Saved as an adjustment, not a purchase.
      </Text>

      <Button label="Leave it" variant="ghost" onPress={onIgnore} />
      <Text style={styles.hint}>
        Hides this until the gap changes.
      </Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', gap: 2 },
  amount: { ...typography.hero, color: palette.warning },
  label: { ...typography.caption, color: palette.textSecondary },
  body: {
    ...typography.body,
    color: palette.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  hint: { ...typography.caption, color: palette.textMuted },
});
