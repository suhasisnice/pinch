import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as db from '../db/dbService';
import { ContactRow, TransactionRow } from '../db/types';
import { PAYER_ID, computeSplit } from '../math/splitEngine';
import { rankContactsBySplitHistory } from '../math/insights';
import { formatMoney } from '../utils/format';
import { palette, spacing, typography } from '../theme/theme';
import { Button, Chip, Field, Sheet } from './ui';
import ContactPicker from './ContactPicker';
import { isCaptureAvailable } from '../../modules/pinch-capture';

/**
 * "I paid for someone" in one pass, for going down the day's spending at
 * the end of it.
 *
 * The two sheets that already existed each solve half of this and both cost
 * several taps to reach: MarkAsLoanSheet records one person owing the whole
 * payment, SplitModal divides a bill with modes, ratios and typed amounts.
 * Almost every real end-of-day case is neither — it is "these two were
 * there, split it" or "that one was entirely for them", answered in a
 * couple of taps and moved past.
 *
 * So this offers exactly those two shapes and nothing else. Anything more
 * particular still has the full split flow behind it; this is the fast path,
 * not a replacement.
 */
type Mode = 'EVEN' | 'THEIRS';

export default function QuickReimburseSheet({
  transaction,
  onClose,
  onSaved,
}: {
  transaction: TransactionRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [suggested, setSuggested] = useState<ContactRow[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [mode, setMode] = useState<Mode>('EVEN');
  const [newName, setNewName] = useState('');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  const total = transaction?.amount ?? 0;

  useEffect(() => {
    if (!transaction) return;
    setSelected([]);
    setMode('EVEN');
    setNewName('');

    Promise.all([db.getContacts(), db.getSplitHistory()])
      .then(([rows, history]) => {
        setContacts(rows);
        // People you actually split with, most recent and most often first —
        // a contact list imported from the phone is mostly people you will
        // never share a bill with, and they should not be in the way.
        const ranked = rankContactsBySplitHistory(history).map((entry) => entry.contactId);
        const byId = new Map(rows.map((row) => [row.id, row]));
        setSuggested(
          ranked
            .map((id) => byId.get(id))
            .filter((row): row is ContactRow => row !== undefined)
            .slice(0, 8)
        );
      })
      .catch(() => {
        setContacts([]);
        setSuggested([]);
      });
  }, [transaction]);

  /**
   * EVEN counts you as one of the party, so a 1,200 bill across you and two
   * friends leaves you carrying 400 — not recovering the whole thing. THEIRS
   * leaves you carrying nothing, which is what "I was just paying for them"
   * means. Both go through computeSplit so the rounding matches the full
   * split flow to the paisa rather than being reimplemented here.
   */
  const shares = useMemo(() => {
    if (!transaction || selected.length === 0) return null;
    const participants = selected.map((contactId) => ({ contactId, included: true }));
    const result = computeSplit(
      total,
      mode === 'EVEN' ? [{ contactId: PAYER_ID, included: true }, ...participants] : participants,
      'EQUAL'
    );
    return result.shares.filter((share) => share.contactId !== PAYER_ID && share.amount > 0);
  }, [transaction, total, mode, selected]);

  const comingBack = shares?.reduce((sum, share) => sum + share.amount, 0) ?? 0;
  const yourShare = total - comingBack;

  function toggle(contactId: number) {
    setSelected((prev) =>
      prev.includes(contactId) ? prev.filter((id) => id !== contactId) : [...prev, contactId]
    );
  }

  async function addPerson(picked?: { name: string; phone: string | null }) {
    const name = (picked?.name ?? newName).trim();
    if (!name) return;
    const id = await db.findOrCreateContact({ name, phone: picked?.phone ?? null });
    const rows = await db.getContacts();
    setContacts(rows);

    const added = rows.find((row) => row.id === id);
    if (added && !suggested.some((row) => row.id === id)) {
      setSuggested((prev) => [added, ...prev]);
    }
    setSelected((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setNewName('');
  }

  async function save() {
    if (!transaction || !shares || shares.length === 0 || saving) return;
    setSaving(true);
    try {
      for (const share of shares) {
        await db.createIOU({
          contactId: share.contactId,
          amount: share.amount,
          direction: 'THEY_OWE_ME',
          transactionId: transaction.id,
          reason: transaction.merchant,
          outingId: transaction.outing_id,
        });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  if (!transaction) return null;

  const nameOf = (contactId: number) =>
    contacts.find((row) => row.id === contactId)?.name ?? 'Someone';

  return (
    <Sheet visible={transaction !== null} onClose={onClose} title="Who was this for?">
      <View style={styles.summary}>
        <Text style={styles.merchant}>{transaction.merchant}</Text>
        <Text style={styles.amount}>{formatMoney(total)}</Text>
      </View>

      {suggested.length > 0 ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Who else</Text>
          <View style={styles.chipWrap}>
            {suggested.map((contact) => (
              <Chip
                key={contact.id}
                label={contact.name}
                selected={selected.includes(contact.id)}
                onPress={() => toggle(contact.id)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.addRow}>
        <View style={styles.flex}>
          <Field
            label="Add someone"
            value={newName}
            onChangeText={setNewName}
            placeholder="Name"
            onSubmitEditing={() => addPerson()}
            returnKeyType="done"
          />
        </View>
        <Button label="Add" variant="secondary" onPress={() => addPerson()} />
      </View>

      {isCaptureAvailable ? (
        <Button label="Pick from contacts" variant="ghost" onPress={() => setPickerVisible(true)} />
      ) : null}

      {selected.length > 0 ? (
        <>
          <View style={styles.group}>
            <Text style={styles.groupLabel}>How much of it</Text>
            <View style={styles.chipWrap}>
              <Chip
                label="Split evenly"
                selected={mode === 'EVEN'}
                onPress={() => setMode('EVEN')}
              />
              <Chip
                label="All theirs"
                selected={mode === 'THEIRS'}
                onPress={() => setMode('THEIRS')}
              />
            </View>
          </View>

          <View style={styles.preview}>
            <Text style={styles.previewBack}>{formatMoney(comingBack)} comes back to you</Text>
            <Text style={styles.previewMine}>
              {yourShare > 0.009
                ? `${formatMoney(yourShare)} of it was yours`
                : 'None of it was yours'}
            </Text>
            {shares && shares.length > 1 ? (
              <Text style={styles.previewEach}>
                {shares.map((share) => `${nameOf(share.contactId)} ${formatMoney(share.amount)}`).join(' · ')}
              </Text>
            ) : null}
          </View>
        </>
      ) : null}

      <Button
        label={saving ? 'Saving…' : 'They owe me this'}
        onPress={save}
        disabled={selected.length === 0 || saving}
      />

      <ContactPicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onPick={(contact) => {
          setPickerVisible(false);
          addPerson(contact);
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  summary: { alignItems: 'center', gap: 2 },
  merchant: { ...typography.body, color: palette.textSecondary },
  amount: { ...typography.display, color: palette.textPrimary },

  group: { gap: spacing.sm },
  groupLabel: {
    ...typography.sectionLabel,
    color: palette.textSecondary,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },

  addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  flex: { flex: 1 },

  preview: { alignItems: 'center', gap: 2, paddingVertical: spacing.sm },
  previewBack: { ...typography.cardTitle, color: palette.accent },
  previewMine: { ...typography.caption, color: palette.textSecondary },
  previewEach: { ...typography.micro, color: palette.textMuted, marginTop: 2 },
});
