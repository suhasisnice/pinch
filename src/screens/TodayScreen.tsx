import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as db from '../db/dbService';
import { rowCategoryLabel } from '../math/categoryTaxonomy';
import { BudgetSnapshot, getBudgetSnapshot } from '../services/budgetService';
import { ingestPending } from '../services/captureService';
import {
  getCushionGoalId,
  getDismissedDiscrepancy,
  getKeptLookalikes,
  getMonthlyAllowance,
  keepLookalike,
  getNotificationSettings,
  setDismissedDiscrepancy,
} from '../settings/settingsStore';
import { computeToday, shouldRaiseDiscrepancy } from '../math/budget';
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
import { formatMoney } from '../utils/format';
import {
  accentForState,
  amountColor,
  categoryColor,
  palette,
  radii,
  spacing,
  typography,
} from '../theme/theme';
import { setTodayTone } from '../theme/todayTone';
import LinkedGroupRow from '../components/LinkedGroupRow';
import { ReimbursementLink, groupLinkedTransactions } from '../math/reimbursement';
import { Group, Loading, ProgressBar, Row, Screen, SentenceRow, TextLink } from '../components/ui';
import AddExpenseSheet from '../components/AddExpenseSheet';
import SplitModal from '../components/SplitModal';
import TransactionDetailSheet from '../components/TransactionDetailSheet';
import MarkAsLoanSheet from '../components/MarkAsLoanSheet';
import NetOutSheet from '../components/NetOutSheet';
import FreshStartSheet from '../components/FreshStartSheet';
import BudgetBreakdownSheet from '../components/BudgetBreakdownSheet';
import ReconcileSheet from '../components/ReconcileSheet';
import BalanceCard, { MoneyLine } from '../components/BalanceCard';
import { showDialog } from '../components/Dialog';
import type { LookalikePair } from '../db/repos/transactions';
import { AnimatedMoney, FadeSlideIn, useReducedMotion } from '../components/motion';
import Icon from '../components/Icon';

const minutesApart = (pair: LookalikePair) =>
  Math.round((Date.parse(pair.secondAt) - Date.parse(pair.firstAt)) / 60_000);

