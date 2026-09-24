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
import { canIAfford, daysUntilBroke, shouldRaiseDiscrepancy } from '../math/budget';
import { TransactionRow } from '../db/types';
import { formatMoney, formatRelative } from '../utils/format';
import { accentForState, categoryColor, layer, palette, radii, spacing, typography } from '../theme/theme';
import { Group,
  Button,
  Card,
  CardTitle,
  Dot,
  EmptyState,
  Field,
  Loading,
  ProgressBar,
  Row,
  Screen,
  ScreenTitle,
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
import { AnimatedMoney, FadeSlideIn } from '../components/motion';
import Icon from '../components/Icon';

export default function TodayScreen() {
  const navigation = useNavigation<any>();
  const [snapshot, setSnapshot] = useState<BudgetSnapshot | null>(null);
  const [today, setToday] = useState<TransactionRow[]>([]);
  const [balance, setBalance] = useState<Awaited<ReturnType<typeof db.getBalanceState>> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [addVisible, setAddVisible] = useState(false);
  const [addThenSplit, setAddThenSplit] = useState(false);
  const [splitFor, setSplitFor] = useState<TransactionRow | null>(null);
  const [detailFor, setDetailFor] = useState<TransactionRow | null>(null);
  const [loanFor, setLoanFor] = useState<TransactionRow | null>(null);
  const [freshVisible, setFreshVisible] = useState(false);
  const [breakdownVisible, setBreakdownVisible] = useState(false);
  const [testAmount, setTestAmount] = useState('');
  const [reimburseFor, setReimburseFor] = useState<TransactionRow | null>(null);
  const [owedByTx, setOwedByTx] = useState<Map<number, number>>(new Map());
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
  const parsedTest = Number(testAmount.replace(/[^\d.]/g, ''));
  const verdict =
    Number.isFinite(parsedTest) && parsedTest > 0
      ? canIAfford(parsedTest, snapshot.budget, snapshot.avgDailyBurn || null)
      : null;
  const brokeIn = daysUntilBroke(snapshot.budget.spendablePool, snapshot.avgDailyBurn);

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.textSecondary} />}>
      <View style={styles.headerRow}>
        <View style={styles.flex}>
          <ScreenTitle
            title="Today"
            subtitle={`${formatDayMonth(snapshot.periodStart)} – ${formatDayMonth(
              snapshot.periodEnd
            )} · ${snapshot.daysRemaining} days left`}
          />
        </View>
        <Pressable
          style={styles.gear}
          onPress={() => navigation.navigate("Settings")}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={12}
        >
          <Icon name="settings" size={22} color={palette.textSecondary} />
        </Pressable>
      </View>

      {snapshot.budget.spendablePool < 0 ? (
        <Card style={styles.troubleBanner}>
          <View style={styles.troubleHead}>
            <Icon name="warning" size={16} color={palette.warning} />
            <Text style={styles.troubleTitle}>Your numbers look wrong</Text>
          </View>
          <Text style={styles.troubleBody}>
            {formatMoney(-snapshot.budget.spendablePool)} past your {formatMoney(snapshot.budget.allowance)}{' '}
            allowance. Usually a message was counted that wasn't a real payment.
          </Text>
          <View style={styles.troubleActions}>
            <Button
              label="See what was counted"
              variant="secondary"
              onPress={() => navigation.navigate('Transactions')}
              style={styles.flex}
            />
            <Button
              label="Start fresh"
              onPress={() => setFreshVisible(true)}
              style={styles.flex}
            />
          </View>
        </Card>
      ) : null}

      {/* The number. Everything else on this screen explains it — so it comes
          first, on the page itself rather than in a box like everything else,
          with room around it. */}
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
          <Text style={styles.heroSub}>
            {formatMoney(snapshot.today.spentToday)} spent of {formatMoney(snapshot.today.dailyLimit)}
          </Text>
          <View style={styles.heroBar}>
            <ProgressBar fraction={snapshot.today.usedFraction} color={accent} height={6} />
          </View>
          {snapshot.today.state === 'OVER' ? (
            <Text style={[styles.heroNote, { color: palette.danger }]}>
              {formatMoney(-snapshot.today.remainingToday)} over today. Tomorrow starts fresh.
            </Text>
          ) : snapshot.streakDays > 0 ? (
            <View style={styles.streakRow}>
              <Icon name="streak" size={14} color={palette.warning} />
              <Text style={styles.heroNote}>
                {snapshot.streakDays} {snapshot.streakDays === 1 ? 'day' : 'days'} under budget in a row
              </Text>
            </View>
          ) : null}
          <View style={styles.heroExplainRow}>
            <Text style={styles.heroExplain}>How this is worked out</Text>
            <Icon name="chevronRight" size={14} color={palette.textSecondary} />
          </View>
        </Pressable>
      </FadeSlideIn>

      {snapshot.pendingCaptures > 0 ? (
        <Card style={styles.reviewBanner} onPress={() => navigation.navigate('Review')}>
          <Text style={styles.reviewText}>
            {snapshot.pendingCaptures} message{snapshot.pendingCaptures === 1 ? '' : 's'} to review
          </Text>
          <Icon name="chevronRight" size={18} color={palette.accent} />
        </Card>
      ) : null}

      {balance ? <BalanceCard state={balance} onChanged={load} /> : null}

      {/* Available budget and protected money, named the way the product
          spec's own vocabulary names them — both existed on BudgetSnapshot
          since Phase 1 and were computed but never shown anywhere. */}
      <FadeSlideIn delay={35}>
      <Card onPress={() => setBreakdownVisible(true)}>
        <Text style={styles.availableLabel}>Available budget</Text>
        <Text style={styles.availableAmount}>{formatMoney(snapshot.availableBudget)}</Text>
        {snapshot.protectedMoney > 0.009 ? (
          <Text style={styles.protectedNote}>
            {formatMoney(snapshot.protectedMoney)} protected for goals and outings
          </Text>
        ) : null}
        <View style={styles.periodBar}>
          <ProgressBar
            fraction={snapshot.availableBudget > 0 ? snapshot.budget.grossSpend / snapshot.availableBudget : 0}
            color={palette.info}
            height={6}
          />
        </View>
        {showDiscrepancy && snapshot.balanceConsistency ? (
          <Pressable
            style={styles.consistencyNote}
            onPress={() => setReconcileVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Account for the missing money"
          >
            <Icon name="info" size={13} color={palette.warning} />
            <Text style={styles.consistencyText}>
              {snapshot.balanceConsistency.discrepancy > 0
                ? `Bank shows ${formatMoney(snapshot.balanceConsistency.discrepancy)} more than this. Sort it out`
                : `Bank shows ${formatMoney(-snapshot.balanceConsistency.discrepancy)} less — a payment may be missing`}
            </Text>
          </Pressable>
        ) : null}
      </Card>
      </FadeSlideIn>


      {/* The question people actually have. */}
      <FadeSlideIn delay={70}>
      <Card>
        <CardTitle>Can I afford it?</CardTitle>
        <Field
          label="Amount"
          value={testAmount}
          onChangeText={setTestAmount}
          keyboardType="numeric"
          placeholder="e.g. 800"
        />
        {verdict ? (
          <View style={styles.verdict}>
            <Text style={[styles.verdictHead, { color: verdictColor(verdict.severity) }]}>
              {verdictHeadline(verdict.severity)}
            </Text>
            <Text style={styles.verdictBody}>
              {verdict.affordable
                ? `You'd drop to ${formatMoney(verdict.newDailyLimit)}/day for ${snapshot.daysRemaining} days.`
                : `That's ${formatMoney(Math.abs(verdict.newDailyLimit * snapshot.daysRemaining))} more than you have left.`}
              {verdict.daysOfTypicalSpending
                ? ` ${verdict.daysOfTypicalSpending.toFixed(1)} normal days.`
                : ''}
            </Text>
          </View>
        ) : null}
      </Card>
      </FadeSlideIn>

      <FadeSlideIn delay={140} style={styles.actionRow}>
        <Button
          label="Add expense"
          onPress={() => {
            setAddThenSplit(false);
            setAddVisible(true);
          }}
          style={styles.flex}
        />
        <Button
          label="Split a bill"
          variant="secondary"
          onPress={() => {
            setAddThenSplit(true);
            setAddVisible(true);
          }}
          style={styles.flex}
        />
      </FadeSlideIn>

      <FadeSlideIn delay={210}>
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
            // Only spending can be owed back, and only once — a payment that
            // already has somebody on the hook shows what is coming rather
            // than offering to ask again.
            const canReimburse = tx.kind === 'SPEND' && owed === undefined;

            return (
              <Row
                key={tx.id}
                left={<Dot color={categoryColor(tx.category)} />}
                title={tx.merchant}
                subtitle={`${tx.category ?? 'Uncategorised'} · ${formatRelative(tx.occurred_at)}`}
                onPress={() => setDetailFor(tx)}
                right={
                  <View style={styles.txRight}>
                    <Text
                      style={[styles.txAmount, tx.direction === 'CREDIT' && { color: palette.accent }]}
                    >
                      {tx.direction === 'CREDIT' ? '+' : '−'}
                      {formatMoney(tx.amount)}
                    </Text>
                    {owed !== undefined ? (
                      <Text style={styles.txOwed}>{formatMoney(owed)} back</Text>
                    ) : canReimburse ? (
                      <Text
                        style={styles.txReimburse}
                        onPress={() => setReimburseFor(tx)}
                        accessibilityRole="button"
                        accessibilityLabel={`Say who ${tx.merchant} was for`}
                        suppressHighlighting
                      >
                        for someone?
                      </Text>
                    ) : null}
                  </View>
                }
              />
            );
          })
        )}
      </Group>
      </FadeSlideIn>

      {brokeIn !== null && brokeIn < snapshot.daysRemaining ? (
        <Card style={{ backgroundColor: layer(palette.warning, 0.12) }}>
          <Text style={styles.projection}>
            At this pace, money runs out in{' '}
            <Text style={{ color: palette.warning, fontWeight: '800' }}>{brokeIn} days</Text>, not{' '}
            {snapshot.daysRemaining}.
          </Text>
        </Card>
      ) : null}

      <AddExpenseSheet
        visible={addVisible}
        title={
          adjustmentPrefill ? 'Account for it' : addThenSplit ? 'Split a bill' : 'Add expense'
        }
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

