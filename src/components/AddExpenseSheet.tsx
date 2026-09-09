import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as db from '../db/dbService';
import { postTransaction } from '../services/captureService';
import { CATEGORIES } from '../db/schema';
import { OutingSummary } from '../db/repos/outings';
import { Button, Chip, Field, Sheet } from './ui';
import { palette, spacing, typography } from '../theme/theme';

export default function AddExpenseSheet({
  visible,
  onClose,
  onSaved,
  defaultOutingId = null,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  defaultOutingId?: number | null;
}) {
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [direction, setDirection] = useState<'DEBIT' | 'CREDIT'>('DEBIT');
  const [outingId, setOutingId] = useState<number | null>(defaultOutingId);
  const [outings, setOutings] = useState<OutingSummary[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setAmount('');
    setMerchant('');
    setCategory(null);
    setDirection('DEBIT');
    setOutingId(defaultOutingId);
    db.getOutings(false).then(setOutings).catch(() => setOutings([]));
  }, [visible, defaultOutingId]);

  const parsedAmount = Number(amount.replace(/[^\d.]/g, ''));
  const canSave = Number.isFinite(parsedAmount) && parsedAmount > 0 && merchant.trim().length > 0;

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await postTransaction({
        amount: parsedAmount,
        direction,
        merchant: merchant.trim(),
        category,
        outingId,
        source: 'MANUAL',
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Add expense">
      <View style={styles.toggleRow}>
        <Chip label="Spent" selected={direction === 'DEBIT'} onPress={() => setDirection('DEBIT')} />
        <Chip
          label="Received"
          selected={direction === 'CREDIT'}
          onPress={() => setDirection('CREDIT')}
          color={palette.mint}
        />
      </View>

      <Field
        label="Amount"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        placeholder="0"
        autoFocus
      />
      <Field
        label={direction === 'DEBIT' ? 'Where' : 'From whom'}
        value={merchant}
        onChangeText={setMerchant}
        placeholder={direction === 'DEBIT' ? 'Swiggy' : 'Rahul'}
      />

      {direction === 'DEBIT' ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Category</Text>
          <View style={styles.chipWrap}>
            {CATEGORIES.map((option) => (
              <Chip
                key={option}
                label={option}
                selected={category === option}
                onPress={() => setCategory(category === option ? null : option)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {direction === 'DEBIT' && outings.length > 0 ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Part of an outing?</Text>
          <View style={styles.chipWrap}>
            {outings.map((outing) => (
              <Chip
                key={outing.id}
                label={`${outing.emoji} ${outing.name}`}
                selected={outingId === outing.id}
                onPress={() => setOutingId(outingId === outing.id ? null : outing.id)}
                color={palette.violet}
              />
            ))}
          </View>
        </View>
      ) : null}

      <Button label={saving ? 'Saving…' : 'Save'} onPress={save} disabled={!canSave || saving} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  toggleRow: { flexDirection: 'row', gap: spacing.sm },
  group: { gap: spacing.sm },
  groupLabel: {
    ...typography.micro,
    color: palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
