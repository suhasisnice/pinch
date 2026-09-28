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
import { formatMoney, formatMoneyCompact } from '../utils/format';
import { categoryColor, palette, spacing, typography } from '../theme/theme';
import {
  Group,
  EmptyState,
  Hero,
  Loading,
  Row,
  Screen,
  ScreenTitle,
  TopBar,
} from '../components/ui';
import Icon from '../components/Icon';
import { Readout, ScrubBars, ShareStrip } from '../components/Charts';
import { haptic } from '../components/haptics';
import { lastCompletedWeek } from '../math/weeklyRecap';
import { localDay } from '../math/recovery';

type CategoryCost = Awaited<ReturnType<typeof db.getCategoryCost>>[number];
type Borne = Awaited<ReturnType<typeof db.getBorneBetween>>;

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
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
  const [recapWeek, setRecapWeek] = useState<{ start: Date; end: Date } | null>(null);
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
    setUncategorisedFraction(
      slices.find((slice) => slice.category === 'Uncategorised')?.fraction ?? 0
    );
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

    // Offer the recap only when last week has something in it.
    const week = lastCompletedWeek(now);
    const recapSpends = await db.getSpendsWithShare(
      week.start.toISOString(),
      week.end.toISOString()
    );
    setRecapWeek(
      recapSpends.length > 0
        ? { start: week.start, end: new Date(week.end.getTime() - MS_PER_DAY) }
        : null
    );
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
      <Screen underHeader scroll={false}>
        <Loading />
      </Screen>
    );
  }

  // Only truly empty when there is no history either — a fresh period with a
  // year of past months behind it still has plenty to say.
  if (daily.length === 0 && months.length === 0) {
    return (
      <Screen underHeader>
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
    dailyLimit: snapshot.today.dailyLimit,
    daysRemaining: snapshot.daysRemaining,
    endLabel,
    daily,
    today: localDay(new Date()),
  });

  const typical = typicalDay(daily);
  const periodDays = Math.max(
    1,
    Math.round((Date.parse(snapshot.periodEnd) - Date.parse(snapshot.periodStart)) / MS_PER_DAY)
  );

  const findings = buildFindings({
    spendablePool: snapshot.budget.spendablePool,
    allowance: snapshot.budget.allowance,
    dailyLimit: snapshot.today.dailyLimit,
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
  const dailyLimit = snapshot.today.dailyLimit;

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={palette.textSecondary}
        />
      }
    >
      {/* Last week's recap is the screen's one action, so it sits where every
          tab keeps its action instead of taking a row of its own. */}
      <TopBar
        left={`${formatDayMonth(snapshot.periodStart)} – ${endLabel}`}
        action={
          recapWeek
            ? {
                label: 'Last week',
                icon: 'play',
                onPress: () => navigation.navigate('Recap'),
              }
            : undefined
        }
      />

      {/* The one answer. Number first, then what it is — so it reads as a
          sentence: "₹2,340 left over on 30 Sep, at this pace." */}
      <FadeSlideIn>
        <View
          accessible
          accessibilityLabel={`${formatMoney(hero.amount)} ${hero.label}. ${hero.detail}`}
        >
          <Hero
            amount={hero.amount}
            label={hero.label}
            line={hero.detail}
            color={heroColor(hero.tone)}
            glow={heroColor(hero.tone)}
          />
        </View>
      </FadeSlideIn>

      {findings.length > 0 ? (
        <Group title="Noticed">
          {findings.slice(0, 3).map((finding) => (
            <FindingRow
              key={finding.id}
              headline={finding.headline}
              detail={finding.detail}
              tone={finding.tone}
              onOpen={finding.category ? () => openCategory(finding.category!) : undefined}
            />
          ))}
        </Group>
      ) : null}

      {daily.length > 0 ? (
        <Daily
          days={fillDays(daily, snapshot.periodStart)}
          weekdays={historyDays >= 14 ? weekdays : []}
          dailyLimit={dailyLimit}
        >
          <PaceRow
            key="week"
            title="Last 7 days"
            detail={weekDetail(weeks.thisWeek, weeks.lastWeek)}
            amount={weeks.thisWeek}
          />
          <PaceRow
            key="normal"
            title="A normal day"
            detail={
              typical.skewed
                ? `Average ${formatMoney(typical.mean)}, pulled up by big days`
                : 'Your middle day'
            }
            amount={typical.typical}
          />
          {habits.microTransactionCount > 0 ? (
            <PaceRow
              key="small"
              title="Small spends"
              detail={`${habits.microTransactionCount} under ₹100`}
              amount={habits.microTransactionTotal}
            />
          ) : null}
          {habits.lateNightCount > 0 ? (
            <PaceRow
              key="late"
              title="After 11pm"
              detail={`${habits.lateNightCount} late-night spend${habits.lateNightCount === 1 ? '' : 's'}`}
              amount={habits.lateNightTotal}
            />
          ) : null}
        </Daily>
      ) : null}

      {costs.length > 0 ? (
        <Categories costs={costs} borne={borne} transfers={transfers} onOpen={openCategory} />
      ) : null}

      {months.length > 1 ? <Months months={months} shifts={shifts} onOpen={openCategory} /> : null}

      {recurring.length > 0 ? (
        <Group
          title="Recurring"
          footer={`${formatMoney(recurring.reduce((sum, c) => sum + c.typicalAmount, 0))} a month, before you choose anything.`}
        >
          {recurring.slice(0, 6).map((charge) => (
            <Row
              key={charge.merchant}
              title={charge.merchant}
              subtitle={`${charge.months} months · ${formatMoney(charge.annualised)} a year`}
              right={<Text style={styles.value}>{formatMoney(charge.typicalAmount)}</Text>}
            />
          ))}
        </Group>
      ) : null}

      {/* Admit a partial picture rather than presenting half a ledger as the whole. */}
      {uncategorisedFraction > 0 && !findings.slice(0, 3).some((f) => f.id === 'uncategorised') ? (
        <Text style={styles.note}>
          {Math.round(uncategorisedFraction * 100)}% of this period's spending has no category yet,
          so the breakdown above is missing it.
        </Text>
      ) : null}
    </Screen>
  );
}

