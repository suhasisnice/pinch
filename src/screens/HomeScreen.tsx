import React, { useCallback, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import SafeToSpendHero from '../components/SafeToSpendHero';
import AllowanceCard from '../components/AllowanceCard';
import OpenIOUsCard from '../components/OpenIOUsCard';
import InsightsCard from '../components/InsightsCard';
import { getAllTransactions, getOpenIOUsWithDetails } from '../db/dbService';
import { OpenIOUDetail, TransactionRow } from '../db/types';
import { getSafeToSpend, getCalibratedSafeToSpend, CalibrationBaseline } from '../math/safeToSpend';
import { daysLeftInMonth } from '../math/survivalMode';
import { computeInsights, InsightsSummary } from '../math/insights';
import { getCalibration, getMonthlyAllowance, setMonthlyAllowance } from '../settings/settingsStore';
import { palette, radii, spacing, typography } from '../theme/theme';
import type { RootStackParamList } from '../navigation/RootNavigator';

type HomeNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavigationProp>();
  const [allowance, setAllowance] = useState(0);
  const [safeToSpend, setSafeToSpend] = useState(0);
  const [daysLeft, setDaysLeft] = useState(1);
  const [calibration, setCalibrationState] = useState<CalibrationBaseline | null>(null);
  const [openIOUs, setOpenIOUs] = useState<OpenIOUDetail[]>([]);
  const [insights, setInsights] = useState<InsightsSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const [currentAllowance, activeCalibration, ious, transactions] = await Promise.all([
      getMonthlyAllowance(),
      getCalibration(),
      getOpenIOUsWithDetails(),
      getAllTransactions(),
    ]);

    let currentSafeToSpend: number;
    let currentDaysLeft: number;

    if (activeCalibration) {
      const breakdown = await getCalibratedSafeToSpend(activeCalibration);
      currentSafeToSpend = breakdown.safeToSpend;
      currentDaysLeft = breakdown.daysRemaining;
    } else {
      const breakdown = await getSafeToSpend(currentAllowance);
      currentSafeToSpend = breakdown.safeToSpend;
      currentDaysLeft = daysLeftInMonth();
    }

    setAllowance(currentAllowance);
    setCalibrationState(activeCalibration);
    setSafeToSpend(currentSafeToSpend);
    setDaysLeft(currentDaysLeft);
    setOpenIOUs(ious);
    setInsights(computeInsights(transactions as TransactionRow[], ious));
    setLoaded(true);
  }, []);

  // Refetch whenever Home regains focus (e.g. after logging a transaction
  // on the Parser screen, or applying a calibration) so the dashboard never
  // shows stale numbers.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  async function handleAllowanceChange(amount: number) {
    setAllowance(amount);
    await setMonthlyAllowance(amount);
    refresh();
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Pinch</Text>
          <Pressable style={styles.settingsButton} onPress={() => navigation.navigate('Settings')}>
            <Text style={styles.settingsButtonText}>
              {calibration ? 'Calibrated' : 'Calibrate'}
            </Text>
          </Pressable>
        </View>

        {loaded && insights ? (
          <>
            <SafeToSpendHero safeToSpend={safeToSpend} daysLeft={daysLeft} />

            <View style={styles.row}>
              <AllowanceCard allowance={allowance} onChange={handleAllowanceChange} />
              <Pressable style={styles.simulatorCard} onPress={() => navigation.navigate('Parser')}>
                <Text style={typography.cardTitle}>Simulator</Text>
                <Text style={styles.simulatorHint}>Simulate an SMS to log a transaction</Text>
                <Text style={styles.simulatorArrow}>Open →</Text>
              </Pressable>
            </View>

            <View style={styles.row}>
              <OpenIOUsCard ious={openIOUs} />
              <InsightsCard summary={insights} />
            </View>
          </>
        ) : (
          <Text style={styles.loading}>Loading...</Text>
        )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  settingsButton: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  settingsButtonText: {
    ...typography.caption,
    color: palette.textSecondary,
  },
  loading: {
    ...typography.body,
    color: palette.textSecondary,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  simulatorCard: {
    flex: 1,
    backgroundColor: palette.cardBackground,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
    justifyContent: 'space-between',
  },
  simulatorHint: {
    ...typography.caption,
    color: palette.textSecondary,
    marginTop: spacing.xs,
  },
  simulatorArrow: {
    ...typography.bodyBold,
    color: palette.neonGreen,
    marginTop: spacing.md,
  },
});
