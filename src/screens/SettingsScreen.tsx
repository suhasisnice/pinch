import React, { useCallback, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import BentoCard from '../components/BentoCard';
import { CalibrationBaseline, effectiveDaysRemaining } from '../math/safeToSpend';
import { clearCalibration, getCalibration, setCalibration } from '../settings/settingsStore';
import { palette, radii, spacing, typography } from '../theme/theme';

/**
 * Mid-Month Calibration / Fresh Start: lets the user override the rigid
 * calendar-month assumption with "as of today I actually have ₹X, for Y
 * more days" — useful right after install, or any time the calendar-month
 * math has drifted from reality.
 */
export default function SettingsScreen() {
  const [active, setActive] = useState<CalibrationBaseline | null>(null);
  const [balanceInput, setBalanceInput] = useState('');
  const [daysInput, setDaysInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const calibration = await getCalibration();
    setActive(calibration);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleApply() {
    const balance = Number(balanceInput);
    const days = Number(daysInput);
    if (!Number.isFinite(balance) || balance < 0) {
      setError('Enter a valid pocket balance.');
      return;
    }
    if (!Number.isFinite(days) || days <= 0) {
      setError('Enter how many days that balance should cover.');
      return;
    }
    setError(null);
    await setCalibration(balance, Math.round(days));
    setBalanceInput('');
    setDaysInput('');
    load();
  }

  async function handleClear() {
    await clearCalibration();
    load();
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={typography.cardTitle}>Mid-Month Calibration</Text>
        <Text style={styles.subtitle}>
          Skip the rigid full-month assumption. Tell Pinch what you actually have right now and
          how many days it needs to last — Safe-to-Spend and Survival Mode will rebase on that
          starting today.
        </Text>

        {active ? (
          <BentoCard style={styles.activeCard} accentColor={palette.neonGreen}>
            <Text style={typography.bodyBold}>Active calibration</Text>
            <Text style={styles.activeLine}>
              ₹{active.balance.toLocaleString('en-IN')} set for {active.daysRemaining} day
              {active.daysRemaining === 1 ? '' : 's'}
            </Text>
            <Text style={styles.activeLine}>
              {effectiveDaysRemaining(active)} day{effectiveDaysRemaining(active) === 1 ? '' : 's'} left in
              this window
            </Text>
            <Pressable style={styles.clearButton} onPress={handleClear}>
              <Text style={styles.clearButtonText}>Reset to calendar month</Text>
            </Pressable>
          </BentoCard>
        ) : null}

        <BentoCard style={styles.formCard}>
          <Text style={typography.bodyBold}>Current Pocket Balance</Text>
          <TextInput
            style={styles.input}
            value={balanceInput}
            onChangeText={setBalanceInput}
            keyboardType="numeric"
            placeholder="e.g. 2500"
            placeholderTextColor={palette.textMuted}
          />

          <Text style={[typography.bodyBold, styles.secondLabel]}>Days Remaining</Text>
          <TextInput
            style={styles.input}
            value={daysInput}
            onChangeText={setDaysInput}
            keyboardType="numeric"
            placeholder="e.g. 12"
            placeholderTextColor={palette.textMuted}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable style={styles.applyButton} onPress={handleApply}>
            <Text style={styles.applyButtonText}>Apply Fresh Start</Text>
          </Pressable>
        </BentoCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  container: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  subtitle: {
    ...typography.body,
    color: palette.textSecondary,
  },
  activeCard: {
    gap: spacing.xs,
  },
  activeLine: {
    ...typography.body,
    color: palette.textSecondary,
  },
  clearButton: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  clearButtonText: {
    ...typography.caption,
    color: palette.textSecondary,
  },
  formCard: {
    gap: spacing.xs,
  },
  secondLabel: {
    marginTop: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: palette.textPrimary,
    marginTop: spacing.xs,
  },
  error: {
    ...typography.caption,
    color: palette.danger,
    marginTop: spacing.sm,
  },
  applyButton: {
    marginTop: spacing.md,
    backgroundColor: palette.neonGreen,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  applyButtonText: {
    ...typography.bodyBold,
    color: '#0A0A0A',
  },
});