export default function TodayScreen() {
  const navigation = useNavigation<any>();
  const [snapshot, setSnapshot] = useState<BudgetSnapshot | null>(null);
  const [today, setToday] = useState<TransactionRow[]>([]);
  const [links, setLinks] = useState<ReimbursementLink[]>([]);
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
  const [linkFor, setLinkFor] = useState<TransactionRow | null>(null);
  const [freshVisible, setFreshVisible] = useState(false);
  const [breakdownVisible, setBreakdownVisible] = useState(false);
  const [owedByTx, setOwedByTx] = useState<Map<number, number>>(new Map());
  const [reconcileVisible, setReconcileVisible] = useState(false);
  const [showDiscrepancy, setShowDiscrepancy] = useState(false);
  const [lookalikes, setLookalikes] = useState<LookalikePair[]>([]);
  const [cash, setCash] = useState<Awaited<ReturnType<typeof db.getCashState>> | null>(null);
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
    setCash(await db.getCashState());
    const cushionId = await getCushionGoalId();
    const cushionGoal = cushionId === null ? null : await db.getGoalById(cushionId);
    setCushion(
      cushionGoal ? { saved: cushionGoal.savedAmount, target: cushionGoal.targetAmount } : null
    );
    setToday(await db.getTransactionsBetween(start.toISOString(), end.toISOString()));
    setLinks(await db.getReimbursementLinks());
    // One lookup for the whole day rather than one per row.
    setOwedByTx(await db.getOpenReceivableByTransaction());

    const kept = await getKeptLookalikes();
    const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000).toISOString();
    setLookalikes(
      (await db.getLookalikePairs(twoWeeksAgo)).filter(
        (pair) => !kept.includes(`${pair.firstId}:${pair.secondId}`)
      )
    );

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
  const periodLeft = Math.max(0, snapshot.availableBudget);
  // Everything that wants an answer rides on the bell, most pressing first.
  const gap = showDiscrepancy && snapshot.balanceConsistency ? 1 : 0;
  const alertCount = snapshot.pendingCaptures + lookalikes.length + gap;
  function openAlert() {
    if (snapshot!.pendingCaptures > 0 || alertCount === 0) navigation.navigate('Review');
    else if (lookalikes.length > 0) askLookalike(lookalikes[0]);
    else setReconcileVisible(true);
  }

  // Both rows are already logged; this only asks, and removes nothing unasked.
  async function askLookalike(pair: LookalikePair) {
    const answer = await showDialog({
      title: 'Same payment twice?',
      message: `${formatMoney(pair.amount)} is logged for ${pair.firstMerchant} and again for ${pair.secondMerchant}, ${minutesApart(pair)} min apart.`,
      actions: [
        { label: 'Keep both', value: 'keep', variant: 'secondary' },
        { label: 'Remove the copy', value: 'remove', variant: 'danger' },
      ],
      dismissValue: null,
    });
    if (answer === 'remove') await db.setTransactionExcluded(pair.secondId, true);
    else if (answer === 'keep') await keepLookalike(`${pair.firstId}:${pair.secondId}`);
    else return;
    load();
  }

  return (
    <Screen
      overlay={
        <>
          <View style={styles.corner}>
            <AlertBell active={alertCount > 0} onPress={openAlert} />
            <Pressable
              onPress={() => navigation.navigate('Settings')}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              hitSlop={8}
              style={({ pressed }) => [styles.float, pressed && styles.pressed]}
            >
              <Icon name="settings" size={20} color={palette.textMuted} />
            </Pressable>
          </View>
          <Pressable
            onPress={() => {
              setAddThenSplit(false);
              setAddVisible(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Add a spend"
            style={({ pressed }) => [styles.add, pressed && styles.pressed]}
          >
            <Icon name="addCircle" size={56} color={palette.accent} />
          </Pressable>
        </>
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={palette.textSecondary}
        />
      }
    >
      {/* One number, then the three figures behind it, then the day. Anything
          that wants attention lives on the bell, not in the page. */}
      <View style={styles.hero}>
        <Text style={styles.date}>{longDate(new Date())}</Text>
        {snapshot.budget.spendablePool < 0 ? (
          <View style={styles.trouble}>
            <View style={styles.troubleLine}>
              <Icon name="alert" size={18} color={palette.warning} />
              <Text style={styles.troubleText}>
                {formatMoney(-snapshot.budget.spendablePool)} past your allowance. Likely a
                miscount.
              </Text>
            </View>
            <View style={styles.inlineActions}>
              <TextLink
                label="See what counted"
                onPress={() => navigation.navigate('Transactions')}
              />
              <TextLink label="Start fresh" onPress={() => setFreshVisible(true)} />
            </View>
          </View>
        ) : null}
        <FadeSlideIn>
          <Pressable
            onPress={() => setBreakdownVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={`${formatMoney(Math.max(0, snapshot.today.remainingToday))} left to spend today. How this is worked out`}
            style={({ pressed }) => [styles.heroPress, pressed && styles.heroPressed]}
          >
            <AnimatedMoney
              amount={Math.max(0, day.remainingToday)}
              style={styles.numeral}
              numberOfLines={1}
              adjustsFontSizeToFit
            />
            <Text style={[styles.heroLabel, { color: tone }]}>
              {recovery && onMission
                ? `left today · recovery day ${recovery.progress.dayNumber} of ${recovery.mission.daysNeeded}`
                : 'left today'}
            </Text>
            <ProgressBar fraction={1 - day.usedFraction} color={tone} height={4} />
          </Pressable>
        </FadeSlideIn>
        {pending ? (
          <Text style={[styles.note, { color: palette.warning }]}>
            Recovery starts tomorrow: {pending.daysNeeded} days at {formatMoney(pending.target)}.
          </Text>
        ) : null}
        {reprimand ? <Text style={[styles.note, { color: palette.danger }]}>{reprimand}</Text> : null}
      </View>

      <Group>
        <MoneyLine
          title="Left in budget"
          meta={`For the next ${snapshot.daysRemaining} days`}
          value={periodLeft}
          onPress={() => setBreakdownVisible(true)}
        />
        {balance ? <BalanceCard state={balance} onChanged={load} cushion={cushion} /> : null}
        {cash ? <BalanceCard state={cash} onChanged={load} pocket="CASH" /> : null}
      </Group>

      <View style={styles.list}>
        <View style={styles.listHead}>
          <Text style={styles.listTitle} accessibilityRole="header">
            Today
          </Text>
          <Pressable
            onPress={() => navigation.navigate('Transactions')}
            accessibilityRole="button"
            accessibilityLabel="All transactions"
            hitSlop={12}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Icon name="transactions" size={20} color={palette.textSecondary} />
          </Pressable>
        </View>
        {today.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="receipt" size={36} color={palette.textMuted} />
            <Text style={styles.emptyText}>Nothing spent yet</Text>
          </View>
        ) : (
          <Group>
            {/* A spend and what paid it back show as one line at the net, as in Transactions. */}
            {groupLinkedTransactions(today, links).map((item) => {
              if (item.type === 'group') {
                return <LinkedGroupRow key={`g${item.key}`} group={item} onOpen={setDetailFor} />;
              }
              const tx = item.transaction;
              const owed = owedByTx.get(tx.id);
              return (
                <Row
                  key={tx.id}
                  title={tx.merchant}
                  mark={categoryColor(tx.category)}
                  subtitle={
                    owed !== undefined
                      ? `${formatMoney(owed)} coming back`
                      : rowCategoryLabel(tx, '') || undefined
                  }
                  onPress={() => setDetailFor(tx)}
                  right={
                    <Text style={[styles.txAmount, { color: amountColor(tx.direction) }]}>
                      {tx.direction === 'CREDIT' ? '+' : ''}
                      {formatMoney(tx.amount)}
                    </Text>
                  }
                />
              );
            })}
          </Group>
        )}
      </View>

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
        onLinkReimbursement={(tx) => {
          setDetailFor(null);
          setLinkFor(tx);
        }}
      />

      <NetOutSheet
        transaction={linkFor}
        onClose={() => setLinkFor(null)}
        onSaved={() => {
          setLinkFor(null);
          load();
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

/** "Thursday, 24 September" */
function longDate(d: Date): string {
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** A notification line, as a sentence on screen. */
function sentence(line: string): string {
  const s = line.charAt(0).toUpperCase() + line.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** How often the bell shakes while something is waiting. */
const BELL_EVERY_MS = 150_000;

/**
 * The one place alerts live. Quiet and grey when there is nothing; red, with
 * a short shake every couple of minutes, while something wants an answer.
 */
function AlertBell({ active, onPress }: { active: boolean; onPress: () => void }) {
  const shake = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!active || reduced) return;
    const ring = () =>
      Animated.sequence(
        [1, -1, 1, -1, 0].map((toValue) =>
          Animated.timing(shake, { toValue, duration: 90, useNativeDriver: true })
        )
      ).start();
    ring();
    const id = setInterval(ring, BELL_EVERY_MS);
    return () => clearInterval(id);
  }, [active, reduced, shake]);

  const rotate = shake.interpolate({ inputRange: [-1, 1], outputRange: ['-14deg', '14deg'] });
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={active ? 'Something needs a look' : 'Review'}
      hitSlop={8}
      style={({ pressed }) => [styles.float, pressed && styles.pressed]}
    >
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Icon
          name={active ? 'bellDot' : 'bell'}
          size={20}
          color={active ? palette.danger : palette.textMuted}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },

  // Fixed over the page: the bell, the cog under it, and the add button.
  corner: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.gutter,
    gap: spacing.sm,
    alignItems: 'center',
  },
  float: {
    padding: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: palette.surfaceElevated,
  },
  add: { position: 'absolute', right: spacing.gutter, bottom: spacing.lg },

  // Kept clear of the fixed corner so a wide number never runs under it.
  hero: { gap: spacing.md, paddingRight: spacing.xxl + spacing.lg },
  date: { ...typography.overline, color: palette.textMuted },
  heroPress: { gap: spacing.xs },
  heroPressed: { opacity: 0.72 },
  numeral: {
    ...typography.numeral,
    fontSize: 68,
    lineHeight: 76,
    letterSpacing: -3,
    color: palette.textPrimary,
  },
  heroLabel: { ...typography.caption, marginBottom: spacing.sm },
  note: { ...typography.body },

  trouble: { gap: spacing.sm },
  troubleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  troubleText: { ...typography.body, color: palette.warning, flex: 1 },
  inlineActions: { flexDirection: 'row', gap: spacing.lg },

  list: { gap: spacing.sm },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listTitle: { ...typography.overline, color: palette.textMuted },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyText: { ...typography.body, color: palette.textMuted },
  txAmount: { ...typography.body, color: palette.textPrimary },

  more: { paddingTop: spacing.sm },
});