function verdictColor(severity: string): string {
  switch (severity) {
    case 'RECKLESS':
      return palette.danger;
    case 'TIGHT':
      return palette.warning;
    case 'FINE':
      return palette.accent;
    default:
      return palette.accent;
  }
}

function verdictHeadline(severity: string): string {
  switch (severity) {
    case 'RECKLESS':
      return "you can't, actually";
    case 'TIGHT':
      return 'yes, but it stings';
    case 'FINE':
      return "yeah that's fine";
    default:
      return 'go for it';
  }
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  gear: { paddingTop: 4, paddingLeft: spacing.sm },

  // No container: the figure sits on the page, left-aligned like the title
  // above it, and wins by size and space alone.
  hero: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    borderRadius: radii.card,
  },
  heroPressed: { opacity: 0.72 },
  heroLabel: { ...typography.heroLabel },
  heroAmount: { ...typography.hero, fontSize: 48, lineHeight: 54, letterSpacing: -1.5, marginTop: 2 },
  heroSub: { ...typography.body, color: palette.textSecondary, marginTop: 2 },
  heroBar: { width: '100%', marginTop: spacing.md },
  heroNote: { ...typography.caption, color: palette.textSecondary },
  heroExplainRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: spacing.md },
  heroExplain: { ...typography.caption, fontWeight: '600', color: palette.textSecondary },

  availableLabel: {
    ...typography.sectionLabel,
    color: palette.textSecondary,
  },
  availableAmount: { ...typography.heroCompact, color: palette.textPrimary, marginTop: 4 },
  protectedNote: { ...typography.caption, color: palette.textMuted, marginTop: 2 },
  periodBar: { marginTop: spacing.sm },
  consistencyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: spacing.sm,
  },
  consistencyText: { ...typography.caption, color: palette.warning, flex: 1, lineHeight: 17 },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.md },

  verdict: { marginTop: spacing.sm, gap: 4 },
  verdictHead: { ...typography.cardTitle },
  verdictBody: { ...typography.body, color: palette.textSecondary, lineHeight: 20 },

  actionRow: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },

  txRight: { alignItems: 'flex-end', gap: 1 },
  txAmount: { ...typography.bodyBold, color: palette.textPrimary },
  txOwed: { ...typography.micro, color: palette.accent },
  txReimburse: { ...typography.micro, color: palette.textMuted },

  // A tonal container rather than an outlined one: in MD3 the fill is what
  // says "this is a different kind of thing", and a coloured hairline around
  // an otherwise identical card says it much more quietly.
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.accentMuted,
    paddingVertical: 14,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
  },
  reviewText: { ...typography.bodyBold, color: palette.accent },

  projection: { ...typography.body, color: palette.textSecondary, lineHeight: 20 },

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