function weekDetail(thisWeek: number, lastWeek: number): string {
  const comparison = compareWeeks(thisWeek, lastWeek);
  if (comparison.change === null) return 'Nothing the week before to compare with';
  if (comparison.direction === 'FLAT')
    return `About the same as the ${formatMoney(lastWeek)} before`;
  return `${Math.abs(Math.round(comparison.change * 100))}% ${
    comparison.direction === 'UP' ? 'more' : 'less'
  } than the ${formatMoney(lastWeek)} before`;
}

type Day = { day: string; total: number };

/**
 * Every calendar day of the period so far, with ₹0 for the quiet ones. The
 * query only returns days that had spending, and a chart that skips the
 * quiet days hides exactly the days worth being pleased about.
 */
function fillDays(daily: Day[], periodStart: string): Day[] {
  const byDay = new Map(daily.map((d) => [d.day, d.total]));
  const today = localDay(new Date());
  const cursor = new Date(periodStart);
  const out: Day[] = [];
  // ponytail: walks at most 62 days; a longer custom period shows its last 31.
  for (let i = 0; i < 62; i += 1) {
    const day = localDay(cursor);
    if (day > today) break;
    out.push({ day, total: byDay.get(day) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out.length > 0 ? out.slice(-31) : daily.slice(-31);
}

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dayName(day: string): string {
  if (day === localDay(new Date())) return 'Today';
  const d = new Date(`${day}T12:00:00`);
  return `${WEEKDAY_SHORT[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

/**
 * Each day of the period as a bar you can scrub, or, one tap on the header
 * away, the week's rhythm: what an average Monday, Tuesday … costs you.
 */
function Daily({
  days,
  weekdays,
  dailyLimit,
  children,
}: {
  days: Day[];
  weekdays: WeekdayPattern[];
  dailyLimit: number;
  children: React.ReactNode;
}) {
  const [byWeekday, setByWeekday] = useState(false);
  const [pickedDay, setPickedDay] = useState<number | null>(null);
  const [pickedWeekday, setPickedWeekday] = useState<number | null>(null);

  const weekly = WEEKDAY_ORDER.map((weekday) => ({
    weekday,
    average: weekdays.find((w) => w.weekday === weekday)?.average ?? 0,
  }));
  const priciest = weekly.reduce((best, w, i) => (w.average > weekly[best].average ? i : best), 0);

  let readout: React.ReactNode;
  let chart: React.ReactNode;
  if (byWeekday) {
    const index = pickedWeekday ?? priciest;
    const plural = `${WEEKDAY_FULL[weekly[index].weekday]}s`;
    readout = (
      <Readout
        name={index === priciest ? `${plural}, your priciest day` : plural}
        value={formatMoney(weekly[index].average)}
        note="on average"
      />
    );
    chart = (
      <ScrubBars
        bars={weekly.map((w) => ({
          key: String(w.weekday),
          value: w.average,
          label: WEEKDAY_LETTERS[w.weekday],
        }))}
        selected={index}
        onSelect={setPickedWeekday}
        describe={(i) =>
          `${WEEKDAY_FULL[weekly[i].weekday]}s, ${formatMoney(weekly[i].average)} on average`
        }
      />
    );
  } else {
    const index = Math.min(pickedDay ?? days.length - 1, days.length - 1);
    const day = days[index];
    const over = dailyLimit > 0 ? day.total - dailyLimit : 0;
    readout = (
      <Readout
        name={dayName(day.day)}
        value={formatMoney(day.total)}
        note={
          day.total === 0
            ? 'nothing spent'
            : over > 0
              ? `${formatMoney(over)} over the day's limit`
              : dailyLimit > 0
                ? 'inside the limit'
                : undefined
        }
        noteColor={over > 0 ? palette.warning : day.total === 0 ? palette.good : palette.textMuted}
      />
    );
    chart = (
      <ScrubBars
        bars={days.map((d) => ({
          key: d.day,
          value: d.total,
          color: dailyLimit > 0 && d.total > dailyLimit ? palette.warning : undefined,
        }))}
        selected={index}
        onSelect={setPickedDay}
        limit={dailyLimit}
        edgeLabels={[dayName(days[0].day), dayName(days[days.length - 1].day)]}
        describe={(i) => `${dayName(days[i].day)}, ${formatMoney(days[i].total)}`}
      />
    );
  }

  return (
    <Group
      title="Daily"
      action={weekdays.length > 0 ? (byWeekday ? 'By date' : 'By weekday') : undefined}
      onAction={() => {
        haptic.tick();
        setByWeekday((v) => !v);
      }}
      footer={
        byWeekday
          ? 'Averaged over your whole history.'
          : `Amber days went over ${formatMoney(dailyLimit)}. Slide along to read a day.`
      }
    >
      <View key="chart" style={styles.chartBlock}>
        {readout}
        {chart}
      </View>
      {children}
    </Group>
  );
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
      {tone === 'WARNING' || tone === 'CRITICAL' ? (
        <View style={[styles.findingMark, { backgroundColor: toneColor(tone) }]} />
      ) : null}
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

/** Rows shown before "n more", so the list is a glance, not a ledger. */
const TOP_CATEGORIES = 5;

/**
 * Categories ranked by what was yours, as one strip you can slide along and
 * the list under it. Where a bill was fronted for others, what you paid is
 * struck through beside your share.
 */
function Categories({
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
  const [picked, setPicked] = useState(0);
  const [all, setAll] = useState(false);
  const totalYours = costs.reduce((sum, c) => sum + c.yours, 0);
  const totalPaid = costs.reduce((sum, c) => sum + c.paid, 0);
  const anySplit = totalPaid - totalYours > 0.5;
  const index = Math.min(picked, costs.length - 1);
  const chosen = costs[index];
  const share = (c: CategoryCost) =>
    totalYours > 0 ? Math.round((c.yours / totalYours) * 100) : 0;

  const footer = [
    anySplit ? 'Struck through is what you paid; bold is your share.' : null,
    borne && borne.stillOwed > 0.5 ? `${formatMoney(borne.stillOwed)} still owed to you.` : null,
    transfers > 0 ? `${transfers} self-transfer${transfers === 1 ? '' : 's'} left out.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const shown = all ? costs : costs.slice(0, TOP_CATEGORIES);
  const hidden = costs.length - shown.length;

  return (
    <Group title="Categories" footer={footer || undefined}>
      <View key="strip" style={styles.chartBlock}>
        <Readout
          name={chosen.category}
          mark={categoryColor(chosen.category)}
          value={formatMoney(chosen.yours)}
          note={`${share(chosen)}% of your ${formatMoney(totalYours)}`}
        />
        <ShareStrip
          shares={costs.map((c) => ({
            key: c.category,
            value: c.yours,
            color: categoryColor(c.category),
          }))}
          selected={index}
          onSelect={setPicked}
          describe={(i) =>
            `${costs[i].category}, ${formatMoney(costs[i].yours)}, ${share(costs[i])}%`
          }
        />
      </View>
      {shown.map((cost) => (
        <Row
          key={cost.category}
          title={cost.category}
          mark={categoryColor(cost.category)}
          onPress={() => onOpen(cost.category)}
          right={
            <View style={styles.categoryRight}>
              {cost.splitAway > 0.5 ? (
                <Text style={styles.categoryPaid}>{formatMoney(cost.paid)}</Text>
              ) : null}
              <Text style={styles.value}>{formatMoney(cost.yours)}</Text>
            </View>
          }
        />
      ))}
      {hidden > 0 || all ? (
        <Pressable
          key="more"
          onPress={() => setAll((v) => !v)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.more, pressed && styles.pressed]}
        >
          <Text style={styles.moreText}>{all ? 'Fewer' : `${hidden} more`}</Text>
          <View style={all ? styles.flip : undefined}>
            <Icon name="chevronDown" size={16} color={palette.textMuted} />
          </View>
        </Pressable>
      ) : null}
    </Group>
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

const MONTH_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Six months as bars you can scrub, then which categories moved this one. */
function Months({
  months,
  shifts,
  onOpen,
}: {
  months: MonthTotal[];
  shifts: CategoryShift[];
  onOpen: (category: string) => void;
}) {
  const monthly: MonthComparison = compareMonths(months);
  const oldestFirst = [...months].reverse();
  const [picked, setPicked] = useState<number | null>(null);
  const index = Math.min(picked ?? oldestFirst.length - 1, oldestFirst.length - 1);
  const chosen = oldestFirst[index];
  const isCurrent = index === oldestFirst.length - 1;
  const name = MONTH_FULL[Number(chosen.month.slice(5, 7)) - 1] ?? chosen.month;

  let note: string;
  let noteColor: string = palette.textMuted;
  if (isCurrent) {
    note =
      monthly.changeVsTypical === null
        ? 'compares itself after one more month'
        : monthly.direction === 'FLAT'
          ? `about your usual ${formatMoney(monthly.typical ?? 0)}`
          : `${Math.abs(Math.round(monthly.changeVsTypical * 100))}% ${
              monthly.direction === 'UP' ? 'faster' : 'slower'
            } than usual${
              monthly.projectedTotal !== null
                ? `, heading for ${formatMoney(monthly.projectedTotal)}`
                : ''
            }`;
    if (monthly.changeVsTypical !== null && monthly.direction !== 'FLAT') {
      noteColor = monthly.direction === 'UP' ? palette.warning : palette.good;
    }
  } else {
    // A past month against the same "usual" the current one is measured by.
    const typical = monthly.typical ?? 0;
    const change = typical > 0 ? (chosen.total - typical) / typical : 0;
    note =
      typical <= 0 || Math.abs(change) < 0.05
        ? 'about usual'
        : `${Math.abs(Math.round(change * 100))}% ${change > 0 ? 'above' : 'below'} usual`;
  }

  return (
    <Group title="Months">
      <View key="chart" style={styles.chartBlock}>
        <Readout
          name={isCurrent ? `${name} so far` : name}
          value={formatMoney(chosen.total)}
          note={note}
          noteColor={noteColor}
        />
        <ScrubBars
          bars={oldestFirst.map((m) => ({
            key: m.month,
            value: m.total,
            label: monthLabel(m.month),
          }))}
          selected={index}
          onSelect={setPicked}
          height={80}
          describe={(i) =>
            `${monthLabel(oldestFirst[i].month)}, ${formatMoney(oldestFirst[i].total)}`
          }
        />
      </View>

      {shifts.slice(0, 4).map((shift) => {
        const up = shift.currentTotal > shift.typicalTotal;
        const diff = Math.abs(shift.currentTotal - shift.typicalTotal);
        return (
          <Row
            key={shift.category}
            title={shift.category}
            mark={categoryColor(shift.category)}
            subtitle={`${formatMoney(shift.currentTotal)} · usually ${formatMoney(shift.typicalTotal)}`}
            onPress={() => onOpen(shift.category)}
            right={
              <Text style={[styles.value, { color: up ? palette.warning : palette.good }]}>
                {up ? '+' : '−'}
                {formatMoneyCompact(diff)}
              </Text>
            }
          />
        );
      })}
    </Group>
  );
}

/** A finding's colour carries its urgency, so the eye ranks them before the words do. */
function toneColor(tone: FindingTone): string {
  switch (tone) {
    case 'CRITICAL':
      return palette.danger;
    case 'WARNING':
      return palette.warning;
    case 'GOOD':
      return palette.textPrimary;
    default:
      return palette.textMuted;
  }
}

/** The hero stays white unless there is something to be worried or pleased about. */
function heroColor(tone: FindingTone): string {
  return tone === 'NEUTRAL' ? palette.textPrimary : toneColor(tone);
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.72 },

  finding: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  // A tone-coloured rule down the side, so urgency is legible before a word is read.
  findingMark: { width: 2, borderRadius: 1, alignSelf: 'stretch' },
  findingBody: { flex: 1, gap: 3 },
  findingHeadline: { ...typography.bodyBold, color: palette.textPrimary },
  findingDetail: {
    ...typography.caption,
    color: palette.textSecondary,
    lineHeight: 18,
  },

  chartBlock: { paddingVertical: spacing.md },
  note: {
    ...typography.caption,
    color: palette.textMuted,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  value: { ...typography.bodyBold, color: palette.textPrimary },

  categoryRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  categoryPaid: {
    ...typography.caption,
    color: palette.textMuted,
    textDecorationLine: 'line-through',
  },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  moreText: { ...typography.body, color: palette.textSecondary },
  flip: { transform: [{ rotate: '180deg' }] },

  paceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  paceBody: { flex: 1, gap: 2 },
  paceTitle: { ...typography.body, color: palette.textPrimary },
  paceDetail: { ...typography.caption, color: palette.textSecondary },
});
