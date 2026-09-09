import React, { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as db from '../db/dbService';
import { getBudgetSnapshot, BudgetSnapshot } from '../services/budgetService';
import { getMonthlyAllowance } from '../settings/settingsStore';
import {
  CategoryShift,
  CategorySlice,
  MonthComparison,
  MonthTotal,
  RecurringCharge,
  WeekdayPattern,
  averageDailySpend,
  categoryBreakdown,
  typicalDay,
  categoryShifts,
  compareMonths,
  compareWeeks,
  computeInsights,
  detectRecurring,
  spendingPersonality,
  weekdayPattern,
} from '../math/insights';
import { daysUntilBroke } from '../math/budget';
import { formatMoney, formatMoneyCompact } from '../utils/format';
import { categoryColor, palette, radii, spacing, typography } from '../theme/theme';
import { Card, CardTitle, Dot, EmptyState, Loading, ProgressBar, Row, Screen, ScreenTitle } from '../components/ui';
import Icon from '../components/Icon';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "2026-09" -> "Sep". */
function monthLabel(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return MONTH_NAMES[index] ?? month;
}

export default function InsightsScreen() {
  const [snapshot, setSnapshot] = useState<BudgetSnapshot | null>(null);
  const [slices, setSlices] = useState<CategorySlice[]>([]);
  const [daily, setDaily] = useState<Array<{ day: string; total: number }>>([]);
  const [weeks, setWeeks] = useState({ thisWeek: 0, lastWeek: 0 });
  const [habits, setHabits] = useState<ReturnType<typeof computeInsights> | null>(null);
  const [months, setMonths] = useState<MonthTotal[]>([]);
  const [shifts, setShifts] = useState<CategoryShift[]>([]);
  const [recurring, setRecurring] = useState<RecurringCharge[]>([]);
  const [weekdays, setWeekdays] = useState<WeekdayPattern[]>([]);
  const [allDaily, setAllDaily] = useState<Array<{ day: string; total: number }>>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const allowance = await getMonthlyAllowance();
    const next = await getBudgetSnapshot(allowance);

    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * MS_PER_DAY).toISOString();
    const prevWeekStart = new Date(now.getTime() - 14 * MS_PER_DAY).toISOString();

    // A year of history, not just the current period: "you spend more in
    // exam months" is not a statement this screen could make before.
    const historyStart = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString();

    const [
      categories,
      dailyRows,
      thisWeek,
      lastWeek,
      transactions,
      ious,
      monthlyRows,
      categoryMonths,
      repeatRows,
      everyDay,
    ] = await Promise.all([
      db.getSpendByCategory(next.periodStart, next.periodEnd),
      db.getDailySpend(next.periodStart, next.periodEnd),
      db.getGrossSpendBetween(weekStart, now.toISOString()),
      db.getGrossSpendBetween(prevWeekStart, weekStart),
      db.getTransactionsBetween(next.periodStart, next.periodEnd),
      db.getOpenIOUs(),
      db.getMonthlySpend(6, now),
      db.getCategoryByMonth(6, now),
      db.getRepeatMerchants(6, now),
      db.getDailySpend(historyStart, now.toISOString()),
    ]);

    setSnapshot(next);
    setSlices(categoryBreakdown(categories));
    setDaily(dailyRows);
    setWeeks({ thisWeek, lastWeek });
    setHabits(computeInsights(transactions, ious));
    setMonths(monthlyRows);
    setShifts(categoryShifts(categoryMonths, now.toISOString().slice(0, 7)));
    setRecurring(detectRecurring(repeatRows));
    setWeekdays(weekdayPattern(everyDay));
    setAllDaily(everyDay);
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
  const typical = typicalDay(daily);
  const brokeIn = daysUntilBroke(snapshot.budget.spendablePool, avgBurn);
  const maxDay = Math.max(...daily.map((d) => d.total), 1);
  const monthly: MonthComparison = compareMonths(months);
  const maxMonth = Math.max(...months.map((m) => m.total), 1);
  const heaviestDay = weekdays[0] ?? null;
  const recurringTotal = recurring.reduce((sum, charge) => sum + charge.typicalAmount, 0);

  // Only truly empty when there is no history either — a fresh period with a
  // year of past months behind it still has plenty to say.
  if (daily.length === 0 && months.length === 0) {
    return (
      <Screen>
        <ScreenTitle title="Insights" />
        <Card>
          <EmptyState
            icon="insights"
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
      {daily.length > 0 ? (
      <Card>
        <CardTitle
          right={
            <Text style={styles.avgLabel}>
              typical {formatMoneyCompact(typical.typical)}
            </Text>
          }
        >
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
        {typical.skewed ? (
          <Text style={styles.chartNote}>
            A few big days pull the average up to {formatMoney(typical.mean)}. Most days you
            spend around {formatMoney(typical.typical)}, which is the number worth planning
            against.
          </Text>
        ) : null}
      </Card>
      ) : null}

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

      {months.length > 1 ? (
        <Card>
          <CardTitle
            right={
              monthly.changeVsTypical !== null ? (
                <View style={styles.trendPill}>
                  <Icon
                    name={
                      monthly.direction === 'UP'
                        ? 'trendUp'
                        : monthly.direction === 'DOWN'
                          ? 'trendDown'
                          : 'flat'
                    }
                    size={13}
                    color={
                      monthly.direction === 'UP'
                        ? palette.warningAmber
                        : monthly.direction === 'DOWN'
                          ? palette.mint
                          : palette.textSecondary
                    }
                  />
                  <Text
                    style={[
                      styles.trendPillText,
                      {
                        color:
                          monthly.direction === 'UP'
                            ? palette.warningAmber
                            : monthly.direction === 'DOWN'
                              ? palette.mint
                              : palette.textSecondary,
                      },
                    ]}
                  >
                    {Math.abs(Math.round(monthly.changeVsTypical * 100))}%
                  </Text>
                </View>
              ) : undefined
            }
          >
            Month by month
          </CardTitle>

          <View style={styles.monthChart}>
            {[...months].reverse().map((month) => {
              const isCurrent = month.month === months[0]?.month;
              return (
                <View key={month.month} style={styles.monthSlot}>
                  <Text style={styles.monthAmount}>{formatMoneyCompact(month.total)}</Text>
                  <View
                    style={[
                      styles.monthBar,
                      {
                        height: Math.max(6, (month.total / maxMonth) * 88),
                        backgroundColor: isCurrent ? palette.neonGreen : palette.surfaceHigh,
                      },
                    ]}
                  />
                  <Text style={styles.monthLabel}>{monthLabel(month.month)}</Text>
                </View>
              );
            })}
          </View>

          <Text style={styles.historyNote}>
            {monthly.changeVsTypical === null
              ? 'Building a baseline — one more month and this compares itself.'
              : monthly.direction === 'FLAT'
                ? `Running about the same as your usual ${formatMoney(monthly.typical ?? 0)} a month.`
                : `You are spending ${Math.abs(Math.round(monthly.changeVsTypical * 100))}% ${
                    monthly.direction === 'UP' ? 'faster' : 'slower'
                  } per day than your usual month${
                    monthly.projectedTotal !== null
                      ? `, heading for about ${formatMoney(monthly.projectedTotal)}`
                      : ''
                  }.`}
          </Text>
        </Card>
      ) : null}

      {shifts.length > 0 ? (
        <Card>
          <CardTitle>What changed</CardTitle>
          <Text style={styles.cardIntro}>
            This month against your typical one, biggest movers first.
          </Text>
          {shifts.slice(0, 5).map((shift) => {
            const up = shift.currentTotal > shift.typicalTotal;
            return (
              <Row
                key={shift.category}
                left={<Dot color={categoryColor(shift.category)} />}
                title={shift.category}
                subtitle={`usually ${formatMoney(shift.typicalTotal)}`}
                right={
                  <View style={styles.shiftRight}>
                    <Text style={styles.habitValue}>{formatMoney(shift.currentTotal)}</Text>
                    <View style={styles.trendPill}>
                      <Icon
                        name={up ? 'trendUp' : 'trendDown'}
                        size={12}
                        color={up ? palette.warningAmber : palette.mint}
                      />
                      <Text
                        style={[
                          styles.trendPillText,
                          { color: up ? palette.warningAmber : palette.mint },
                        ]}
                      >
                        {formatMoneyCompact(Math.abs(shift.currentTotal - shift.typicalTotal))}
                      </Text>
                    </View>
                  </View>
                }
              />
            );
          })}
        </Card>
      ) : null}

      {recurring.length > 0 ? (
        <Card>
          <CardTitle right={<Text style={styles.avgLabel}>{formatMoney(recurringTotal)}/mo</Text>}>
            Charges that keep coming back
          </CardTitle>
          <Text style={styles.cardIntro}>
            Seen in three or more months — usually a subscription, sometimes one you forgot.
          </Text>
          {recurring.slice(0, 6).map((charge) => (
            <Row
              key={charge.merchant}
              left={<Icon name="Subscriptions" size={16} color={palette.mint} />}
              title={charge.merchant}
              subtitle={`${charge.months} months · about ${formatMoney(charge.annualised)} a year`}
              right={<Text style={styles.habitValue}>{formatMoney(charge.typicalAmount)}</Text>}
            />
          ))}
        </Card>
      ) : null}

      {heaviestDay && allDaily.length >= 14 ? (
        <Card>
          <CardTitle>Your week</CardTitle>
          {weekdays.map((day) => (
            <View key={day.weekday} style={styles.sliceRow}>
              <View style={styles.sliceHead}>
                <Text style={styles.sliceName}>{day.label}</Text>
                <Text style={styles.sliceAmount}>{formatMoney(day.average)}</Text>
              </View>
              <ProgressBar
                fraction={day.average / (heaviestDay.average || 1)}
                color={day.weekday === heaviestDay.weekday ? palette.violet : palette.surfaceHigh}
                height={6}
              />
            </View>
          ))}
          <Text style={styles.historyNote}>
            {heaviestDay.label} is your most expensive day, averaging{' '}
            {formatMoney(heaviestDay.average)}.
          </Text>
        </Card>
      ) : null}

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

  cardIntro: {
    ...typography.caption,
    color: palette.textMuted,
    marginBottom: spacing.sm,
    lineHeight: 17,
  },
  historyNote: {
    ...typography.caption,
    color: palette.textSecondary,
    marginTop: spacing.sm,
    lineHeight: 18,
  },

  monthChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    height: 132,
    marginTop: spacing.xs,
  },
  monthSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  monthBar: { width: '100%', borderRadius: 4 },
  monthAmount: { ...typography.micro, color: palette.textSecondary, fontSize: 9 },
  monthLabel: { ...typography.micro, color: palette.textMuted },

  trendPill: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  trendPillText: { ...typography.micro, fontWeight: '700' },
  shiftRight: { alignItems: 'flex-end', gap: 2 },
  projection: { ...typography.body, color: palette.textSecondary, lineHeight: 20 },
  muted: { ...typography.caption, color: palette.textMuted },
});
