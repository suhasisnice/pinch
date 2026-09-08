import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import GlassSurface from './GlassSurface';
import { addContact, createIOU, getContacts } from '../db/dbService';
import { ContactRow } from '../db/types';
import { calculateSplit, SplitParticipant } from '../math/splitEngine';
import { palette, radii, spacing, typography } from '../theme/theme';

interface SplitModalProps {
  visible: boolean;
  transactionId: number | null;
  amount: number;
  merchant: string;
  onClose: () => void;
  onCreated?: () => void;
}

interface ParticipantState {
  contactId: number;
  name: string;
  included: boolean;
  ratio: number;
}

function formatRupees(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return `₹${rounded.toLocaleString('en-IN')}`;
}

/**
 * Glassmorphism modal for splitting a just-logged debit transaction across
 * contacts. Wraps Phase 1's calculateSplit (even split / exclude toggles /
 * ratio multipliers) and, on confirm, persists one createIOU per included
 * participant via Phase 1's dbService.
 */
export default function SplitModal({
  visible,
  transactionId,
  amount,
  merchant,
  onClose,
  onCreated,
}: SplitModalProps) {
  const [participants, setParticipants] = useState<ParticipantState[]>([]);
  const [evenSplit, setEvenSplit] = useState(true);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    getContacts()
      .then((contacts: ContactRow[]) => {
        setParticipants(
          contacts.map((c) => ({ contactId: c.id, name: c.name, included: false, ratio: 1 }))
        );
      })
      .catch(() => setError('Could not load contacts.'));
  }, [visible]);

  const splitInput: SplitParticipant[] = useMemo(
    () =>
      participants.map((p) => ({
        contactId: p.contactId,
        included: p.included,
        ratio: evenSplit ? 1 : p.ratio,
      })),
    [participants, evenSplit]
  );

  const shares = useMemo(() => {
    if (amount <= 0) return [];
    try {
      return calculateSplit(amount, splitInput);
    } catch {
      return [];
    }
  }, [amount, splitInput]);

  const shareByContact = useMemo(() => new Map(shares.map((s) => [s.contactId, s.amount])), [shares]);
  const includedCount = participants.filter((p) => p.included).length;

  function toggleIncluded(contactId: number) {
    setParticipants((prev) =>
      prev.map((p) => (p.contactId === contactId ? { ...p, included: !p.included } : p))
    );
  }

  function adjustRatio(contactId: number, delta: number) {
    setParticipants((prev) =>
      prev.map((p) =>
        p.contactId === contactId ? { ...p, ratio: Math.max(1, Math.min(9, p.ratio + delta)) } : p
      )
    );
  }

  async function handleAddGhost() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      const contactId = await addContact(trimmed, true);
      setParticipants((prev) => [...prev, { contactId, name: trimmed, included: true, ratio: 1 }]);
      setNewName('');
    } catch {
      setError('Could not add that contact.');
    }
  }

  async function handleConfirm() {
    if (!transactionId || includedCount === 0) return;
    setSaving(true);
    setError(null);
    try {
      for (const participant of participants) {
        if (!participant.included) continue;
        const share = shareByContact.get(participant.contactId) ?? 0;
        if (share <= 0) continue;
        await createIOU(transactionId, participant.contactId, share);
      }
      onCreated?.();
      onClose();
    } catch {
      setError('Could not save the split. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <GlassSurface style={styles.modal}>
          <View style={styles.content}>
            <Text style={typography.heroLabel}>Split this expense</Text>
            <Text style={styles.amount}>
              {formatRupees(amount)} at {merchant}
            </Text>

            <View style={styles.evenSplitRow}>
              <Text style={typography.bodyBold}>Even split</Text>
              <Switch
                value={evenSplit}
                onValueChange={setEvenSplit}
                trackColor={{ true: palette.neonGreen, false: palette.border }}
                thumbColor={palette.textPrimary}
              />
            </View>

            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {participants.map((p) => (
                <View key={p.contactId} style={styles.participantRow}>
                  <Pressable
                    style={[styles.checkbox, p.included && styles.checkboxChecked]}
                    onPress={() => toggleIncluded(p.contactId)}
                  >
                    {p.included ? <Text style={styles.checkboxMark}>✓</Text> : null}
                  </Pressable>

                  <Text style={styles.participantName} numberOfLines={1}>
                    {p.name}
                  </Text>

                  {!evenSplit && p.included ? (
                    <View style={styles.ratioStepper}>
                      <Pressable onPress={() => adjustRatio(p.contactId, -1)} style={styles.ratioButton}>
                        <Text style={styles.ratioButtonText}>−</Text>
                      </Pressable>
                      <Text style={styles.ratioValue}>×{p.ratio}</Text>
                      <Pressable onPress={() => adjustRatio(p.contactId, 1)} style={styles.ratioButton}>
                        <Text style={styles.ratioButtonText}>+</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  <Text style={styles.participantShare}>
                    {p.included ? formatRupees(shareByContact.get(p.contactId) ?? 0) : '—'}
                  </Text>
                </View>
              ))}
            </ScrollView>

            <View style={styles.ghostRow}>
              <TextInput
                style={styles.ghostInput}
                placeholder="+ Type a name"
                placeholderTextColor={palette.textMuted}
                value={newName}
                onChangeText={setNewName}
                onSubmitEditing={handleAddGhost}
              />
              <Pressable style={styles.ghostAddButton} onPress={handleAddGhost}>
                <Text style={styles.ghostAddButtonText}>Add</Text>
              </Pressable>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.actions}>
              <Pressable style={styles.skipButton} onPress={onClose}>
                <Text style={styles.skipButtonText}>Skip</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmButton, (includedCount === 0 || saving) && styles.confirmButtonDisabled]}
                onPress={handleConfirm}
                disabled={includedCount === 0 || saving}
              >
                <Text style={styles.confirmButtonText}>{saving ? 'Saving...' : 'Create IOUs'}</Text>
              </Pressable>
            </View>
          </View>
        </GlassSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: palette.scrim,
    justifyContent: 'flex-end',
  },
  modal: {
    maxHeight: '80%',
  },
  content: {
    padding: spacing.lg,
  },
  amount: {
    ...typography.brutalistNumberCompact,
    color: palette.textPrimary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  evenSplitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.sm,
  },
  list: {
    maxHeight: 260,
  },
  listContent: {
    gap: spacing.sm,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: palette.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: palette.neonGreen,
    borderColor: palette.neonGreen,
  },
  checkboxMark: {
    color: '#0A0A0A',
    fontWeight: '900',
    fontSize: 14,
  },
  participantName: {
    ...typography.body,
    color: palette.textPrimary,
    flex: 1,
  },
  ratioStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  ratioButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: palette.cardBackgroundElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratioButtonText: {
    color: palette.textPrimary,
    fontWeight: '800',
  },
  ratioValue: {
    ...typography.caption,
    color: palette.textSecondary,
    minWidth: 26,
    textAlign: 'center',
  },
  participantShare: {
    ...typography.bodyBold,
    color: palette.neonGreen,
    minWidth: 70,
    textAlign: 'right',
  },
  ghostRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  ghostInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: palette.textPrimary,
  },
  ghostAddButton: {
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    backgroundColor: palette.cardBackgroundElevated,
  },
  ghostAddButtonText: {
    ...typography.bodyBold,
    color: palette.textPrimary,
  },
  error: {
    ...typography.caption,
    color: palette.danger,
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  skipButton: {
    flex: 1,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.border,
  },
  skipButtonText: {
    ...typography.bodyBold,
    color: palette.textSecondary,
  },
  confirmButton: {
    flex: 2,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: palette.neonGreen,
  },
  confirmButtonDisabled: {
    opacity: 0.4,
  },
  confirmButtonText: {
    ...typography.bodyBold,
    color: '#0A0A0A',
  },
});
