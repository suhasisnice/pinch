import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import BentoCard from './BentoCard';
import { palette, radii, spacing, typography } from '../theme/theme';

interface AllowanceCardProps {
  allowance: number;
  onChange: (amount: number) => void;
}

/** Small bento card for viewing/editing the monthly allowance that Safe-to-Spend is based on. */
export default function AllowanceCard({ allowance, onChange }: AllowanceCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(allowance));

  function startEditing() {
    setDraft(String(allowance));
    setEditing(true);
  }

  function commit() {
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && parsed >= 0) {
      onChange(parsed);
    }
    setEditing(false);
  }

  return (
    <BentoCard style={styles.card}>
      <Text style={typography.cardTitle}>Monthly Allowance</Text>
      {editing ? (
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          keyboardType="numeric"
          autoFocus
          onBlur={commit}
          onSubmitEditing={commit}
        />
      ) : (
        <Pressable onPress={startEditing}>
          <Text style={styles.value}>₹{allowance.toLocaleString('en-IN')}</Text>
          <Text style={styles.hint}>Tap to edit</Text>
        </Pressable>
      )}
    </BentoCard>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
  },
  value: {
    ...typography.brutalistNumberCompact,
    color: palette.textPrimary,
    marginTop: spacing.sm,
  },
  hint: {
    ...typography.caption,
    color: palette.textMuted,
    marginTop: spacing.xs,
  },
  input: {
    ...typography.brutalistNumberCompact,
    color: palette.textPrimary,
    marginTop: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: palette.neonGreen,
    borderRadius: radii.input,
    paddingVertical: spacing.xs,
  },
});
