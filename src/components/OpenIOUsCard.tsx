import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import BentoCard from './BentoCard';
import { OpenIOUDetail } from '../db/types';
import { palette, radii, spacing, typography } from '../theme/theme';
import { sendNudge } from '../utils/nudge';

interface OpenIOUsCardProps {
  ious: OpenIOUDetail[];
}

function formatRupees(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return `₹${rounded.toLocaleString('en-IN')}`;
}

function NudgeRow({ iou }: { iou: OpenIOUDetail }) {
  const [sending, setSending] = useState(false);

  async function handleNudge() {
    setSending(true);
    try {
      await sendNudge(iou.contactName, iou.splitAmount, iou.merchant, iou.contactPhone);
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.row}>
      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={1}>
          {iou.contactName}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {formatRupees(iou.splitAmount)} · {iou.merchant}
        </Text>
      </View>
      <Pressable
        onPress={handleNudge}
        disabled={sending}
        style={({ pressed }) => [styles.nudgeButton, pressed && styles.nudgeButtonPressed]}
      >
        <Text style={styles.nudgeButtonText}>{sending ? '...' : 'Nudge'}</Text>
      </Pressable>
    </View>
  );
}

/** Quick-access bento card: everyone who currently owes the user money. */
export default function OpenIOUsCard({ ious }: OpenIOUsCardProps) {
  return (
    <BentoCard style={styles.card}>
      <Text style={typography.cardTitle}>Open IOUs</Text>
      {ious.length === 0 ? (
        <Text style={styles.empty}>Nobody owes you right now.</Text>
      ) : (
        <View style={styles.list}>
          {ious.map((iou) => (
            <NudgeRow key={iou.id} iou={iou} />
          ))}
        </View>
      )}
    </BentoCard>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
  },
  empty: {
    ...typography.body,
    color: palette.textSecondary,
    marginTop: spacing.sm,
  },
  list: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  rowName: {
    ...typography.bodyBold,
    color: palette.textPrimary,
  },
  rowMeta: {
    ...typography.caption,
    color: palette.textSecondary,
    marginTop: 2,
  },
  nudgeButton: {
    backgroundColor: palette.neonGreen,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  nudgeButtonPressed: {
    opacity: 0.75,
  },
  nudgeButtonText: {
    ...typography.caption,
    fontWeight: '800',
    color: '#0A0A0A',
  },
});
