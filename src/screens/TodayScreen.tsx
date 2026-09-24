import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as db from '../db/dbService';
import { BudgetSnapshot, getBudgetSnapshot } from '../services/budgetService';
import { ingestPending } from '../services/captureService';
import {
  getDismissedDiscrepancy,
  getMonthlyAllowance,
  setDismissedDiscrepancy,
} from '../settings/settingsStore';
import { daysUntilBroke, shouldRaiseDiscrepancy } from '../math/budget';
import { TransactionRow } from '../db/types';
import { formatMoney, formatTime } from '../utils/format';
import {
  accentForState,
  layer,
  palette,
  radii,
  spacing,
  typography,
} from '../theme/theme';
import {
  Group,
  Button,
  Card,
  EmptyState,
  Loading,
  ProgressBar,
  Row,
  Screen,
  ScreenTitle,
} from '../components/ui';
import { CategoryCover } from '../components/Cover';
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
import { AnimatedMoney, FadeSlideIn } from '../components/motion';
import Icon, { IconName } from '../components/Icon';

/** Below this, "for someone?" is noise — a solo coffee is never a split. */
const REIMBURSE_PROMPT_MIN = 200;

export default function TodayScreen() {
  const navigation = useNavigation<any>();
  const [snapshot, setSnapshot] = useState<BudgetSnapshot | null>(null);
  const [today, setToday] = useState<TransactionRow[]>([]);
  const [balance, setBalance] = useState<Awaited<ReturnType<typeof db.getBalanceState>> | null>(
    null
  );
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
    setBalance(await db.getBalanceState());
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

  const accent = accentForState(snapshot.today.state);
  const brokeIn = daysUntilBroke(snapshot.budget.spendablePool, snapshot.avgDailyBurn);
  const runsOutEarly = brokeIn !== null && brokeIn < snapshot.daysRemaining;
  // availableBudget is already net of what was spent; the bar shows how much
  // of the period's spendable money is gone.
  const periodLeft = Math.max(0, snapshot.availableBudget);
  const spentSoFar = snapshot.budget.grossSpend;
  const periodUsed = spentSoFar + periodLeft > 0 ? spentSoFar / (spentSoFar + periodLeft) : 0;

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
      <View style={styles.headerRow}>
        <View style={styles.flex}>
          <ScreenTitle
            title="Today"
            subtitle={`${formatDayMonth(snapshot.periodStart)} – ${formatDayMonth(
              lastDay(snapshot.periodEnd)
            )} · ${snapshot.daysRemaining} days left`}
          />
        </View>
        <Pressable
          style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
          onPress={() => navigation.navigate('Settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={12}
        >
          <Icon name="settings" size={20} color={palette.textSecondary} />
        </Pressable>
      </View>

      {snapshot.budget.spendablePool < 0 ? (
        <Card style={styles.troubleBanner}>
          <View style={styles.troubleHead}>
            <Icon name="warning" size={16} color={palette.warning} />
            <Text style={styles.troubleTitle}>Your numbers look wrong</Text>
          </View>
          <Text style={styles.troubleBody}>
            {formatMoney(-snapshot.budget.spendablePool)} past your{' '}
            {formatMoney(snapshot.budget.allowance)} allowance. Usually a message was counted that
            wasn't a real payment.
          </Text>
          <View style={styles.troubleActions}>
            <Button
              label="See what was counted"
              variant="secondary"
              size="small"
              onPress={() => navigation.navigate('Transactions')}
              style={styles.flex}
            />
            <Button
              label="Start fresh"
              variant="secondary"
              size="small"
              onPress={() => setFreshVisible(true)}
              style={styles.flex}
            />
          </View>
        </Card>
      ) : null}

      {/* The number. Everything else on this screen explains it — so it comes
          first, on the page itself rather than in a box, with room around it.
          The one warning that changes what it means (over today, or running
          out before the period ends) sits right under it, not at the bottom
          of the screen. */}
      <FadeSlideIn>
        <Pressable
          onPress={() => setBreakdownVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={`Safe to spend today, ${formatMoney(Math.max(0, snapshot.today.remainingToday))}. How this is worked out`}
          style={({ pressed }) => [styles.hero, pressed && styles.heroPressed]}
        >
          <Text style={[styles.heroLabel, { color: accent }]}>Safe to spend today</Text>
          <AnimatedMoney
            amount={Math.max(0, snapshot.today.remainingToday)}
            style={[styles.heroAmount, { color: accent }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          />
          {week.length === 7 ? (
            <WeekStrip days={week} limit={snapshot.today.dailyLimit} />
          ) : (
            <View style={styles.heroBar}>
              <ProgressBar fraction={snapshot.today.usedFraction} color={accent} height={4} />
            </View>
          )}
          <View style={styles.heroMetaRow}>
            <Text style={styles.heroSub}>
              {formatMoney(snapshot.today.spentToday)} of {formatMoney(snapshot.today.dailyLimit)}{' '}
              used
            </Text>
            <View style={styles.heroExplainRow}>
              <Text style={styles.heroExplain}>How</Text>
              <Icon name="chevronRight" size={14} color={palette.textSecondary} />
            </View>
          </View>
          {snapshot.today.state === 'OVER' ? (
            <Note tone={palette.danger} icon="warning">
              {formatMoney(-snapshot.today.remainingToday)} over today. Tomorrow starts fresh.
            </Note>
          ) : runsOutEarly ? (
            <Note tone={palette.warning} icon="clock">
              At this pace, money lasts {brokeIn} {brokeIn === 1 ? 'day' : 'days'}, not{' '}
              {snapshot.daysRemaining}.
            </Note>
          ) : snapshot.streakDays > 1 ? (
            <Note tone={palette.warning} icon="streak">
              {snapshot.streakDays} days under budget in a row
            </Note>
          ) : null}
        </Pressable>
      </FadeSlideIn>

      <FadeSlideIn delay={35} style={styles.actionRow}>
        <Button
          label="Add expense"
          icon="add"
          onPress={() => {
            setAddThenSplit(false);
            setAddVisible(true);
          }}
          style={styles.flex}
        />
        <Button
          label="Split a bill"
          icon="split"
          variant="tonal"
          onPress={() => {
            setAddThenSplit(true);
            setAddVisible(true);
          }}
          style={styles.flex}
        />
      </FadeSlideIn>

      {snapshot.pendingCaptures > 0 ? (
        <FadeSlideIn delay={60}>
          <Pressable
            style={({ pressed }) => [styles.reviewRow, pressed && styles.pressed]}
            onPress={() => navigation.navigate('Review')}
            accessibilityRole="button"
            accessibilityLabel={`${snapshot.pendingCaptures} messages to review`}
          >
            <View style={styles.reviewBadge}>
              <Text style={styles.reviewCount}>{snapshot.pendingCaptures}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.reviewTitle}>
                {snapshot.pendingCaptures === 1 ? 'Payment' : 'Payments'} to check
              </Text>
              <Text style={styles.reviewSub}>Pinch wasn't sure — one tap each</Text>
            </View>
            <Icon name="chevronRight" size={18} color={palette.textSecondary} />
          </Pressable>
        </FadeSlideIn>
      ) : null}

      {/* The rest of the money picture, as rows of one list rather than a
          card each: the period's budget, the bank, and the question people
          open a budget app with. */}
      <FadeSlideIn delay={90}>
        <Group title="This period">
          <Pressable
            key="available"
            style={({ pressed }) => [styles.moneyRow, pressed && styles.pressed]}
            onPress={() => setBreakdownVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={`Left this period, ${formatMoney(periodLeft)}`}
          >
            <View style={styles.moneyHead}>
              <View style={styles.flex}>
                <Text style={styles.moneyTitle}>Left this period</Text>
                <Text style={styles.moneyMeta} numberOfLines={1}>
                  {snapshot.protectedMoney > 0.009
                    ? `${formatMoney(snapshot.protectedMoney)} set aside for goals & outings`
                    : `of ${formatMoney(snapshot.availableBudget)}`}
                </Text>
              </View>
              <Text style={styles.moneyValue}>{formatMoney(periodLeft)}</Text>
            </View>
            <ProgressBar fraction={periodUsed} color={palette.textSecondary} height={4} />
          </Pressable>

          {balance ? <BalanceCard key="bank" state={balance} onChanged={load} /> : null}

          {showDiscrepancy && snapshot.balanceConsistency ? (
            <Pressable
              key="gap"
              style={({ pressed }) => [styles.gapRow, pressed && styles.pressed]}
              onPress={() => setReconcileVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Account for the missing money"
            >
              <Icon name="info" size={16} color={palette.warning} />
              <Text style={styles.gapText}>
                {snapshot.balanceConsistency.discrepancy > 0
                  ? `Bank shows ${formatMoney(snapshot.balanceConsistency.discrepancy)} more than Pinch`
                  : `Bank shows ${formatMoney(-snapshot.balanceConsistency.discrepancy)} less — a payment may be missing`}
              </Text>
              <Text style={styles.gapAction}>Fix</Text>
            </Pressable>
          ) : null}

          <Pressable
            key="afford"
            style={({ pressed }) => [styles.affordRow, pressed && styles.pressed]}
            onPress={() => setAffordVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Can I afford it?"
          >
            <Text style={styles.moneyTitle}>Can I afford it?</Text>
            <Icon name="chevronRight" size={18} color={palette.textSecondary} />
          </Pressable>
        </Group>
      </FadeSlideIn>

      <FadeSlideIn delay={140}>
        <Group
          title="Today's spending"
          action="See all"
          onAction={() => navigation.navigate('Transactions')}
        >
          {today.length === 0 ? (
            <EmptyState
              icon="empty"
              title="Nothing yet today"
              body="Payments show up here on their own."
            />
          ) : (
            today.map((tx) => {
              const owed = owedByTx.get(tx.id);
              // Only spending can be owed back, and only once. The prompt is
              // kept for amounts big enough to plausibly have been for more
              // than one person — nobody splits a ₹40 chai.
              const canReimburse =
                tx.kind === 'SPEND' && owed === undefined && tx.amount >= REIMBURSE_PROMPT_MIN;

              return (
                <Row
                  key={tx.id}
                  left={<CategoryCover category={tx.category} />}
                  title={tx.merchant}
                  subtitle={`${tx.category ?? 'Uncategorised'} · ${formatTime(tx.occurred_at)}`}
                  onPress={() => setDetailFor(tx)}
                  right={
                    <View style={styles.txRight}>
                      <Text
                        style={[
                          styles.txAmount,
                          tx.direction === 'CREDIT' && { color: palette.accent },
                        ]}
                      >
                        {tx.direction === 'CREDIT' ? '+' : '−'}
                        {formatMoney(tx.amount)}
                      </Text>
                      {owed !== undefined ? (
                        <Text style={styles.txOwed}>{formatMoney(owed)} back</Text>
                      ) : canReimburse ? (
                        <Pressable
                          onPress={() => setReimburseFor(tx)}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Say who ${tx.merchant} was for`}
                        >
                          <Text style={styles.txReimburse}>For someone?</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  }
                />
              );
            })
          )}
        </Group>
      </FadeSlideIn>

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDayMonth(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

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

/** periodEnd is exclusive (midnight after the last day); name the last day itself. */
function lastDay(iso: string): string {
  return new Date(new Date(iso).getTime() - 1).toISOString();
}

/** One line under the hero that changes what the number means. */
function Note({
  tone,
  icon,
  children,
}: {
  tone: string;
  icon: IconName;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.note}>
      <Icon name={icon} size={14} color={tone} />
      <Text style={[styles.noteText, { color: tone }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  gear: {
    marginTop: 2,
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
  },
  pressed: { opacity: 0.6 },
  flex: { flex: 1 },

  // No container: the figure sits on the page, left-aligned like the title
  // above it, and wins by size and space alone.
  hero: { paddingTop: spacing.sm, paddingBottom: spacing.xs, borderRadius: radii.card },
  heroPressed: { opacity: 0.72 },
  heroLabel: { ...typography.heroLabel },
  heroAmount: { ...typography.hero, fontSize: 56, lineHeight: 62, letterSpacing: -2, marginTop: 2 },
  heroBar: { width: '100%', marginTop: spacing.md },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  heroSub: { ...typography.caption, color: palette.textSecondary },
  heroExplainRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  heroExplain: { ...typography.caption, fontWeight: '600', color: palette.textSecondary },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  noteText: { ...typography.caption, fontWeight: '600', flex: 1 },

  actionRow: { flexDirection: 'row', gap: spacing.sm },

  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radii.card,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
  },
  reviewBadge: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 6,
    borderRadius: radii.pill,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewCount: { ...typography.bodyBold, fontSize: 14, color: palette.onAccent },
  reviewTitle: { ...typography.bodyBold, color: palette.textPrimary },
  reviewSub: { ...typography.caption, color: palette.textSecondary },

  moneyRow: { paddingVertical: 14, gap: spacing.sm },
  moneyHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  moneyTitle: { ...typography.bodyBold, color: palette.textPrimary },
  moneyMeta: { ...typography.caption, color: palette.textSecondary, marginTop: 2 },
  moneyValue: { ...typography.cardTitle, color: palette.textPrimary },
  gapRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 14 },
  gapText: { ...typography.caption, color: palette.warning, flex: 1 },
  gapAction: { ...typography.caption, fontWeight: '700', color: palette.textPrimary },
  affordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },

  txRight: { alignItems: 'flex-end', gap: 1 },
  txAmount: { ...typography.bodyBold, color: palette.textPrimary },
  txOwed: { ...typography.caption, color: palette.accent },
  txReimburse: { ...typography.caption, color: palette.textMuted },

  // Amber stays: this is a status, and the colour is the fastest read on
  // the card. It is the container that becomes tonal, not the meaning.
  troubleBanner: {
    backgroundColor: layer(palette.warning, 0.12),
    gap: spacing.sm,
  },
  troubleHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  troubleTitle: { ...typography.cardTitle, color: palette.warning },
  troubleBody: { ...typography.body, color: palette.textSecondary, lineHeight: 20 },
  troubleActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
});
