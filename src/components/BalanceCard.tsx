import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BalanceState } from '../db/repos/balance';
import * as db from '../db/dbService';
import { formatMoney } from '../utils/format';
import { palette, radii, spacing, typography } from '../theme/theme';
import { Button, Card, Field, Sheet } from './ui';
import Icon from './Icon';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function when(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * What is actually in the bank, kept deliberately apart from the budget.
 *
 * Safe-to-Spend answers "what may I spend today" and is shaped by goals,
 * debts and the length of the period. Balance answers "what is there", and
 * nothing shapes it but the money itself. Showing them as one number would
 * make both wrong, so they sit in separate cards that never mix.
 *
 * Hidden by default. A balance is the one figure on this screen that is
 * nobody else's business, and phones get glanced at.
 */
export default function BalanceCard({
  state,
  onChanged,
}: {
  state: BalanceState;
  onChanged: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [editing, setEditing] = useState(false);

  const value = state.projected;
  const stale = state.snapshot !== null && (state.spentSince > 0 || state.receivedSince > 0);

  return (
    <>
      <Card style={styles.card}>
        <View style={styles.head}>
          <Text style={styles.label}>In the bank</Text>
          <Pressable onPress={() => setShown((v) => !v)} hitSlop={12}>
            <Icon name={shown ? 'eye' : 'eyeOff'} size={16} color={palette.textMuted} />
          </Pressable>
        </View>

        {value === null ? (
          <Pressable onPress={() => setEditing(true)}>
            <Text style={styles.empty}>Tap to add your balance</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => setShown((v) => !v)}>
            <Text style={styles.amount}>{shown ? formatMoney(value) : '••••••'}</Text>
          </Pressable>
        )}

        {state.snapshot !== null ? (
          <Text style={styles.meta}>
            {stale
              ? `From ${formatMoney(state.snapshot.amount)} on ${when(
                  state.snapshot.recordedAt
                )}, less ${formatMoney(state.spentSince)} out and ${formatMoney(
                  state.receivedSince
                )} in`
              : `As you entered it on ${when(state.snapshot.recordedAt)}`}
          </Text>
        ) : null}

        <Pressable onPress={() => setEditing(true)} hitSlop={8}>
          <Text style={styles.update}>
            {state.snapshot === null ? 'Add balance' : 'Update from your bank'}
          </Text>
        </Pressable>
      </Card>

      <UpdateBalanceSheet
        visible={editing}
        state={state}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onChanged();
        }}
      />
    </>
  );
}

function UpdateBalanceSheet({
  visible,
  state,
  onClose,
  onSaved,
}: {
  visible: boolean;
  state: BalanceState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const parsed = Number(amount.replace(/[^\d.]/g, ''));
  const canSave = Number.isFinite(parsed) && parsed >= 0 && amount.trim().length > 0;

  // The gap between what the app thinks and what the bank says is the only
  // honest measure of what it is failing to capture.
  const drift = canSave && state.projected !== null ? parsed - state.projected : null;

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await db.recordBalance(parsed);
      setAmount('');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Bank balance">
      <Text style={styles.intro}>
        Check your banking app and type what it says. This is kept separate from your budget —
        it is what you have, not what you may spend.
      </Text>

      <Field
        label="Balance right now"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        placeholder="0"
      />

      {drift !== null && Math.abs(drift) > 0.5 ? (
        <View style={styles.driftBox}>
          <Icon name="info" size={15} color={palette.warningAmber} />
          <Text style={styles.driftText}>
            {formatMoney(Math.abs(drift))}{' '}
            {drift < 0 ? 'less' : 'more'} than Pinch expected. That gap is usually cash spending,
            or a message it could not read — worth a look in Transactions if it keeps growing.
          </Text>
        </View>
      ) : null}

      <Button
        label={saving ? 'Saving…' : 'Save balance'}
        onPress={save}
        disabled={!canSave || saving}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  card: { gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: {
    ...typography.micro,
    color: palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  amount: { ...typography.heroCompact, fontSize: 30, color: palette.textPrimary, marginTop: 2 },
  empty: { ...typography.body, color: palette.textMuted, marginTop: spacing.xs },
  meta: { ...typography.micro, color: palette.textMuted, marginTop: 2, lineHeight: 15 },
  update: { ...typography.caption, color: palette.primary, marginTop: spacing.sm },

  intro: { ...typography.body, color: palette.textSecondary, lineHeight: 20 },
  driftBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,191,0,0.10)',
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: palette.warningAmber,
    padding: spacing.sm,
  },
  driftText: { ...typography.caption, color: palette.warningAmber, flex: 1, lineHeight: 17 },
});
