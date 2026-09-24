import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, spacing, typography } from '../theme/theme';
import GoalsScreen from './GoalsScreen';
import OutingsScreen from './OutingsScreen';

type PlanView = 'saving' | 'outings';

/**
 * Money with a job to do: things you are saving for, and nights you are
 * setting aside for. Two views of one idea, so one tab — switched by two
 * words at the top rather than a segmented control, the way a magazine
 * section heading works.
 */
export default function PlansScreen() {
  const [view, setView] = useState<PlanView>('saving');
  const switcher = <PlansSwitch value={view} onChange={setView} />;
  return view === 'saving' ? <GoalsScreen top={switcher} /> : <OutingsScreen top={switcher} />;
}

function PlansSwitch({ value, onChange }: { value: PlanView; onChange: (v: PlanView) => void }) {
  const option = (key: PlanView, label: string) => (
    <Pressable
      onPress={() => onChange(key)}
      hitSlop={10}
      accessibilityRole="tab"
      accessibilityState={{ selected: value === key }}
    >
      <Text style={[styles.option, value === key && styles.optionOn]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {option('saving', 'Saving')}
      {option('outings', 'Going out')}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.lg },
  option: { ...typography.overline, color: palette.textMuted },
  optionOn: { color: palette.textPrimary },
});
