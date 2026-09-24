import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as db from '../db/dbService';
import { rowCategoryLabel } from '../math/categoryTaxonomy';
import { BudgetSnapshot, getBudgetSnapshot } from '../services/budgetService';
import { ingestPending } from '../services/captureService';
import {
  getCushionGoalId,
  getDismissedDiscrepancy,
  getMonthlyAllowance,
  getNotificationSettings,
  setDismissedDiscrepancy,
} from '../settings/settingsStore';
import { computeToday, daysUntilBroke, shouldRaiseDiscrepancy } from '../math/budget';
import {
  RecoveryView,
  WeekPatterns,
  getWeekPatterns,
  refreshRecovery,
  scheduleHeadsUps,
} from '../services/interventionService';
import { Tone, roast } from '../notifications/roasts';
import { suggestedCap } from '../math/patterns';
import CapSheet, { CapDraft } from '../components/CapSheet';
import { celebrate } from '../components/Moment';
import { TransactionRow } from '../db/types';
import { formatMoney, formatTime } from '../utils/format';
import {
  accentForState,
  amountColor,
  categoryColor,
  palette,
  spacing,
  typography,
} from '../theme/theme';
import { setTodayTone } from '../theme/todayTone';
import {
  Button,
  Group,
  Loading,
  Row,
  Screen,
  Section,
  SentenceRow,
  TextLink,
} from '../components/ui';
import AddExpenseSheet from '../components/AddExpenseSheet';
import SplitModal from '../components/SplitModal';
import TransactionDetailSheet from '../components/TransactionDetailSheet';
import MarkAsLoanSheet from '../components/MarkAsLoanSheet';
import FreshStartSheet from '../components/FreshStartSheet';
import BudgetBreakdownSheet from '../components/BudgetBreakdownSheet';
import ReconcileSheet from '../components/ReconcileSheet';
import QuickReimburseSheet from '../components/QuickReimburseSheet';
import BalanceCard from '../components/BalanceCard';
import AffordSheet from '../components/AffordSheet';
import WeekStrip, { WeekDay } from '../components/WeekStrip';
import Ring from '../components/Ring';
import { AnimatedMoney, FadeSlideIn } from '../components/motion';
import Icon from '../components/Icon';

/** Below this, "for someone?" is noise — a solo coffee is never a split. */
const REIMBURSE_PROMPT_MIN = 200;

