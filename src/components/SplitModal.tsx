import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as db from '../db/dbService';
import { ContactRow, TransactionRow } from '../db/types';
import { calculateSplit } from '../math/splitEngine';
import { formatMoney } from '../utils/format';
import { Button, Chip, Field, Sheet } from './ui';
import { palette, radii, spacing, typography } from '../theme/theme';

interface Participant {
  contactId: number;
  name: string;
  included: boolean;
  ratio: number;
}

/**
 * Splits a bill you paid across the people who were there.
 *
 * You are always a participant — the common failure of split trackers is
 * dividing by the number of friends and quietly leaving the payer out, which
 * makes everyone owe more than they should. Only the others get IOUs; your own
 * share is simply what remains of the transaction.
 */
export default function SplitModal({
  visible,
  transaction,
  onClose,
  onSplit,
  outingId = null,
}: {
  visible: boolean;
  transaction: TransactionRow | null;
  onClose: () => void;
  onSplit: () => void;
  outingId?: number | null;
}) {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setNewName('');
    db.getContacts().then((rows) => {
      setContacts(rows);
      setParticipants(
        rows.map((contact) => ({
          contactId: contact.id,
          name: contact.name,
          included: false,
          ratio: 1,
        }))
      );
    });
  }, [visible]);

  const total = transaction?.amount ?? 0;
  const included = participants.filter((p) => p.included);

  // "You" is an implicit participant with ratio 1, so a 1,200 bill across you
  // plus two friends is 400 each, not 600 each.
  const shares = useMemo(() => {
    if (!transaction || included.length === 0) return [];
    return calculateSplit(total, [
      { contactId: -1, included: true, ratio: 1 },
      ...included.map((p) => ({ contactId: p.contactId, included: true, ratio: p.ratio })),
    ]);
  }, [transaction, included, total]);

  const yourShare = shares.find((s) => s.contactId === -1)?.amount ?? total;

  function toggle(contactId: number) {
    setParticipants((prev) =>
      prev.map((p) => (p.contactId === contactId ? { ...p, included: !p.included } : p))
    );
  }

  function bumpRatio(contactId: number) {
    setParticipants((prev) =>
      prev.map((p) =>
        p.contactId === contactId ? { ...p, ratio: p.ratio >= 3 ? 1 : p.ratio + 1 } : p
      )
    );
  }

  async function addPerson() {
    const name = newName.trim();
    if (!name) return;
    const id = await db.findOrCreateContactByName(name);
    const rows = await db.getContacts();
    setContacts(rows);
    setParticipants(
      rows.map((contact) => {
        const existing = participants.find((p) => p.contactId === contact.id);
        return (
          existing ?? {
            contactId: contact.id,
            name: contact.name,
            included: contact.id === id,
            ratio: 1,
          }
        );
      })
    );
    setNewName('');
  }

  async function save() {
    if (!transaction || included.length === 0 || saving) return;
    setSaving(true);
    try {
      for (const share of shares) {
        if (share.contactId === -1 || share.amount <= 0) continue;
        await db.createIOU({
          contactId: share.contactId,
          amount: share.amount,
          direction: 'THEY_OWE_ME',
          transactionId: transaction.id,
          reason: transaction.merchant,
          outingId: outingId ?? transaction.outing_id,
        });
      }
      onSplit();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Split this">
      {transaction ? (
        <View style={styles.summary}>
          <Text style={styles.summaryMerchant}>{transaction.merchant}</Text>
          <Text style={styles.summaryAmount}>{formatMoney(total)}</Text>
        </View>
      ) : null}

      <View style={styles.addRow}>
        <View style={styles.addField}>
          <Field
            label="Add someone"
            value={newName}
            onChangeText={setNewName}
            placeholder="Name"
            onSubmitEditing={addPerson}
            returnKeyType="done"
          />
        </View>
        <Button label="Add" variant="secondary" onPress={addPerson} style={styles.addButton} />
      </View>

      {contacts.length === 0 ? (
        <Text style={styles.hint}>Add the people who were there to split this with them.</Text>
      ) : (
        <View style={styles.list}>
          {participants.map((participant) => {
            const share = shares.find((s) => s.contactId === participant.contactId);
            return (
              <Pressable
                key={participant.contactId}
                onPress={() => toggle(participant.contactId)}
                style={({ pressed }) => [
                  styles.person,
                  participant.included && styles.personOn,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text
                  style={[styles.personName, participant.included && { color: palette.textPrimary }]}
                >
                  {participant.name}
                </Text>
                {participant.included ? (
                  <View style={styles.personRight}>
                    <Chip label={`×${participant.ratio}`} onPress={() => bumpRatio(participant.contactId)} />
                    <Text style={styles.personShare}>{formatMoney(share?.amount ?? 0)}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}

      {included.length > 0 ? (
        <View style={styles.youBlock}>
          <Text style={styles.youLabel}>Your share</Text>
          <Text style={styles.youAmount}>{formatMoney(yourShare)}</Text>
          <Text style={styles.youNote}>
            {formatMoney(total - yourShare)} comes back to you across {included.length}{' '}
            {included.length === 1 ? 'person' : 'people'}
          </Text>
        </View>
      ) : null}

      <Button
        label={saving ? 'Saving…' : 'Split it'}
        onPress={save}
        disabled={included.length === 0 || saving}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  summary: { alignItems: 'center', gap: 2 },
  summaryMerchant: { ...typography.body, color: palette.textSecondary },
  summaryAmount: { ...typography.display, color: palette.textPrimary },

  addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  addField: { flex: 1 },
  addButton: { paddingHorizontal: spacing.lg },

  hint: { ...typography.caption, color: palette.textMuted, textAlign: 'center' },

  list: { gap: spacing.sm },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radii.input,
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
  },
  personOn: { borderColor: palette.neonGreen },
  personName: { ...typography.bodyBold, color: palette.textSecondary },
  personRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  personShare: { ...typography.bodyBold, color: palette.neonGreen, minWidth: 64, textAlign: 'right' },

  youBlock: { alignItems: 'center', gap: 2, paddingVertical: spacing.sm },
  youLabel: { ...typography.heroLabel, color: palette.textSecondary },
  youAmount: { ...typography.display, color: palette.textPrimary },
  youNote: { ...typography.caption, color: palette.textMuted },
});
