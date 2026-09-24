import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Button, Field, Sheet } from './ui';
import { palette, spacing, typography } from '../theme/theme';
import * as db from '../db/dbService';
import { CapScope } from '../math/patterns';
import { formatMoney } from '../utils/format';

export interface CapDraft {
  scope: CapScope;
  label: string;
  /** Pre-filled amount: the suggestion, or the cap being edited. */
  amount: number;
  /** Set when editing an existing cap, so it can be removed. */
  id?: number;
  /** What this week has cost there so far. */
  spent?: number;
}

/**
 * A weekly cap on one merchant or category. It never blocks a payment — the
 * sheet says so — it gives every matching payment something to answer to.
 */
export default function CapSheet({
  draft,
  onClose,
  onSaved,
}: {
  draft: CapDraft | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAmount(draft ? String(Math.round(draft.amount)) : '');
    setBusy(false);
  }, [draft]);

  const parsed = Number(amount.replace(/[^\d.]/g, ''));
  const valid = Number.isFinite(parsed) && parsed > 0;

  async function save() {
    if (!draft || !valid || busy) return;
    setBusy(true);
    try {
      await db.setSpendCap(draft.scope, draft.label, parsed);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft?.id || busy) return;
    setBusy(true);
    try {
      await db.deleteSpendCap(draft.id);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={draft !== null} onClose={onClose} title={draft ? `Cap ${draft.label}` : ''}>
      <Text style={styles.body}>
        {draft?.spent !== undefined ? `${formatMoney(draft.spent)} so far this week. ` : ''}
        Pinch can't stop a payment, but every one past this line will hear about it.
      </Text>
      <Field
        label="A week, at most"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        hint="Resets every Monday."
      />
      <Button
        label={draft?.id ? 'Change the cap' : 'Set the cap'}
        onPress={save}
        disabled={!valid || busy}
      />
      {draft?.id ? (
        <Button label="Remove it" variant="ghost" onPress={remove} disabled={busy} />
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.body, color: palette.textSecondary, marginBottom: spacing.md },
});
