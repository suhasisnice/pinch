import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as db from '../db/dbService';
import { getBudgetSnapshot, BudgetSnapshot } from '../services/budgetService';
import { getMonthlyAllowance } from '../settings/settingsStore';
import {
  CategoryShift,
  MonthComparison,
  MonthTotal,
  RecurringCharge,
  WeekdayPattern,
  categoryBreakdown,
  typicalDay,
  categoryShifts,
  compareMonths,
  compareWeeks,
  computeInsights,
  detectRecurring,
  weekdayPattern,
} from '../math/insights';
import { daysUntilBroke } from '../math/budget';
import { FindingTone, buildFindings, insightHero } from '../math/insightsSummary';
import { FadeSlideIn } from '../components/motion';
import MoneyAmount from '../components/Money';
import { formatMoney, formatMoneyCompact } from '../utils/format';
import { categoryColor, palette, spacing, typography } from '../theme/theme';
import {
  Divider,
  Dot,
  EmptyState,
  Loading,
  Row,
  Screen,
  ScreenTitle,
  SectionHeader,
} from '../components/ui';
import Icon from '../components/Icon';

type CategoryCost = Awaited<ReturnType<typeof db.getCategoryCost>>[number];
type Borne = Awaited<ReturnType<typeof db.getBorneBetween>>;

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatDayMonth(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

/** "2026-09" -> "Sep". */
function monthLabel(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return MONTH_NAMES[index] ?? month;
}

/** Findings the hero already says, so the list below it doesn't say them twice. */
const HERO_FINDINGS = new Set(['underwater', 'runs-out-early']);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Insights, in the order a person asks the questions.
 *
 * Am I going to be OK? — one number, first, projected to the end of the
 * period. Anything worth knowing? — the few findings that are actually true
 * right now, each with where to look. Where did it go? — by what was really
 * yours, not by what happened to leave the account. Then the evidence: pace,
 * the month against a normal one, what repeats.
 *
 * It used to be a dozen equal cards — three separate charts of the same
 * daily spending, a projection at the very bottom, and a personality quiz —
 * which is the shape of a dashboard nobody decided anything about.
 */
export default function InsightsScreen() {
  const navigation = useNavigation<any>();
  const [snapshot, setSnapshot] = useState<BudgetSnapshot | null>(null);
  const [costs, setCosts] = useState<CategoryCost[]>([]);
  const [uncategorisedFraction, setUncategorisedFraction] = useState(0);
  const [categorised, setCategorised] = useState<ReturnType<typeof categoryBreakdown>>([]);
  const [daily, setDaily] = useState<Array<{ day: string; total: number }>>([]);
  const [weeks, setWeeks] = useState({ thisWeek: 0, lastWeek: 0 });
  const [habits, setHabits] = useState<ReturnType<typeof computeInsights> | null>(null);
  const [months, setMonths] = useState<MonthTotal[]>([]);
  const [shifts, setShifts] = useState<CategoryShift[]>([]);
  const [recurring, setRecurring] = useState<RecurringCharge[]>([]);
  const [weekdays, setWeekdays] = useState<WeekdayPattern[]>([]);
  const [historyDays, setHistoryDays] = useState(0);
  const [borne, setBorne] = useState<Borne | null>(null);
  const [transfers, setTransfers] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const allowance = await getMonthlyAllowance();
    const next = await getBudgetSnapshot(allowance);

    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * MS_PER_DAY).toISOString();
    const prevWeekStart = new Date(now.getTime() - 14 * MS_PER_DAY).toISOString();
    // A year of history, so "Saturdays are your expensive day" rests on more
    // than one month of Saturdays.
    const historyStart = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString();

    const [
      categoryRows,
      costRows,
      dailyRows,
      thisWeek,
      lastWeek,
      transactions,
      ious,
      monthlyRows,
      categoryMonths,
      repeatRows,
      everyDay,
      borneRows,
      transferRows,
    ] = await Promise.all([
      db.getSpendByCategory(next.periodStart, next.periodEnd),
      db.getCategoryCost(next.periodStart, next.periodEnd),
      db.getDailySpend(next.periodStart, next.periodEnd),
      db.getGrossSpendBetween(weekStart, now.toISOString()),
      db.getGrossSpendBetween(prevWeekStart, weekStart),
      db.getTransactionsBetween(next.periodStart, next.periodEnd),
      db.getOpenIOUs(),
      db.getMonthlySpend(6, now),
      db.getCategoryByMonth(6, now),
      db.getRepeatMerchants(6, now),
      db.getDailySpend(historyStart, now.toISOString()),
      db.getBorneBetween(next.periodStart, next.periodEnd),
      db.getTransfers(),
    ]);

    const slices = categoryBreakdown(categoryRows);
    setSnapshot(next);
    setCosts(costRows);
    setCategorised(slices.filter((slice) => slice.category !== 'Uncategorised'));
    setUncategorisedFraction(slices.find((slice) => slice.category === 'Uncategorised')?.fraction ?? 0);
    setDaily(dailyRows);
    setWeeks({ thisWeek, lastWeek });
    setHabits(computeInsights(transactions, ious));
    setMonths(monthlyRows);
    setShifts(categoryShifts(categoryMonths, now.toISOString().slice(0, 7)));
    setRecurring(detectRecurring(repeatRows));
    setWeekdays(weekdayPattern(everyDay));
    setHistoryDays(everyDay.length);
    setBorne(borneRows);
    // Both legs are stored, so the count of movements is half the rows.
    setTransfers(Math.floor(transferRows.length / 2));
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

  // Only truly empty when there is no history either — a fresh period with a
  // year of past months behind it still has plenty to say.
  if (daily.length === 0 && months.length === 0) {
    return (
      <Screen>
        <ScreenTitle title="Insights" />
        <EmptyState
          icon="insights"
          title="Nothing to show yet"
          body="Once a few days of spending land here, this fills up with where your money actually goes."
        />
      </Screen>
    );
  }

  // periodEnd is the midnight after the last day, so the last day is a moment before it.
  const endLabel = formatDayMonth(new Date(Date.parse(snapshot.periodEnd) - 1).toISOString());
  const hero = insightHero({
    spendablePool: snapshot.budget.spendablePool,
    dailyLimit: snapshot.budget.dailyLimit,
    daysRemaining: snapshot.daysRemaining,
    endLabel,
    daily,
    today: new Date().toISOString().slice(0, 10),
  });

  const typical = typicalDay(daily);
  const periodDays = Math.max(
    1,
    Math.round((Date.parse(snapshot.periodEnd) - Date.parse(snapshot.periodStart)) / MS_PER_DAY)
  );

  const findings = buildFindings({
    spendablePool: snapshot.budget.spendablePool,
    allowance: snapshot.budget.allowance,
    dailyLimit: snapshot.budget.dailyLimit,
    daysRemaining: snapshot.daysRemaining,
    periodDays,
    grossSpend: snapshot.budget.grossSpend,
    typicalDay: typical.typical,
    meanDay: typical.mean,
    brokeIn: hero.pace ? daysUntilBroke(snapshot.budget.spendablePool, hero.pace) : null,
    categories: categorised,
    shifts,
    recurring,
    thisWeek: weeks.thisWeek,
    lastWeek: weeks.lastWeek,
    uncategorisedFraction,
  }).filter((finding) => !HERO_FINDINGS.has(finding.id));

  const openCategory = (category: string) => navigation.navigate('Transactions', { category });

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.textSecondary} />
      }
    >
      <ScreenTitle
        title="Insights"
        subtitle={`${formatDayMonth(snapshot.periodStart)} – ${endLabel}`}
      />

      {/* The one answer. Number first, then what it is — so it reads as a
          sentence: "₹2,340 left over on 30 Sep, at this pace." */}
      <FadeSlideIn>
        <View style={styles.hero} accessible accessibilityLabel={`${formatMoney(hero.amount)} ${hero.label}. ${hero.detail}`}>
          <MoneyAmount
            amount={hero.amount}
            style={[styles.heroAmount, { color: heroColor(hero.tone) }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          />
          <Text style={styles.heroLabel}>{hero.label}</Text>
          <Text style={styles.heroDetail}>{hero.detail}</Text>
        </View>
      </FadeSlideIn>

      {findings.length > 0 ? (
        <View>
          <SectionHeader title="Worth knowing" />
          {findings.slice(0, 3).map((finding, index) => (
            <View key={finding.id}>
              {index > 0 ? <Divider /> : null}
              <FindingRow
                headline={finding.headline}
                detail={finding.detail}
                tone={finding.tone}
                onOpen={finding.category ? () => openCategory(finding.category!) : undefined}
              />
            </View>
          ))}
        </View>
      ) : null}

      {costs.length > 0 ? (
        <WhereItWent costs={costs} borne={borne} transfers={transfers} onOpen={openCategory} />
      ) : null}

      {daily.length > 0 ? (
        <View>
          <SectionHeader title="Your pace" />
          <PaceChart daily={daily} dailyLimit={snapshot.budget.dailyLimit} />
          <Text style={styles.note}>
            Each bar is a day this period. Amber ones went over {formatMoney(snapshot.budget.dailyLimit)}.
          </Text>

          <PaceRow
            title="Last 7 days"
            detail={weekDetail(weeks.thisWeek, weeks.lastWeek)}
            amount={weeks.thisWeek}
          />
          <Divider />
          <PaceRow
            title="A normal day"
            detail={
              typical.skewed
                ? `A few big days pull the average up to ${formatMoney(typical.mean)}`
                : 'The middle of your spending days'
            }
            amount={typical.typical}
          />
          {weekdays[0] && historyDays >= 14 ? (
            <>
              <Divider />
              <PaceRow
                title={`${weekdays[0].label}s`}
                detail="Your most expensive day of the week, on average"
                amount={weekdays[0].average}
              />
            </>
          ) : null}
          {habits.microTransactionCount > 0 ? (
            <>
              <Divider />
              <PaceRow
                title="Small spends"
                detail={`${habits.microTransactionCount} under ₹100 — they add up to this`}
                amount={habits.microTransactionTotal}
              />
            </>
          ) : null}
          {habits.lateNightCount > 0 ? (
            <>
              <Divider />
              <PaceRow
                title="After 11pm"
                detail={`${habits.lateNightCount} late-night spend${habits.lateNightCount === 1 ? '' : 's'}`}
                amount={habits.lateNightTotal}
              />
            </>
          ) : null}
        </View>
      ) : null}

      {months.length > 1 ? (
        <AgainstNormal months={months} shifts={shifts} onOpen={openCategory} />
      ) : null}

      {recurring.length > 0 ? (
        <View>
          <SectionHeader title="Comes back every month" />
          <Text style={styles.intro}>
            Seen in three or more months — {formatMoney(recurring.reduce((sum, c) => sum + c.typicalAmount, 0))}{' '}
            a month before you decide anything.
          </Text>
          {recurring.slice(0, 6).map((charge) => (
            <Row
              key={charge.merchant}
              title={charge.merchant}
              subtitle={`${charge.months} months · about ${formatMoney(charge.annualised)} a year`}
              right={<Text style={styles.value}>{formatMoney(charge.typicalAmount)}</Text>}
            />
          ))}
        </View>
      ) : null}

      {/* Admit a partial picture rather than presenting half a ledger as the whole. */}
      {uncategorisedFraction > 0 && !findings.slice(0, 3).some((f) => f.id === 'uncategorised') ? (
        <Text style={styles.note}>
          {Math.round(uncategorisedFraction * 100)}% of this period's spending has no category yet, so
          the breakdown above is missing it.
        </Text>
      ) : null}
    </Screen>
  );
}

