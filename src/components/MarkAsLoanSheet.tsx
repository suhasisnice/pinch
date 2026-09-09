import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as db from '../db/dbService';
import { TransactionRow } from '../db/types';
import { rankContactsBySplitHistory } from '../math/insights';
import { formatMoney } from '../utils/format';
import { palette, spacing, typography } from '../theme/theme';
import { Button, Chip, Field, Sheet } from './ui';
import ContactPicker from './ContactPicker';
import { isCaptureAvailable } from '../../modules/pinch-capture';

/**
 * Turns a payment into a debt.
 *
 * Splitting a bill was the only way to create an IOU, which quietly assumed
 * every debt starts as a shared expense. Plenty do not: lending someone money
 * outright, covering a fee they will pay back, being sent money you owe on
 * later. Those are the cleanest debts there are, and there was no way to
 * record them at all.
 *
 * The transaction itself is left alone. A loan out is still money that left
 * the account, and marking it only adds what is expected back — which is the
 * same shape a split uses, so the budget and "what you actually bore" already
 * understand it without any special case.
 */
export default function MarkAsLoanSheet({
  transaction,
  onClose,
  onSaved,
}: {
  transaction: TransactionRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ id: number; name: string }>>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  const lending = transaction?.direction === 'DEBIT';

  useEffect(() => {
    if (!transaction) return;
    setName('');
    setPhone(null);
    setAmount(String(transaction.amount));
    setReason(transaction.merchant);

    Promise.all([db.getContacts(), db.getSplitHistory()])
      .then(([contacts, history]) => {
        const ranked = rankContactsBySplitHistory(history).map((entry) => entry.contactId);
        const byId = new Map(contacts.map((c) => [c.id, c]));
        setSuggestions(
          ranked
            .map((id) => byId.get(id))
            .filter((c): c is NonNullable<typeof c> => c !== undefined)
            .slice(0, 6)
            .map((c) => ({ id: c.id, name: c.name }))
        );
      })
      .catch(() => setSuggestions([]));
  }, [transaction]);

  if (!transaction) return null;

  const parsed = Number(amount.replace(/[^\d.]/g, ''));
  const canSave = name.trim().length > 0 && Number.isFinite(parsed) && parsed > 0;
  const overAmount = parsed > transaction.amount + 0.01;

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const contactId = await db.findOrCreateContact({ name: name.trim(), phone });
      await db.createIOU({
        contactId,
        amount: parsed,
        // Money you paid out is owed back to you; money that arrived is
        // something you will have to return.
        direction: lending ? 'THEY_OWE_ME' : 'I_OWE_THEM',
        transactionId: transaction!.id,
        reason: reason.trim() || transaction!.merchant,
        outingId: transaction!.outing_id,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      visible={transaction !== null}
      onClose={onClose}
      title={lending ? 'Money you lent' : 'Money you borrowed'}
    >
      <Text style={styles.intro}>
        {lending
          ? `${formatMoney(transaction.amount)} to ${transaction.merchant}. Recording who owes it means it stops counting as money you spent on yourself, and starts counting as money on its way back.`
          : `${formatMoney(transaction.amount)} from ${transaction.merchant}. Recording it means it is not treated as allowance you can spend.`}
      </Text>

      {suggestions.length > 0 ? (
        <View style={styles.quickBlock}>
          <Text style={styles.quickLabel}>{lending ? 'Lent to' : 'Borrowed from'}</Text>
          <View style={styles.quickRow}>
            {suggestions.map((contact) => (
              <Chip
                key={contact.id}
                label={contact.name}
                selected={name === contact.name}
                onPress={() => {
                  setName(contact.name);
                  setPhone(null);
                }}
              />
            ))}
          </View>
        </View>
      ) : null}

      <Field
        label="Who"
        value={name}
        onChangeText={(next) => {
          setName(next);
          setPhone(null);
        }}
        placeholder="Rahul"
        hint={phone ? `Will nudge on ${phone}` : undefined}
      />

      {isCaptureAvailable ? (
        <Button
          label="Pick from contacts"
          variant="ghost"
          onPress={() => setPickerVisible(true)}
        />
      ) : null}

      <Field
        label="How much of it"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        hint={
          overAmount
            ? `That is more than the ${formatMoney(transaction.amount)} payment.`
            : 'Defaults to the whole payment — lower it if only part was a loan.'
        }
      />

      <Field label="What for" value={reason} onChangeText={setReason} placeholder="Lunch" />

      <Button
        label={saving ? 'Saving…' : lending ? 'They owe me this' : 'I owe them this'}
        onPress={save}
        disabled={!canSave || saving || overAmount}
      />

      <ContactPicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onPick={(contact) => {
          setName(contact.name);
          setPhone(contact.phone);
          setPickerVisible(false);
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  intro: { ...typography.body, color: palette.textSecondary, lineHeight: 20 },
  quickBlock: { gap: spacing.sm },
  quickLabel: {
    ...typography.micro,
    color: palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
