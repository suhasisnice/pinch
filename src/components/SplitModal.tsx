import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as db from '../db/dbService';
import { ContactRow, TransactionRow } from '../db/types';
import {
  PAYER_ID,
  SPLIT_MODES,
  SPLIT_MODE_HINTS,
  SPLIT_MODE_LABELS,
  SplitMode,
  SplitParticipant,
  computeSplit,
} from '../math/splitEngine';
import { rankContactsBySplitHistory } from '../math/insights';
import { formatMoney } from '../utils/format';
import { Button, Chip, Field, Sheet } from './ui';
import Icon from './Icon';
import ContactPicker from './ContactPicker';
import { isCaptureAvailable } from '../../modules/pinch-capture';
import { layer, palette, radii, spacing, typography } from '../theme/theme';

interface Participant {
  contactId: number;
  name: string;
  included: boolean;
  ratio: number;
  /** EXACT mode only — kept as a string so a half-typed "12." isn't clobbered. */
  exactText: string;
}

/**
 * Splits a bill you paid across the people who were there, in one of three
 * modes:
 *
 * EQUAL  - down the middle, you included.
 * SHARES - weighted (someone who ordered two drinks pays for two).
 * EXACT  - type what each person actually owes, for an itemised bill.
 *
 * You are always a participant in EQUAL/SHARES — the common failure of split
 * trackers is dividing by the number of friends and quietly leaving the payer
 * out, which makes everyone owe more than they should. In EXACT your share is
 * simply what's left after the typed amounts.
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
  // Equal is right most of the time — someone paying for the table is
  // usually splitting evenly, not weighing who ordered what. Shares and
  // Exact stay one tap away for the times that isn't true.
  const [mode, setMode] = useState<SplitMode>('EQUAL');
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [ranking, setRanking] = useState<number[]>([]);

  useEffect(() => {
    if (!visible) return;
    setNewName('');
    setMode('EQUAL');
    Promise.all([db.getContacts(), db.getSplitHistory()]).then(([rows, history]) => {
      const ranked = rankContactsBySplitHistory(history).map((entry) => entry.contactId);
      setRanking(ranked);
      setContacts(rows);

      // Everyone you split with recently first, then the rest alphabetically:
      // a contact list imported from the phone is mostly people you will
      // never split a bill with, and they should not be in the way.
      const order = new Map(ranked.map((id, index) => [id, index]));
      const sorted = [...rows].sort((a, b) => {
        const ra = order.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const rb = order.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return ra - rb || a.name.localeCompare(b.name);
      });

      setParticipants(
        sorted.map((contact) => ({
          contactId: contact.id,
          name: contact.name,
          included: false,
          ratio: 1,
          exactText: '',
        }))
      );
    });
  }, [visible]);

  const total = transaction?.amount ?? 0;
  const included = participants.filter((p) => p.included);

  const asSplitParticipants: SplitParticipant[] = included.map((p) => ({
    contactId: p.contactId,
    included: true,
    ratio: p.ratio,
    exactAmount: Number(p.exactText.replace(/[^\d.]/g, '')) || 0,
  }));

  // EQUAL/SHARES: you take a weighted slice alongside everyone else, so a
  // 1,200 bill across you and two friends is 400 each. EXACT never includes
  // you here — your share is simply whatever the typed amounts leave behind.
  const result = useMemo(() => {
    if (!transaction || included.length === 0) return null;
    const forCompute =
      mode === 'EXACT'
        ? asSplitParticipants
        : [{ contactId: PAYER_ID, included: true, ratio: 1 }, ...asSplitParticipants];
    return computeSplit(total, forCompute, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transaction, total, mode, JSON.stringify(asSplitParticipants)]);

  const yourShare = result
    ? mode === 'EXACT'
      ? result.yourShare
      : (result.shares.find((s) => s.contactId === PAYER_ID)?.amount ?? total)
    : total;

  function toggle(contactId: number) {
    setParticipants((prev) =>
      prev.map((p) => (p.contactId === contactId ? { ...p, included: !p.included } : p))
    );
  }

  /** One tap for "same as usual" — the common case of eating with the same people every time. */
  function addEveryoneUsual() {
    const ids = new Set(quickAdd.map((p) => p.contactId));
    setParticipants((prev) => prev.map((p) => (ids.has(p.contactId) ? { ...p, included: true } : p)));
  }

  function bumpRatio(contactId: number) {
    setParticipants((prev) =>
      prev.map((p) =>
        p.contactId === contactId ? { ...p, ratio: p.ratio >= 4 ? 1 : p.ratio + 1 } : p
      )
    );
  }

  function setExactText(contactId: number, text: string) {
    setParticipants((prev) =>
      prev.map((p) => (p.contactId === contactId ? { ...p, exactText: text } : p))
    );
  }

  /** Fills every included person's box with an equal starting point. */
  function seedExactFromEqual() {
    if (!transaction || included.length === 0) return;
    const equal = computeSplit(
      total,
      [{ contactId: PAYER_ID, included: true }, ...asSplitParticipants],
      'EQUAL'
    );
    setParticipants((prev) =>
      prev.map((p) => {
        const share = equal.shares.find((s) => s.contactId === p.contactId);
        return p.included && share ? { ...p, exactText: share.amount ? String(share.amount) : p.exactText } : p;
      })
    );
  }

  async function addPerson(picked?: { name: string; phone: string | null }) {
    const name = (picked?.name ?? newName).trim();
    if (!name) return;
    const id = await db.findOrCreateContact({ name, phone: picked?.phone ?? null });
    const rows = await db.getContacts();
    setContacts(rows);

    // Keep the ranked order; rebuilding straight from the database would put
    // the list back into alphabetical order behind the user's back.
    const order = new Map(ranking.map((rankedId, index) => [rankedId, index]));
    const sorted = [...rows].sort((a, b) => {
      const ra = a.id === id ? -1 : order.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const rb = b.id === id ? -1 : order.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || a.name.localeCompare(b.name);
    });

    setParticipants(
      sorted.map((contact) => {
        const existing = participants.find((p) => p.contactId === contact.id);
        return (
          existing ?? {
            contactId: contact.id,
            name: contact.name,
            included: contact.id === id,
            ratio: 1,
            exactText: '',
          }
        );
      })
    );
    setNewName('');
  }

  async function save() {
    if (!transaction || included.length === 0 || saving || !result) return;
    setSaving(true);
    try {
      for (const share of result.shares) {
        if (share.contactId === PAYER_ID || share.amount <= 0) continue;
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

  // Only people you have actually split with before, and only those not
  // already added — a quick-add button for someone already in the list would
  // silently remove them.
  const quickAdd = ranking
    .map((id) => participants.find((p) => p.contactId === id))
    .filter((p): p is Participant => p !== undefined && !p.included)
    .slice(0, 6);

  const overAssigned = mode === 'EXACT' && (result?.overAssigned ?? false);

  return (
    <Sheet visible={visible} onClose={onClose} title="Split this">
      {transaction ? (
        <View style={styles.summary}>
          <Text style={styles.summaryMerchant}>{transaction.merchant}</Text>
          <Text style={styles.summaryAmount}>{formatMoney(total)}</Text>
        </View>
      ) : null}

      <View style={styles.modeRow}>
        {SPLIT_MODES.map((option) => (
          <Pressable
            key={option}
            onPress={() => {
              setMode(option);
              if (option === 'EXACT') seedExactFromEqual();
            }}
            style={({ pressed }) => [
              styles.modeButton,
              mode === option && styles.modeButtonOn,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.modeLabel, mode === option && styles.modeLabelOn]}>
              {SPLIT_MODE_LABELS[option]}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.modeHint}>{SPLIT_MODE_HINTS[mode]}</Text>

      {quickAdd.length > 0 ? (
        <View style={styles.quickBlock}>
          <View style={styles.quickHeader}>
            <Text style={styles.quickLabel}>Usually with</Text>
            {quickAdd.length > 1 ? (
              <Text style={styles.quickAddAll} onPress={addEveryoneUsual} suppressHighlighting>
                Add everyone
              </Text>
            ) : null}
          </View>
          <View style={styles.quickRow}>
            {quickAdd.map((participant) => (
              <Chip
                key={participant.contactId}
                label={`+ ${participant.name}`}
                onPress={() => toggle(participant.contactId)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.addRow}>
        <View style={styles.addField}>
          <Field
            label="Add someone"
            value={newName}
            onChangeText={setNewName}
            placeholder="Name"
            onSubmitEditing={() => addPerson()}
            returnKeyType="done"
          />
        </View>
        <Button
          label="Add"
          variant="secondary"
          onPress={() => addPerson()}
          style={styles.addButton}
        />
      </View>

      {isCaptureAvailable ? (
        <Button
          label="Pick from contacts"
          variant="ghost"
          onPress={() => setPickerVisible(true)}
        />
      ) : null}

      <ContactPicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onPick={(contact) => {
          setPickerVisible(false);
          addPerson(contact);
        }}
      />

      {contacts.length === 0 ? (
        <Text style={styles.hint}>Add the people who were there to split this with them.</Text>
      ) : (
        <View style={styles.list}>
          {included.length > 0 ? (
            // Pinned first and not toggleable — you paid, so you are always
            // in this. Shown in the same list as everyone else rather than
            // only in the summary below, so the whole split reads as one
            // picture: who owes what, you included, at a glance.
            <View style={[styles.person, styles.personYou]}>
              <Text style={[styles.personName, styles.personYouName]}>You</Text>
              <Text style={styles.personShare}>{formatMoney(yourShare)}</Text>
            </View>
          ) : null}
          {participants.map((participant) => {
            const share = result?.shares.find((s) => s.contactId === participant.contactId);
            return (
              <Pressable
                key={participant.contactId}
                onPress={() => mode !== 'EXACT' && toggle(participant.contactId)}
                style={({ pressed }) => [
                  styles.person,
                  participant.included && styles.personOn,
                  pressed && mode !== 'EXACT' && { opacity: 0.7 },
                ]}
              >
                <View style={styles.personLeft}>
                  {mode === 'EXACT' ? (
                    <Pressable
                      onPress={() => toggle(participant.contactId)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`${participant.included ? "Remove" : "Add"} ${participant.name}`}
                    >
                      <Icon
                        name={participant.included ? 'check' : 'add'}
                        size={16}
                        color={participant.included ? palette.primary : palette.textMuted}
                      />
                    </Pressable>
                  ) : null}
                  <Text
                    style={[
                      styles.personName,
                      participant.included && { color: palette.textPrimary },
                    ]}
                  >
                    {participant.name}
                  </Text>
                </View>

                {participant.included && mode === 'SHARES' ? (
                  <View style={styles.personRight}>
                    <Chip
                      label={`×${participant.ratio}`}
                      onPress={() => bumpRatio(participant.contactId)}
                    />
                    <Text style={styles.personShare}>{formatMoney(share?.amount ?? 0)}</Text>
                  </View>
                ) : null}

                {participant.included && mode === 'EQUAL' ? (
                  <Text style={styles.personShare}>{formatMoney(share?.amount ?? 0)}</Text>
                ) : null}

                {participant.included && mode === 'EXACT' ? (
                  <View style={styles.exactField}>
                    <Text style={styles.exactPrefix}>₹</Text>
                    <TextInput
                      value={participant.exactText}
                      onChangeText={(text) => setExactText(participant.contactId, text)}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={palette.textMuted}
                      style={styles.exactInput}
                    />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}

      {overAssigned ? (
        <View style={styles.warningBanner}>
          <Icon name="warning" size={16} color={palette.warningAmber} />
          <Text style={styles.warningText}>
            That's {formatMoney((result?.assigned ?? 0) - total)} more than the bill — check the
            amounts.
          </Text>
        </View>
      ) : null}

      {included.length > 0 ? (
        <View style={styles.youBlock}>
          <Text style={styles.youLabel}>Your share</Text>
          <Text style={[styles.youAmount, overAssigned && { color: palette.danger }]}>
            {formatMoney(yourShare)}
          </Text>
          <Text style={styles.youNote}>
            {formatMoney(total - yourShare)} comes back to you across {included.length}{' '}
            {included.length === 1 ? 'person' : 'people'}
          </Text>
        </View>
      ) : null}

      <Button
        label={saving ? 'Saving…' : 'Split it'}
        onPress={save}
        disabled={included.length === 0 || saving || overAssigned}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  summary: { alignItems: 'center', gap: 2 },
  summaryMerchant: { ...typography.body, color: palette.textSecondary },
  summaryAmount: { ...typography.display, color: palette.textPrimary },

  modeRow: {
    flexDirection: 'row',
    backgroundColor: palette.surfaceContainerHigh,
    borderRadius: radii.pill,
    padding: 4,
    gap: 4,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radii.pill,
    alignItems: 'center',
  },
  modeButtonOn: { backgroundColor: palette.secondaryContainer },
  modeLabel: { ...typography.caption, color: palette.textSecondary, fontWeight: '700' },
  modeLabelOn: { color: palette.onSecondaryContainer },
  modeHint: { ...typography.micro, color: palette.textMuted, textAlign: 'center' },

  addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  addField: { flex: 1 },
  addButton: { paddingHorizontal: spacing.lg },

  hint: { ...typography.caption, color: palette.textMuted, textAlign: 'center' },

  quickBlock: { gap: spacing.sm },
  quickHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quickLabel: {
    ...typography.micro,
    color: palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  quickAddAll: { ...typography.micro, color: palette.primary },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },

  list: { gap: spacing.sm },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: palette.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: palette.border,
  },
  personOn: { borderColor: palette.primary },
  personYou: { backgroundColor: palette.surfaceContainerHighest, borderColor: 'transparent' },
  personYouName: { color: palette.textPrimary },
  personLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  personName: { ...typography.bodyBold, color: palette.textSecondary },
  personRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  personShare: { ...typography.bodyBold, color: palette.primary, minWidth: 64, textAlign: 'right' },

  exactField: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  exactPrefix: { ...typography.bodyBold, color: palette.textMuted },
  exactInput: {
    ...typography.bodyBold,
    color: palette.textPrimary,
    minWidth: 64,
    textAlign: 'right',
    paddingVertical: 0,
  },

  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: layer(palette.warningAmber, 0.12),
    borderWidth: 1,
    borderColor: palette.warningAmber,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  warningText: { ...typography.caption, color: palette.warningAmber, flex: 1 },

  youBlock: { alignItems: 'center', gap: 2, paddingVertical: spacing.sm },
  youLabel: { ...typography.heroLabel, color: palette.textSecondary },
  youAmount: { ...typography.display, color: palette.textPrimary },
  youNote: { ...typography.caption, color: palette.textMuted },
});
