import React, { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as db from '../db/dbService';
import { getBudgetSnapshot, BudgetSnapshot } from '../services/budgetService';
import { getMonthlyAllowance } from '../settings/settingsStore';
import {
  CategorySlice,
  averageDailySpend,
  categoryBreakdown,
  compareWeeks,
  computeInsights,
  spendingPersonality,
} from '../math/insights';
import { daysUntilBroke } from '../math/budget';
import { formatMoney, formatMoneyCompact } from '../utils/format';
import { categoryColor, palette, radii, spacing, typography } from '../theme/theme';
import { Card, CardTitle, Dot, EmptyState, Loading, ProgressBar, Row, Screen, ScreenTitle } from '../components/ui';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export default function InsightsScreen() {
  const [snapshot, setSnapshot] = useState<BudgetSnapshot | null>(null);
  const [slices, setSlices] = useState<CategorySlice[]>([]);
  const [daily, setDaily] = useState<Array<{ day: string; total: number }>>([]);
  const [weeks, setWeeks] = useState({ thisWeek: 0, lastWeek: 0 });
  const [habits, setHabits] = useState<ReturnType<typeof computeInsights> | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const allowance = await getMonthlyAllowance();
    const next = await getBudgetSnapshot(allowance);

    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * MS_PER_DAY).toISOString();
    const prevWeekStart = new Date(now.getTime() - 14 * MS_PER_DAY).toISOString();

    const [categories, dailyRows, thisWeek, lastWeek, transactions, ious] = await Promise.all([
      db.getSpendByCategory(next.periodStart, next.periodEnd),
      db.getDailySpend(next.periodStart, next.periodEnd),
      db.getGrossSpendBetween(weekStart, now.toISOString()),
      db.getGrossSpendBetween(prevWeekStart, weekStart),
      db.getTransactionsBetween(next.periodStart, next.periodEnd),
      db.getOpenIOUs(),
    ]);

    setSnapshot(next);
    setSlices(categoryBreakdown(categories));
    setDaily(dailyRows);
    setWeeks({ thisWeek, lastWeek });
    setHabits(computeInsights(transactions, ious));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!snapshot || !habits) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const comparison = compareWeeks(weeks.thisWeek, weeks.lastWeek);
  const personality = spendingPersonality(slices);
  const avgBurn = averageDailySpend(daily);
  const brokeIn = daysUntilBroke(snapshot.budget.spendablePool, avgBurn);
  const maxDay = Math.max(...daily.map((d) => d.total), 1);

  if (daily.length === 0) {
    return (
      <Screen>
        <ScreenTitle title="Insights" />
        <Card>
          <EmptyState
            emoji="📊"
            title="Nothing to show yet"
            body="Once a few days of spending land here, this fills up with where your money actually goes."
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.textSecondary} />}>
      <ScreenTitle title="Insights" subtitle="Where it actually goes" />

      {personality ? (
        <Card style={styles.personality}>
          <Text style={styles.personalityLabel}>This period you are</Text>
          <Text style={styles.personalityName}>{personality.label}</Text>
          <Text style={styles.personalityBlurb}>{personality.blurb}</Text>
        </Card>
      ) : null}

      <Card>
        <CardTitle>This week vs last</CardTitle>
        <View style={styles.weekRow}>
          <View style={styles.weekStat}>
            <Text style={styles.weekLabel}>This week</Text>
            <Text style={styles.weekValue}>{formatMoney(comparison.thisWeek)}</Text>
          </View>
          <View style={styles.weekStat}>
            <Text style={styles.weekLabel}>Last week</Text>
            <Text style={[styles.weekValue, { color: palette.textSecondary }]}>
              {formatMoney(comparison.lastWeek)}
            </Text>
          </View>
        </View>
        <Text
          style={[
            styles.weekVerdict,
            {
              color:
                comparison.direction === 'UP'
                  ? palette.warningAmber
                  : comparison.direction === 'DOWN'
                    ? palette.mint
                    : palette.textSecondary,
            },
          ]}
        >
          {comparison.change === null
            ? 'No comparison yet — this is your first week of data.'
            : comparison.direction === 'FLAT'
              ? 'About the same as last week.'
              : `${Math.abs(Math.round(comparison.change * 100))}% ${comparison.direction === 'UP' ? 'more' : 'less'} than last week.`}
        </Text>
      </Card>

      {/* Daily bars. Deliberately plain CSS-style views rather than a chart
          library — 30 bars does not justify the bundle cost. */}
      <Card>
        <CardTitle right={<Text style={styles.avgLabel}>avg {formatMoneyCompact(avgBurn)}</Text>}>
          Daily spend
        </CardTitle>
        <View style={styles.chart}>
          {daily.slice(-30).map((day) => {
            const height = Math.max(3, (day.total / maxDay) * 90);
            const overLimit = day.total > snapshot.budget.dailyLimit;
            return (
              <View key={day.day} style={styles.barSlot}>
                <View
                  style={[
                    styles.bar,
                    {
                      height,
                      backgroundColor: overLimit ? palette.warningAmber : palette.neonGreen,
                    },
                  ]}
                />
              </View>
            );
          })}
        </View>
        <Text style={styles.chartNote}>
          Amber bars went over your {formatMoney(snapshot.budget.dailyLimit)} daily limit.
        </Text>
      </Card>

      <Card>
        <CardTitle>By category</CardTitle>
        {slices.length === 0 ? (
          <Text style={styles.muted}>No categorised spending yet.</Text>
        ) : (
          slices.map((slice) => (
            <View key={slice.category} style={styles.sliceRow}>
              <View style={styles.sliceHead}>
                <Dot color={categoryColor(slice.category)} />
                <Text style={styles.sliceName}>{slice.category}</Text>
                <Text style={styles.slicePercent}>{Math.round(slice.fraction * 100)}%</Text>
                <Text style={styles.sliceAmount}>{formatMoney(slice.total)}</Text>
              </View>
              <ProgressBar fraction={slice.fraction} color={categoryColor(slice.category)} height={6} />
            </View>
          ))
        )}
      </Card>

      <Card>
        <CardTitle>Habits</CardTitle>
        <Row
          title="Small spends"
          subtitle={`${habits.microTransactionCount} under ₹100`}
          right={<Text style={styles.habitValue}>{formatMoney(habits.microTransactionTotal)}</Text>}
        />
        <Row
          title="Late-night spending"
          subtitle={`${habits.lateNightCount} after 11pm`}
          right={<Text style={styles.habitValue}>{formatMoney(habits.lateNightTotal)}</Text>}
        />
        {habits.topDebtor ? (
          <Row
            title="Biggest debtor"
            subtitle={habits.topDebtor.contactName}
            right={<Text style={styles.habitValue}>{formatMoney(habits.topDebtor.totalOwed)}</Text>}
          />
        ) : null}
      </Card>

      <Card style={brokeIn !== null && brokeIn < snapshot.daysRemaining ? { borderColor: palette.warningAmber } : undefined}>
        <CardTitle>Projection</CardTitle>
        <Text style={styles.projection}>
          {brokeIn === null
            ? 'Not enough spending yet to project a run-out date.'
            : brokeIn >= snapshot.daysRemaining
              ? `On track. At ${formatMoney(avgBurn)}/day you finish the period with ${formatMoney(snapshot.budget.spendablePool - avgBurn * snapshot.daysRemaining)} spare.`
              : `At ${formatMoney(avgBurn)}/day you run out in ${brokeIn} days — ${snapshot.daysRemaining - brokeIn} days short.`}
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  personality: { alignItems: 'center', gap: 2 },
  personalityLabel: { ...typography.heroLabel, color: palette.textSecondary },
  personalityName: { ...typography.display, color: palette.violet },
  personalityBlurb: { ...typography.caption, color: palette.textSecondary, textAlign: 'center' },

  weekRow: { flexDirection: 'row', gap: spacing.md },
  weekStat: { flex: 1, gap: 2 },
  weekLabel: { ...typography.micro, color: palette.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  weekValue: { ...typography.bodyBold, fontSize: 20, color: palette.textPrimary },
  weekVerdict: { ...typography.caption, marginTop: spacing.sm },

  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 96, marginTop: spacing.xs },
  barSlot: { flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 2, minHeight: 3 },
  chartNote: { ...typography.micro, color: palette.textMuted, marginTop: spacing.sm },
  avgLabel: { ...typography.caption, color: palette.textSecondary },

  sliceRow: { gap: 6, marginBottom: spacing.sm },
  sliceHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sliceName: { ...typography.body, color: palette.textPrimary, flex: 1 },
  slicePercent: { ...typography.caption, color: palette.textSecondary, width: 38, textAlign: 'right' },
  sliceAmount: { ...typography.bodyBold, color: palette.textPrimary, width: 76, textAlign: 'right' },

  habitValue: { ...typography.bodyBold, color: palette.textPrimary },
  projection: { ...typography.body, color: palette.textSecondary, lineHeight: 20 },
  muted: { ...typography.caption, color: palette.textMuted },
});
