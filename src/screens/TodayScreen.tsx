import React, { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as db from '../db/dbService';
import { BudgetSnapshot, getBudgetSnapshot } from '../services/budgetService';
import { ingestPending } from '../services/captureService';
import { getMonthlyAllowance } from '../settings/settingsStore';
import { canIAfford, daysUntilBroke } from '../math/budget';
import { TransactionRow } from '../db/types';
import { formatMoney, formatRelative } from '../utils/format';
import { accentForState, categoryColor, palette, radii, spacing, typography } from '../theme/theme';
import { Button, Card, CardTitle, Dot, EmptyState, Field, Loading, ProgressBar, Row, Screen, ScreenTitle } from '../components/ui';
import AddExpenseSheet from '../components/AddExpenseSheet';
import SplitModal from '../components/SplitModal';
import TransactionDetailSheet from '../components/TransactionDetailSheet';
import FreshStartSheet from '../components/FreshStartSheet';
import Icon from '../components/Icon';

export default function TodayScreen() {
  const navigation = useNavigation<any>();
  const [snapshot, setSnapshot] = useState<BudgetSnapshot | null>(null);
  const [today, setToday] = useState<TransactionRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [addVisible, setAddVisible] = useState(false);
  const [splitFor, setSplitFor] = useState<TransactionRow | null>(null);
  const [detailFor, setDetailFor] = useState<TransactionRow | null>(null);
  const [freshVisible, setFreshVisible] = useState(false);
  const [testAmount, setTestAmount] = useState('');

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
    setToday(await db.getTransactionsBetween(start.toISOString(), end.toISOString()));
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
            subtitle={`${snapshot.daysRemaining} days left · ${formatMoney(snapshot.budget.spendablePool)} to go`}
          />
        </View>
        <Text style={styles.gear} onPress={() => navigation.navigate('Settings')} suppressHighlighting>
          <Icon name="settings" size={22} color={palette.textSecondary} />
        </Text>
      </View>

      {snapshot.budget.spendablePool < 0 ? (
        <Card style={styles.troubleBanner}>
          <View style={styles.troubleHead}>
            <Icon name="warning" size={16} color={palette.warningAmber} />
            <Text style={styles.troubleTitle}>Your numbers look wrong</Text>
          </View>
          <Text style={styles.troubleBody}>
            You are {formatMoney(-snapshot.budget.spendablePool)} past an allowance of{' '}
            {formatMoney(snapshot.budget.allowance)}. That usually means imported messages were
            counted as spending when they were not real transactions.
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

      {snapshot.pendingCaptures > 0 ? (
        <Card style={styles.reviewBanner} onPress={() => navigation.navigate('Review')}>
          <Text style={styles.reviewText}>
            {snapshot.pendingCaptures} message{snapshot.pendingCaptures === 1 ? '' : 's'} to review
          </Text>
          <Text style={styles.reviewChevron}>›</Text>
        </Card>
      ) : null}

      {/* The number. Everything else on this screen explains it. */}
      <Card style={styles.hero}>
        <Text style={[styles.heroLabel, { color: accent }]}>Safe to spend today</Text>
        <Text style={[styles.heroAmount, { color: accent }]} numberOfLines={1} adjustsFontSizeToFit>
          {formatMoney(Math.max(0, snapshot.today.remainingToday))}
        </Text>
        <Text style={styles.heroSub}>
          of {formatMoney(snapshot.today.dailyLimit)} · {formatMoney(snapshot.today.spentToday)} spent
        </Text>
        <View style={styles.heroBar}>
          <ProgressBar fraction={snapshot.today.usedFraction} color={accent} height={10} />
        </View>
        {snapshot.today.state === 'OVER' ? (
          <Text style={[styles.heroNote, { color: palette.danger }]}>
            {formatMoney(-snapshot.today.remainingToday)} over. tomorrow resets.
          </Text>
        ) : snapshot.streakDays > 0 ? (
          <View style={styles.streakRow}>
            <Icon name="streak" size={14} color={palette.warningAmber} />
            <Text style={styles.heroNote}>{snapshot.streakDays}-day streak under budget</Text>
          </View>
        ) : null}
      </Card>

      {/* The question people actually have. */}
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
                ? ` About ${verdict.daysOfTypicalSpending.toFixed(1)} days of your normal spending.`
                : ''}
            </Text>
          </View>
        ) : null}
      </Card>

      <View style={styles.actionRow}>
        <Button label="Add expense" onPress={() => setAddVisible(true)} style={styles.flex} />
        <Button
          label="Split a bill"
          variant="secondary"
          onPress={() => navigation.navigate('Squad')}
          style={styles.flex}
        />
      </View>

      <Card>
        <CardTitle
          right={
            <Text style={styles.link} onPress={() => navigation.navigate('Transactions')}>
              See all
            </Text>
          }
        >
          Today's spending
        </CardTitle>
        {today.length === 0 ? (
          <EmptyState
            icon="empty"
            title="Nothing yet today"
            body="Captured payments land here automatically, or add one by hand."
          />
        ) : (
          today.map((tx) => (
            <Row
              key={tx.id}
              left={<Dot color={categoryColor(tx.category)} />}
              title={tx.merchant}
              subtitle={`${tx.category ?? 'Uncategorised'} · ${formatRelative(tx.occurred_at)}`}
              onPress={() => setDetailFor(tx)}
              right={
                <Text style={[styles.txAmount, tx.direction === 'CREDIT' && { color: palette.mint }]}>
                  {tx.direction === 'CREDIT' ? '+' : '−'}
                  {formatMoney(tx.amount)}
                </Text>
              }
            />
          ))
        )}
      </Card>

      {brokeIn !== null && brokeIn < snapshot.daysRemaining ? (
        <Card style={{ borderColor: palette.warningAmber }}>
          <Text style={styles.projection}>
            At your current pace you run out in{' '}
            <Text style={{ color: palette.warningAmber, fontWeight: '800' }}>{brokeIn} days</Text>, with{' '}
            {snapshot.daysRemaining} left in the period.
          </Text>
        </Card>
      ) : null}

      <AddExpenseSheet
        visible={addVisible}
        onClose={() => setAddVisible(false)}
        onSaved={() => {
          setAddVisible(false);
          load();
        }}
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

function verdictColor(severity: string): string {
  switch (severity) {
    case 'RECKLESS':
      return palette.danger;
    case 'TIGHT':
      return palette.warningAmber;
    case 'FINE':
      return palette.mint;
    default:
      return palette.neonGreen;
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
  gear: { fontSize: 22, paddingTop: 4, paddingLeft: spacing.sm },

  hero: { alignItems: 'center', paddingVertical: spacing.lg, gap: 2 },
  heroLabel: { ...typography.heroLabel },
  heroAmount: { ...typography.hero, marginTop: spacing.xs },
  heroSub: { ...typography.caption, color: palette.textSecondary, marginTop: 2 },
  heroBar: { width: '100%', marginTop: spacing.md },
  heroNote: { ...typography.caption, color: palette.textSecondary },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.sm },

  verdict: { marginTop: spacing.sm, gap: 4 },
  verdictHead: { ...typography.cardTitle },
  verdictBody: { ...typography.body, color: palette.textSecondary, lineHeight: 20 },

  actionRow: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },

  txAmount: { ...typography.bodyBold, color: palette.textPrimary },
  link: { ...typography.caption, color: palette.neonGreen },

  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.surfaceElevated,
    borderColor: palette.violet,
    paddingVertical: 13,
  },
  reviewText: { ...typography.bodyBold, color: palette.violet },
  reviewChevron: { color: palette.violet, fontSize: 22 },

  projection: { ...typography.body, color: palette.textSecondary, lineHeight: 20 },

  troubleBanner: { borderColor: palette.warningAmber, gap: spacing.sm },
  troubleHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  troubleTitle: { ...typography.cardTitle, color: palette.warningAmber },
  troubleBody: { ...typography.body, color: palette.textSecondary, lineHeight: 20 },
  troubleActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
});
