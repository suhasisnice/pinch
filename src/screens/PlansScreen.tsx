import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, place, spacing, typography } from '../theme/theme';
import { haptic } from '../components/haptics';
import AffordSheet from '../components/AffordSheet';
import { BudgetSnapshot, getBudgetSnapshot } from '../services/budgetService';
import { getMonthlyAllowance } from '../settings/settingsStore';
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
  const [snapshot, setSnapshot] = useState<BudgetSnapshot | null>(null);
  const [testing, setTesting] = useState(false);
  // Worked out when asked, so the answer uses today's numbers.
  const test = async () => {
    setSnapshot(await getBudgetSnapshot(await getMonthlyAllowance()));
    setTesting(true);
  };
  const switcher = <PlansSwitch value={view} onChange={setView} onTest={test} />;
  return (
    <>
      {view === 'saving' ? <GoalsScreen top={switcher} /> : <OutingsScreen top={switcher} />}
      {snapshot ? (
        <AffordSheet visible={testing} snapshot={snapshot} onClose={() => setTesting(false)} />
      ) : null}
    </>
  );
}

function PlansSwitch({
  value,
  onChange,
  onTest,
}: {
  value: PlanView;
  onChange: (v: PlanView) => void;
  onTest: () => void;
}) {
  const option = (key: PlanView, label: string) => (
    <Pressable
      onPress={() => {
        if (key !== value) haptic.tick();
        onChange(key);
      }}
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
      <View style={styles.spacer} />
      <Pressable onPress={onTest} hitSlop={10} accessibilityRole="button">
        <Text style={styles.option}>Test a purchase</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.lg },
  spacer: { flex: 1 },
  option: { ...typography.overline, color: palette.textMuted },
  optionOn: { color: place.plans },
});
