import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BalanceState, Pocket } from '../db/repos/balance';
import * as db from '../db/dbService';
import { formatMoney } from '../utils/format';
import { layer, palette, radii, spacing, typography } from '../theme/theme';
import { Button, Field, Sheet } from './ui';
import Icon from './Icon';
import { MASK, useMoneyReveal } from '../security/MoneyReveal';
import CushionFloor from './CushionFloor';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const COPY = {
  BANK: {
    title: 'In the bank',
    sheet: 'Bank balance',
    intro: "Type what your banking app shows. It's what you have, not what you can spend.",
    field: 'Balance right now',
    gap: 'usually cash, or a message Pinch missed.',
  },
  CASH: {
    title: 'Cash in wallet',
    sheet: 'Cash in wallet',
    intro: 'Count the notes in your wallet. Withdrawals add to it; payments you log as cash take from it.',
    field: 'Cash right now',
    gap: 'usually cash you spent and did not log.',
  },
};

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
 * make both wrong, so they sit on separate rows that never mix.
 *
 * Hidden by default. A balance is the one figure on this screen that is
 * nobody else's business, and phones get glanced at. The row lives inside
 * Today's "This period" group; tap it and a fingerprint or face reveals it
 * (see security/MoneyReveal.tsx), "Update" to record a new figure.
 */
export default function BalanceCard({
  state,
  onChanged,
  cushion,
  pocket = 'BANK',
}: {
  state: BalanceState;
  onChanged: () => void;
  /** Which figure this row shows: the bank account or the notes in the wallet. */
  pocket?: Pocket;
  /** The emergency cushion, drawn as a floor under the balance once it holds something. */
  cushion?: { saved: number; target: number } | null;
}) {
  const { revealed: shown, reveal, hide } = useMoneyReveal();
  const [editing, setEditing] = useState(false);

  const value = state.projected;
  const stale = state.snapshot !== null && (state.spentSince > 0 || state.receivedSince > 0);
  const meta =
    state.snapshot === null
      ? 'Add it once and Pinch keeps it current'
      : stale
        ? `Estimated since ${when(state.snapshot.recordedAt)}`
        : `Updated ${when(state.snapshot.recordedAt)}`;

  return (
    <>
      <View style={styles.row}>
        <Pressable
          style={({ pressed }) => [styles.main, pressed && styles.pressed]}
          onPress={() => (value === null ? setEditing(true) : shown ? hide() : void reveal())}
          accessibilityRole="button"
          accessibilityLabel={
            value === null ? `Add ${COPY[pocket].title}` : shown ? 'Hide balance' : 'Show balance'
          }
        >
          <View style={styles.text}>
            <Text style={styles.title}>{COPY[pocket].title}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          </View>
          {value === null ? null : (
            <View style={styles.valueRow}>
              <Text style={styles.value}>{shown ? formatMoney(value) : MASK}</Text>
              <Icon name={shown ? 'eye' : 'eyeOff'} size={15} color={palette.textMuted} />
            </View>
          )}
        </Pressable>
        <Pressable
          onPress={() => setEditing(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={value === null ? 'Add balance' : 'Update balance'}
          style={({ pressed }) => [styles.update, pressed && styles.pressed]}
        >
          <Text style={styles.updateText}>{value === null ? 'Add' : 'Update'}</Text>
        </Pressable>
      </View>
      {value !== null && cushion && cushion.saved > 0.009 ? (
        <View style={styles.floor}>
          <CushionFloor balance={value} saved={cushion.saved} target={cushion.target} masked={!shown} />
        </View>
      ) : null}

      <UpdateBalanceSheet
        visible={editing}
        state={state}
        pocket={pocket}
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
  pocket,
  onClose,
  onSaved,
}: {
  visible: boolean;
  state: BalanceState;
  pocket: Pocket;
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
      await db.recordBalance(parsed, new Date(), pocket);
      setAmount('');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={COPY[pocket].sheet}>
      <Text style={styles.intro}>{COPY[pocket].intro}</Text>

      <Field
        label={COPY[pocket].field}
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        placeholder="0"
      />

      {drift !== null && Math.abs(drift) > 0.5 ? (
        <View style={styles.driftBox}>
          <Icon name="info" size={15} color={palette.warning} />
          <Text style={styles.driftText}>
            {formatMoney(Math.abs(drift))} {drift < 0 ? 'less' : 'more'} than expected —{' '}
            {COPY[pocket].gap}
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

/** A titled figure in the same shape as the bank row, for a number that sits beside it. */
export function MoneyLine({
  title,
  meta,
  value,
  onPress,
}: {
  title: string;
  meta: string;
  value: number;
  onPress: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
        onPress={onPress}
        accessibilityRole="button"
      >
        <View style={styles.text}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.meta}>{meta}</Text>
        </View>
        <Text style={styles.value}>{formatMoney(value)}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
  },
  pressed: { opacity: 0.6 },
  floor: { paddingBottom: spacing.sm },
  text: { flex: 1, gap: 2 },
  title: { ...typography.body, color: palette.textPrimary },
  meta: { ...typography.caption, color: palette.textMuted },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  value: { ...typography.bodyBold, color: palette.textPrimary },
  update: {
    paddingVertical: 6,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: radii.pill,
    backgroundColor: palette.surfaceElevated,
  },
  updateText: { ...typography.caption, fontWeight: '600', color: palette.textPrimary },

  intro: { ...typography.body, color: palette.textSecondary, lineHeight: 20 },
  driftBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: layer(palette.warning, 0.1),
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.warning,
    padding: spacing.sm,
  },
  driftText: { ...typography.caption, color: palette.warning, flex: 1, lineHeight: 17 },
});