export default function TodayScreen() {
  const navigation = useNavigation<any>();
  const { height: windowHeight } = useWindowDimensions();
  const [snapshot, setSnapshot] = useState<BudgetSnapshot | null>(null);
  const [today, setToday] = useState<TransactionRow[]>([]);
  const [balance, setBalance] = useState<Awaited<ReturnType<typeof db.getBalanceState>> | null>(
    null
  );
  const [cushion, setCushion] = useState<{ saved: number; target: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [addVisible, setAddVisible] = useState(false);
  const [addThenSplit, setAddThenSplit] = useState(false);
  const [splitFor, setSplitFor] = useState<TransactionRow | null>(null);
  const [detailFor, setDetailFor] = useState<TransactionRow | null>(null);
  const [loanFor, setLoanFor] = useState<TransactionRow | null>(null);
  const [freshVisible, setFreshVisible] = useState(false);
  const [breakdownVisible, setBreakdownVisible] = useState(false);
  const [affordVisible, setAffordVisible] = useState(false);
  const [reimburseFor, setReimburseFor] = useState<TransactionRow | null>(null);
  const [owedByTx, setOwedByTx] = useState<Map<number, number>>(new Map());
  const [week, setWeek] = useState<WeekDay[]>([]);
  const [reconcileVisible, setReconcileVisible] = useState(false);
  const [showDiscrepancy, setShowDiscrepancy] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryView | null>(null);
  const [patterns, setPatterns] = useState<WeekPatterns>({ callouts: [], caps: [] });
  const [voice, setVoice] = useState<Tone>('SAVAGE');
  const [reprimand, setReprimand] = useState<string | null>(null);
  const [capDraft, setCapDraft] = useState<CapDraft | null>(null);
  const [adjustmentPrefill, setAdjustmentPrefill] = useState<{
    amount: string;
    direction: 'DEBIT' | 'CREDIT';
  } | null>(null);

  const load = useCallback(async () => {
    // Collect anything the native listeners buffered while the app was closed
    // before computing the numbers, so the screen never shows a stale total.
    await ingestPending().catch(() => undefined);

    const allowance = await getMonthlyAllowance();
    const next = await getBudgetSnapshot(allowance);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    setSnapshot(next);

    // Interventions (0.9.19): the mission, this week's patterns, and the
    // heads-ups scheduled ahead of the next risky window.
    const settings = await getNotificationSettings();
    const tone: Tone = settings.roastMe ? 'SAVAGE' : 'FIRM';
    setVoice(tone);
    if (settings.interventionsEnabled) {
      const rec = await refreshRecovery(next);
      setRecovery(rec.view);
      if (rec.about && rec.events.includes('RECOVERY_DONE')) {
        celebrate(`Recovered. ${formatMoney(rec.about.overBy)} paid back.`);
      }
      setReprimand(
        rec.about && rec.events.includes('RECOVERY_FAILED')
          ? sentence(roast('RECOVERY_FAILED', tone, { overBy: rec.about.overBy }))
          : null
      );
      setPatterns(await getWeekPatterns());
    } else {
      setRecovery(null);
      setPatterns({ callouts: [], caps: [] });
    }
    scheduleHeadsUps(next, settings).catch(() => undefined);

    setBalance(await db.getBalanceState());
    const cushionId = await getCushionGoalId();
    const cushionGoal = cushionId === null ? null : await db.getGoalById(cushionId);
    setCushion(
      cushionGoal ? { saved: cushionGoal.savedAmount, target: cushionGoal.targetAmount } : null
    );
    setToday(await db.getTransactionsBetween(start.toISOString(), end.toISOString()));
    // One lookup for the whole day rather than one per row.
    setOwedByTx(await db.getOpenReceivableByTransaction());
    setWeek(await loadWeek(start));

    // Dismissing one gap should not silence a different, larger one later.
    const dismissed = await getDismissedDiscrepancy();
    setShowDiscrepancy(
      next.balanceConsistency
        ? shouldRaiseDiscrepancy(next.balanceConsistency.discrepancy, dismissed)
        : false
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // During a recovery mission the day is measured against the mission's
  // tighter number, not the ordinary limit: that is the intervention.
  const onMission = recovery?.progress.status === 'ACTIVE';
  const dayStatus =
    snapshot && recovery && onMission
      ? computeToday(recovery.mission.target, snapshot.today.spentToday)
      : (snapshot?.today ?? null);

  // The tab bar wears the same colour as the ring.
  const state = dayStatus?.state;
  useEffect(() => {
    if (state) setTodayTone(accentForState(state));
  }, [state]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!snapshot) {
    return (
      <Screen scroll={false}>
        <Loading label="Working out your number…" />
      </Screen>
    );
  }

  const day = dayStatus ?? snapshot.today;
  const tone = accentForState(day.state);
  const pending = recovery?.progress.status === 'PENDING' ? recovery.mission : null;
  const brokeIn = daysUntilBroke(snapshot.budget.spendablePool, snapshot.avgDailyBurn);
  const runsOutEarly = brokeIn !== null && brokeIn < snapshot.daysRemaining;
  const periodLeft = Math.max(0, snapshot.availableBudget);
  const weekTotal = week.reduce((sum, d) => sum + d.total, 0);
  const worstDay = week.reduce<WeekDay | null>(
    (worst, d) => (!d.isFuture && d.total > (worst?.total ?? 0) ? d : worst),
    null
  );

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
      {/* The first screenful is one number and one line. Everything else is
          a scroll away — you came to learn one thing. */}
      <View style={[styles.first, { minHeight: Math.round(windowHeight * 0.62) }]}>
        <View style={styles.topBar}>
          <Text style={styles.date}>{longDate(new Date())}</Text>
          <Pressable
            onPress={() => navigation.navigate('Settings')}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            hitSlop={14}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Icon name="settings" size={20} color={palette.textMuted} />
          </Pressable>
        </View>

        {snapshot.budget.spendablePool < 0 ? (
          <View style={styles.trouble}>
            <Text style={styles.troubleText}>
              The numbers say you're {formatMoney(-snapshot.budget.spendablePool)} past your
              allowance. More likely, something got counted that shouldn't have.
            </Text>
            <View style={styles.inlineActions}>
              <TextLink
                label="See what counted"
                onPress={() => navigation.navigate('Transactions')}
              />
              <TextLink label="Start fresh" onPress={() => setFreshVisible(true)} />
            </View>
          </View>
        ) : null}

        <FadeSlideIn style={styles.hero}>
          <Pressable
            onPress={() => setBreakdownVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={`${formatMoney(Math.max(0, snapshot.today.remainingToday))} left to spend today. How this is worked out`}
            style={({ pressed }) => pressed && styles.heroPressed}
          >
            <View style={styles.ringWrap}>
              <Ring fraction={1 - day.usedFraction} color={tone}>
                <AnimatedMoney
                  amount={Math.max(0, day.remainingToday)}
                  style={styles.numeral}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                />
                <Text style={[styles.ringLabel, { color: tone }]}>
                  {recovery && onMission
                    ? `recovery · day ${recovery.progress.dayNumber} of ${recovery.mission.daysNeeded}`
                    : 'left today'}
                </Text>
              </Ring>
            </View>
            <Text style={styles.quip}>
              {recovery && onMission
                ? missionQuip(recovery, day.state === 'OVER', voice)
                : todayQuip(snapshot, runsOutEarly ? brokeIn : null)}
            </Text>
            {pending ? (
              <Text style={[styles.mission, { color: palette.warning }]}>
                Recovery starts tomorrow: {pending.daysNeeded} days at {formatMoney(pending.target)}
                .
              </Text>
            ) : null}
            {reprimand ? (
              <Text style={[styles.mission, { color: palette.danger }]}>{reprimand}</Text>
            ) : null}
            <Text style={styles.heroMeta}>
              {formatMoney(day.spentToday)} of {formatMoney(day.dailyLimit)} gone ·{' '}
              {recovery && onMission
                ? `${formatMoney(recovery.mission.normalLimit)} a day again after`
                : `${snapshot.daysRemaining} days to payday`}
            </Text>
          </Pressable>
        </FadeSlideIn>

        <View style={styles.firstFooter}>
          {snapshot.pendingCaptures > 0 ? (
            <TextLink
              label={
                snapshot.pendingCaptures === 1
                  ? '1 payment wants a word'
                  : `${snapshot.pendingCaptures} payments want a word`
              }
              onPress={() => navigation.navigate('Review')}
              accent
            />
          ) : null}
          <View style={styles.actionRow}>
            <Button
              label="Add a spend"
              icon="add"
              variant="outlined"
              size="small"
              onPress={() => {
                setAddThenSplit(false);
                setAddVisible(true);
              }}
            />
            <Text style={styles.scrollHint}>
              {today.length === 0
                ? 'nothing below yet'
                : `${today.length} ${today.length === 1 ? 'spend' : 'spends'} below ↓`}
            </Text>
          </View>
        </View>
      </View>

      <Group title="Today">
        {today.length === 0 ? (
          <Text style={styles.empty}>Nothing yet. Frugal, or forgetful?</Text>
        ) : (
          today.map((tx) => {
            const owed = owedByTx.get(tx.id);
            // Only spending can be owed back, and only once. Kept for amounts
            // big enough to plausibly have been for more than one person.
            const canReimburse =
              tx.kind === 'SPEND' && owed === undefined && tx.amount >= REIMBURSE_PROMPT_MIN;
            return (
              <Row
                key={tx.id}
                title={tx.merchant}
                mark={categoryColor(tx.category)}
                subtitle={`${formatTime(tx.occurred_at)} · ${rowCategoryLabel(tx, 'no category')}`}
                onPress={() => setDetailFor(tx)}
                right={
                  <View style={styles.txRight}>
                    <Text style={[styles.txAmount, { color: amountColor(tx.direction) }]}>
                      {tx.direction === 'CREDIT' ? '+' : ''}
                      {formatMoney(tx.amount)}
                    </Text>
                    {owed !== undefined ? (
                      <Text style={styles.txNote}>{formatMoney(owed)} coming back</Text>
                    ) : canReimburse ? (
                      <Pressable
                        onPress={() => setReimburseFor(tx)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Say who ${tx.merchant} was for`}
                      >
                        <Text style={styles.txNote}>for someone?</Text>
                      </Pressable>
                    ) : null}
                  </View>
                }
              />
            );
          })
        )}
      </Group>

      {week.length === 7 ? (
        <Section title="This week">
          <Text style={styles.sentence}>
            {formatMoney(weekTotal)} so far
            {worstDay && worstDay.total > snapshot.today.dailyLimit
              ? `. ${FULL_DAYS[week.indexOf(worstDay)]} did most of the damage.`
              : weekTotal > 0
                ? '. Nothing dramatic.'
                : '. Quiet week.'}
          </Text>
          <WeekStrip days={week} limit={snapshot.today.dailyLimit} todayColor={tone} />
        </Section>
      ) : null}

      {patterns.callouts.length > 0 || patterns.caps.length > 0 ? (
        <Group title="Patterns">
          {patterns.callouts.map((c) => (
            <SentenceRow
              key={`${c.scope}:${c.key}`}
              tone={palette.warning}
              text={`${sentence(
                roast('CALLOUT', voice, {
                  label: c.label,
                  count: c.count,
                  total: c.total,
                  usual: c.usualWeekly,
                })
              )} Cap it?`}
              onPress={() =>
                setCapDraft({
                  scope: c.scope,
                  label: c.label,
                  amount: suggestedCap(c),
                  spent: c.total,
                })
              }
            />
          ))}
          {patterns.caps.map(({ cap, spent, level }) => (
            <SentenceRow
              key={cap.id}
              tone={
                level === 'BROKEN' ? palette.danger : level === 'NEAR' ? palette.warning : undefined
              }
              text={`${cap.label}: ${formatMoney(spent)} of ${formatMoney(cap.weeklyAmount)} this week`}
              onPress={() =>
                setCapDraft({
                  scope: cap.scope,
                  label: cap.label,
                  amount: cap.weeklyAmount,
                  id: cap.id,
                  spent,
                })
              }
            />
          ))}
        </Group>
      ) : null}

      <Group title="The month">
        <SentenceRow
          onPress={() => setBreakdownVisible(true)}
          text={`${formatMoney(periodLeft)} left for ${snapshot.daysRemaining} days`}
        />
        {snapshot.protectedMoney > 0.009 ? (
          <SentenceRow
            onPress={() => navigation.navigate('Plans')}
            text={`${formatMoney(snapshot.protectedMoney)} already spoken for by plans`}
          />
        ) : null}
        {balance ? <BalanceCard state={balance} onChanged={load} cushion={cushion} /> : null}
        {showDiscrepancy && snapshot.balanceConsistency ? (
          <SentenceRow
            onPress={() => setReconcileVisible(true)}
            tone={palette.warning}
            text={
              snapshot.balanceConsistency.discrepancy > 0
                ? `The bank has ${formatMoney(snapshot.balanceConsistency.discrepancy)} Pinch can't explain`
                : `The bank has ${formatMoney(-snapshot.balanceConsistency.discrepancy)} less than it should`
            }
          />
        ) : null}
        <SentenceRow onPress={() => setAffordVisible(true)} text="Can I afford it?" />
      </Group>

      <View style={styles.more}>
        <TextLink label="The long version" onPress={() => navigation.navigate('Insights')} />
      </View>

      <CapSheet
        draft={capDraft}
        onClose={() => setCapDraft(null)}
        onSaved={() => {
          setCapDraft(null);
          load();
        }}
      />

      <AffordSheet
        visible={affordVisible}
        snapshot={snapshot}
        onClose={() => setAffordVisible(false)}
      />

      <AddExpenseSheet
        visible={addVisible}
        title={adjustmentPrefill ? 'Account for it' : addThenSplit ? 'Split a bill' : 'Add expense'}
        saveLabel={addThenSplit ? 'Next: who was there' : 'Save'}
        defaultType={adjustmentPrefill ? 'ADJUSTMENT' : 'EXPENSE'}
        defaultAmount={adjustmentPrefill?.amount ?? ''}
        defaultDirection={adjustmentPrefill?.direction}
        onClose={() => {
          setAddVisible(false);
          setAdjustmentPrefill(null);
        }}
        onSaved={async (transactionId) => {
          setAddVisible(false);
          if (addThenSplit && transactionId !== null) {
            // Straight into the picker with the bill already recorded, so the
            // three split modes are reachable without hunting for something
            // to tap.
            const created = await db.getTransactionById(transactionId);
            if (created) setSplitFor(created);
          }
          setAddThenSplit(false);
          setAdjustmentPrefill(null);
          load();
        }}
      />

      <QuickReimburseSheet
        transaction={reimburseFor}
        onClose={() => setReimburseFor(null)}
        onSaved={() => {
          setReimburseFor(null);
          load();
        }}
      />

      <ReconcileSheet
        visible={reconcileVisible}
        consistency={snapshot.balanceConsistency}
        onClose={() => setReconcileVisible(false)}
        onFindIt={() => {
          setReconcileVisible(false);
          navigation.navigate('Review');
        }}
        onAddIt={(amount, direction) => {
          setReconcileVisible(false);
          setAdjustmentPrefill({ amount: String(Math.round(amount)), direction });
          setAddVisible(true);
        }}
        onIgnore={async () => {
          await setDismissedDiscrepancy(snapshot.balanceConsistency?.discrepancy ?? null);
          setReconcileVisible(false);
          setShowDiscrepancy(false);
        }}
      />

      <BudgetBreakdownSheet
        visible={breakdownVisible}
        snapshot={snapshot}
        onClose={() => setBreakdownVisible(false)}
      />

      <FreshStartSheet
        visible={freshVisible}
        onClose={() => setFreshVisible(false)}
        onDone={() => {
          setFreshVisible(false);
          load();
        }}
      />

      <TransactionDetailSheet
        transaction={detailFor}
        onClose={() => setDetailFor(null)}
        onChanged={load}
        onSplit={(tx) => {
          setDetailFor(null);
          setSplitFor(tx);
        }}
        onMarkLoan={(tx) => {
          setDetailFor(null);
          setLoanFor(tx);
        }}
      />

      <MarkAsLoanSheet
        transaction={loanFor}
        onClose={() => setLoanFor(null)}
        onSaved={() => {
          setLoanFor(null);
          load();
        }}
      />

      <SplitModal
        visible={splitFor !== null}
        transaction={splitFor}
        onClose={() => setSplitFor(null)}
        onSplit={() => {
          setSplitFor(null);
          load();
        }}
      />
    </Screen>
  );
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
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
const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** "Thursday, 24 September" */
function longDate(d: Date): string {
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * The one line under the number. Dry, short, and always true: every
 * branch is decided by the same figures the number is, so the joke never
 * contradicts the maths.
 */
export function todayQuip(snapshot: BudgetSnapshot, runsOutIn: number | null): string {
  const t = snapshot.today;
  if (t.state === 'OVER')
    return `A little over, by ${formatMoney(-t.remainingToday)}. Tomorrow resets.`;
  if (runsOutIn !== null) {
    return runsOutIn <= 0
      ? 'Running on fumes this month. Easy does it.'
      : `At this pace it lasts ${runsOutIn} more ${runsOutIn === 1 ? 'day' : 'days'}, not ${snapshot.daysRemaining}. Easy does it.`;
  }
  if (t.spentToday <= 0) return 'Nothing spent yet. Nice and quiet.';
  if (t.state === 'CLOSE') return 'Almost at today’s limit. Home stretch.';
  if (snapshot.streakDays >= 3) return `${snapshot.streakDays} days under budget. Lovely.`;
  return 'Going well. Keep it steady.';
}

/** A notification line, as a sentence on screen. */
function sentence(line: string): string {
  const s = line.charAt(0).toUpperCase() + line.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** The line under the ring while a recovery mission runs. */
export function missionQuip(recovery: RecoveryView, overToday: boolean, voice: Tone): string {
  const { mission, progress } = recovery;
  if (overToday) {
    return voice === 'SAVAGE'
      ? `Past ${formatMoney(mission.target)} on a recovery day. Bold. This one won't count.`
      : "Over today's recovery number. This day won't count.";
  }
  if (progress.lastResult === 'SLIPPED') {
    return voice === 'SAVAGE'
      ? 'Yesterday slipped. The spare day is gone. No more of that.'
      : 'Yesterday slipped, so the mission runs a day longer.';
  }
  if (progress.lastResult === 'HELD') return 'Yesterday held. Same again.';
  return `${formatMoney(mission.overBy)} to win back. ${formatMoney(mission.target)} is the whole day.`;
}

/**
 * Monday to Sunday of the current week, each day's spend summed over the
 * phone's own midnight-to-midnight (not the UTC day).
 */
async function loadWeek(todayStart: Date): Promise<WeekDay[]> {
  const monday = new Date(todayStart);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Promise.all(
    DAY_LETTERS.map(async (label, i) => {
      const from = new Date(monday);
      from.setDate(monday.getDate() + i);
      const to = new Date(from);
      to.setDate(from.getDate() + 1);
      const isFuture = from > todayStart;
      const rows = isFuture ? [] : await db.getDailySpend(from.toISOString(), to.toISOString());
      return {
        label,
        total: rows.reduce((sum, r) => sum + r.total, 0),
        isToday: from.getTime() === todayStart.getTime(),
        isFuture,
      };
    })
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
  first: { justifyContent: 'space-between', gap: spacing.lg },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date: { ...typography.overline, color: palette.textMuted },

  hero: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  ringWrap: { alignItems: 'center' },
  ringLabel: { ...typography.caption, color: palette.textMuted, marginTop: 2 },
  heroPressed: { opacity: 0.72 },
  numeral: {
    ...typography.numeral,
    fontSize: 68,
    lineHeight: 76,
    letterSpacing: -3,
    color: palette.textPrimary,
  },
  quip: {
    ...typography.quip,
    fontSize: 19,
    lineHeight: 26,
    color: palette.textPrimary,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  mission: {
    ...typography.body,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  heroMeta: {
    ...typography.caption,
    color: palette.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },

  firstFooter: { gap: spacing.lg },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  scrollHint: { ...typography.caption, color: palette.textMuted },

  trouble: { gap: spacing.sm },
  troubleText: { ...typography.body, color: palette.warning },
  inlineActions: { flexDirection: 'row', gap: spacing.lg },

  empty: { ...typography.body, color: palette.textMuted, paddingVertical: spacing.md },
  txRight: { alignItems: 'flex-end', gap: 1 },
  txAmount: { ...typography.body, color: palette.textPrimary },
  txNote: { ...typography.caption, color: palette.textMuted },

  sentence: { ...typography.quip, fontSize: 19, lineHeight: 26, color: palette.textPrimary },
  more: { paddingTop: spacing.sm },
});