function weekDetail(thisWeek: number, lastWeek: number): string {
  const comparison = compareWeeks(thisWeek, lastWeek);
  if (comparison.change === null) return 'Nothing the week before to compare with';
  if (comparison.direction === 'FLAT') return `About the same as the ${formatMoney(lastWeek)} before`;
  return `${Math.abs(Math.round(comparison.change * 100))}% ${
    comparison.direction === 'UP' ? 'more' : 'less'
  } than the ${formatMoney(lastWeek)} before`;
}

function FindingRow({
  headline,
  detail,
  tone,
  onOpen,
}: {
  headline: string;
  detail: string;
  tone: FindingTone;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <View style={[styles.findingMark, { backgroundColor: toneColor(tone) }]} />
      <View style={styles.findingBody}>
        <Text style={styles.findingHeadline}>{headline}</Text>
        <Text style={styles.findingDetail}>{detail}</Text>
      </View>
      {onOpen ? <Icon name="chevronRight" size={18} color={palette.textMuted} /> : null}
    </>
  );
  if (!onOpen) return <View style={styles.finding}>{body}</View>;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${headline}. ${detail}. View spending`}
      style={({ pressed }) => [styles.finding, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

/**
 * Categories ranked by what was yours, with what was paid shown alongside
 * wherever the two differ — the difference being other people's share of
 * bills you fronted.
 */
function WhereItWent({
  costs,
  borne,
  transfers,
  onOpen,
}: {
  costs: CategoryCost[];
  borne: Borne | null;
  transfers: number;
  onOpen: (category: string) => void;
}) {
  const totalYours = costs.reduce((sum, c) => sum + c.yours, 0);
  const totalPaid = costs.reduce((sum, c) => sum + c.paid, 0);
  const anySplit = totalPaid - totalYours > 0.5;
  // Scaled to the largest bill paid, so yours + others' share always fits the track.
  const largest = Math.max(...costs.map((c) => c.paid), 1);

  return (
    <View>
      <SectionHeader title="Where it went" />
      <Text style={styles.intro}>
        {anySplit ? (
          <>
            <Text style={styles.introStrong}>{formatMoney(totalYours)} was yours</Text> of the{' '}
            {formatMoney(totalPaid)} you paid. The rest was other people's share.
          </>
        ) : (
          <>
            <Text style={styles.introStrong}>{formatMoney(totalYours)}</Text> this period, all of it yours.
          </>
        )}
      </Text>

      {costs.map((cost) => {
        const shared = cost.splitAway > 0.5;
        return (
          <Pressable
            key={cost.category}
            onPress={() => onOpen(cost.category)}
            accessibilityRole="button"
            accessibilityLabel={`${cost.category}, ${formatMoney(cost.yours)} yours${
              shared ? ` of ${formatMoney(cost.paid)} paid` : ''
            }. View spending`}
            style={({ pressed }) => [styles.category, pressed && styles.pressed]}
          >
            <View style={styles.categoryHead}>
              <Dot color={categoryColor(cost.category)} size={8} />
              <Text style={styles.categoryName} numberOfLines={1}>
                {cost.category}
              </Text>
              {shared ? (
                <Text style={styles.categoryPaid}>{formatMoney(cost.paid)}</Text>
              ) : null}
              <Text style={styles.value}>{formatMoney(cost.yours)}</Text>
            </View>
            {/* One neutral bar: length is the information, the dot already
                says which category. A rainbow of bars says nothing extra. */}
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.max(1, (cost.yours / largest) * 100)}%` }]} />
              {shared ? (
                <View
                  style={[styles.fillOthers, { width: `${(cost.splitAway / largest) * 100}%` }]}
                />
              ) : null}
            </View>
          </Pressable>
        );
      })}

      {anySplit ? (
        <Text style={styles.note}>
          Struck-out amounts are what left your account; the bold figure is your share.
          {borne && borne.stillOwed > 0.5
            ? ` ${formatMoney(borne.stillOwed)} of the rest is still owed to you.`
            : ''}
        </Text>
      ) : null}
      {transfers > 0 ? (
        <Text style={styles.note}>
          {transfers} transfer{transfers === 1 ? '' : 's'} between your own accounts left out.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Daily spend this period as plain bars. Deliberately views rather than a
 * chart library — thirty bars do not justify the bundle.
 */
function PaceChart({ daily, dailyLimit }: { daily: Array<{ day: string; total: number }>; dailyLimit: number }) {
  const shown = daily.slice(-30);
  const max = Math.max(...shown.map((d) => d.total), dailyLimit, 1);
  const limitFromBottom = (dailyLimit / max) * CHART_HEIGHT;

  return (
    <View style={styles.chart}>
      {dailyLimit > 0 ? <View style={[styles.limitLine, { bottom: limitFromBottom }]} /> : null}
      {shown.map((day) => (
        <View key={day.day} style={styles.barSlot}>
          <View
            style={[
              styles.bar,
              {
                height: Math.max(3, (day.total / max) * CHART_HEIGHT),
                backgroundColor: day.total > dailyLimit ? palette.warning : palette.textSecondary,
              },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

function PaceRow({ title, detail, amount }: { title: string; detail: string; amount: number }) {
  return (
    <View style={styles.paceRow}>
      <View style={styles.paceBody}>
        <Text style={styles.paceTitle}>{title}</Text>
        <Text style={styles.paceDetail}>{detail}</Text>
      </View>
      <Text style={styles.value}>{formatMoney(amount)}</Text>
    </View>
  );
}

/** The month so far against a normal one, and which categories moved it. */
function AgainstNormal({
  months,
  shifts,
  onOpen,
}: {
  months: MonthTotal[];
  shifts: CategoryShift[];
  onOpen: (category: string) => void;
}) {
  const monthly: MonthComparison = compareMonths(months);
  const maxMonth = Math.max(...months.map((m) => m.total), 1);

  return (
    <View>
      <SectionHeader title="Against a normal month" />
      <Text style={styles.intro}>
        {monthly.changeVsTypical === null
          ? 'One more month and this starts comparing itself.'
          : monthly.direction === 'FLAT'
            ? `About the same as your usual ${formatMoney(monthly.typical ?? 0)} a month.`
            : `Spending ${Math.abs(Math.round(monthly.changeVsTypical * 100))}% ${
                monthly.direction === 'UP' ? 'faster' : 'slower'
              } than usual${
                monthly.projectedTotal !== null
                  ? `, heading for about ${formatMoney(monthly.projectedTotal)}`
                  : ''
              }.`}
      </Text>

      <View style={styles.monthChart}>
        {[...months].reverse().map((month) => {
          const isCurrent = month.month === months[0]?.month;
          return (
            <View key={month.month} style={styles.monthSlot}>
              <Text style={[styles.monthAmount, isCurrent && styles.monthCurrent]}>
                {formatMoneyCompact(month.total)}
              </Text>
              <View
                style={[
                  styles.monthBar,
                  {
                    height: Math.max(6, (month.total / maxMonth) * 80),
                    backgroundColor: isCurrent ? palette.textPrimary : palette.surfaceElevated,
                  },
                ]}
              />
              <Text style={[styles.monthLabel, isCurrent && styles.monthCurrent]}>
                {monthLabel(month.month)}
              </Text>
            </View>
          );
        })}
      </View>

      {shifts.slice(0, 4).map((shift) => {
        const up = shift.currentTotal > shift.typicalTotal;
        const diff = Math.abs(shift.currentTotal - shift.typicalTotal);
        return (
          <Row
            key={shift.category}
            left={<Dot color={categoryColor(shift.category)} size={8} />}
            title={shift.category}
            subtitle={`${formatMoney(shift.currentTotal)} so far · usually ${formatMoney(shift.typicalTotal)}`}
            onPress={() => onOpen(shift.category)}
            right={
              <Text style={[styles.value, { color: up ? palette.warning : palette.accent }]}>
                {up ? '+' : '−'}
                {formatMoneyCompact(diff)}
              </Text>
            }
          />
        );
      })}
    </View>
  );
}

const CHART_HEIGHT = 88;

/** A finding's colour carries its urgency, so the eye ranks them before the words do. */
function toneColor(tone: FindingTone): string {
  switch (tone) {
    case 'CRITICAL':
      return palette.danger;
    case 'WARNING':
      return palette.warning;
    case 'GOOD':
      return palette.accent;
    default:
      return palette.textMuted;
  }
}

/** The hero stays white unless there is something to be worried or pleased about. */
function heroColor(tone: FindingTone): string {
  return tone === 'NEUTRAL' ? palette.textPrimary : toneColor(tone);
}

const styles = StyleSheet.create({
  hero: { paddingTop: spacing.sm, paddingBottom: spacing.xs, gap: 2 },
  heroAmount: { ...typography.hero, fontSize: 48, lineHeight: 54, letterSpacing: -1.5 },
  heroLabel: { ...typography.cardTitle, color: palette.textPrimary },
  heroDetail: { ...typography.body, color: palette.textSecondary, marginTop: spacing.xs, lineHeight: 21 },

  pressed: { opacity: 0.72 },

  finding: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  // A tone-coloured rule down the side, so urgency is legible before a word is read.
  findingMark: { width: 3, borderRadius: 2, alignSelf: 'stretch' },
  findingBody: { flex: 1, gap: 3 },
  findingHeadline: { ...typography.bodyBold, color: palette.textPrimary },
  findingDetail: { ...typography.caption, color: palette.textSecondary, lineHeight: 18 },

  intro: { ...typography.caption, color: palette.textSecondary, lineHeight: 18, marginBottom: spacing.sm },
  introStrong: { fontWeight: '600', color: palette.textPrimary },
  note: { ...typography.caption, color: palette.textMuted, lineHeight: 18, marginTop: spacing.sm },
  value: { ...typography.bodyBold, color: palette.textPrimary },

  category: { gap: 6, paddingVertical: spacing.sm },
  categoryHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  categoryName: { ...typography.body, color: palette.textPrimary, flex: 1 },
  categoryPaid: {
    ...typography.caption,
    color: palette.textMuted,
    textDecorationLine: 'line-through',
  },
  track: { flexDirection: 'row', height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: palette.textPrimary, borderRadius: 2 },
  fillOthers: { height: 4, backgroundColor: palette.surfaceElevated, marginLeft: 2, borderRadius: 2 },

  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: CHART_HEIGHT,
    marginTop: spacing.xs,
  },
  limitLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: palette.warning,
    opacity: 0.6,
  },
  barSlot: { flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 2, minHeight: 3 },

  paceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  paceBody: { flex: 1, gap: 2 },
  paceTitle: { ...typography.body, color: palette.textPrimary },
  paceDetail: { ...typography.caption, color: palette.textSecondary },

  monthChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    height: 120,
    marginBottom: spacing.sm,
  },
  monthSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  monthBar: { width: '100%', borderRadius: 3 },
  monthAmount: { ...typography.micro, color: palette.textMuted },
  monthLabel: { ...typography.micro, color: palette.textMuted },
  monthCurrent: { color: palette.textPrimary, fontWeight: '600' },
});
