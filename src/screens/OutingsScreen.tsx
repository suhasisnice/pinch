import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as db from '../db/dbService';
import { OutingSummary } from '../db/repos/outings';
import { IOUDetail, TransactionRow } from '../db/types';
import { formatMoney, formatRelative } from '../utils/format';
import { getBudgetSnapshot } from '../services/budgetService';
import { getMonthlyAllowance } from '../settings/settingsStore';
import { OutingAffordability, outingAffordability } from '../math/budget';
import { categoryColor, layer, palette, radii, spacing, typography } from '../theme/theme';
import { Button, Card, CardTitle, Chip, Dot, EmptyState, Field, Loading, ProgressBar, Row, Screen, ScreenTitle, Sheet } from '../components/ui';
import AddExpenseSheet from '../components/AddExpenseSheet';
import SplitModal from '../components/SplitModal';
import Icon, { OUTING_ICONS } from '../components/Icon';
import LabelIcon, { LabelIconBadge } from '../components/LabelIcon';

function affordabilityLabel(state: OutingAffordability): string {
  switch (state) {
    case 'COMFORTABLE':
      return "Comfortable — this won't change your daily number much.";
    case 'TIGHT':
      return 'Tight — this cuts your daily number by more than half.';
    case 'DISRUPTIVE':
      return "Disruptive — you don't have this much available right now.";
  }
}

function affordabilityStyle(state: OutingAffordability) {
  switch (state) {
    case 'COMFORTABLE':
      return { color: palette.accent };
    case 'TIGHT':
      return { color: palette.warning };
    case 'DISRUPTIVE':
      return { color: palette.danger };
  }
}

export default function OutingsScreen() {
  const [outings, setOutings] = useState<OutingSummary[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [detailFor, setDetailFor] = useState<OutingSummary | null>(null);

  const load = useCallback(async () => {
    setOutings(await db.getOutings(true));
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

  if (!outings) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const active = outings.filter((o) => o.closedAt === null);
  const past = outings.filter((o) => o.closedAt !== null);

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.textSecondary} />}>
      <ScreenTitle title="Outings" subtitle="Group spending, kept together" />

      <Button label="Start an outing" onPress={() => setCreateVisible(true)} />

      {outings.length === 0 ? (
        <Card>
          <EmptyState
            icon="outings"
            title="No outings yet"
            body="Start one before you head out and everything you spend gets tagged to it automatically — then settle up with everyone in one go."
          />
        </Card>
      ) : null}

      {active.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Happening now</Text>
          {active.map((outing) => (
            <OutingCard key={outing.id} outing={outing} onPress={() => setDetailFor(outing)} />
          ))}
        </>
      ) : null}

      {past.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Past</Text>
          {past.map((outing) => (
            <OutingCard key={outing.id} outing={outing} onPress={() => setDetailFor(outing)} />
          ))}
        </>
      ) : null}

      <CreateOutingSheet
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onSaved={() => {
          setCreateVisible(false);
          load();
        }}
      />

      <OutingDetailSheet
        outing={detailFor}
        onClose={() => setDetailFor(null)}
        onChanged={load}
        onDismissed={() => {
          setDetailFor(null);
          load();
        }}
      />
    </Screen>
  );
}

function OutingCard({ outing, onPress }: { outing: OutingSummary; onPress: () => void }) {
  const overBudget = outing.isOverBudget;
  return (
    <Card onPress={onPress}>
      <View style={styles.outingHead}>
        <LabelIconBadge label={outing.emoji} color={palette.info} />
        <View style={styles.outingHeadText}>
          <Text style={styles.outingName}>{outing.name}</Text>
          <Text style={styles.outingMeta}>
            {outing.transactionCount} item{outing.transactionCount === 1 ? '' : 's'} ·{' '}
            {outing.headcount} {outing.headcount === 1 ? 'person' : 'people'} ·{' '}
            {formatRelative(outing.startsAt)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.outingTotal}>{formatMoney(outing.totalSpent)}</Text>
          <Text style={styles.outingShare}>you: {formatMoney(outing.yourShare)}</Text>
        </View>
      </View>

      {outing.budgetAmount ? (
        <>
          <ProgressBar
            fraction={outing.budgetFraction ?? 0}
            color={overBudget ? palette.danger : (outing.budgetFraction ?? 0) > 0.8 ? palette.warning : palette.info}
          />
          <Text style={[styles.outingBudget, overBudget && { color: palette.danger }]}>
            {overBudget
              ? `${formatMoney(outing.totalSpent - outing.budgetAmount)} over the ${formatMoney(outing.budgetAmount)} cap`
              : `${formatMoney(outing.budgetAmount - outing.totalSpent)} left of ${formatMoney(outing.budgetAmount)}`}
          </Text>
        </>
      ) : null}
    </Card>
  );
}

function CreateOutingSheet({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [icon, setIcon] = useState<string>('party');
  const [saving, setSaving] = useState(false);
  const [affordability, setAffordability] = useState<OutingAffordability | null>(null);

  const parsedBudget = Number(budget.replace(/[^\d.]/g, ''));
  const canSave = name.trim().length > 0;

  useEffect(() => {
    if (!visible || !Number.isFinite(parsedBudget) || parsedBudget <= 0) {
      setAffordability(null);
      return;
    }
    let cancelled = false;
    getMonthlyAllowance()
      .then(getBudgetSnapshot)
      .then((snapshot) => {
        if (!cancelled) {
          setAffordability(
            outingAffordability(parsedBudget, snapshot.availableBudget, snapshot.daysRemaining)
          );
        }
      })
      .catch(() => setAffordability(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, budget]);

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await db.createOuting({
        name: name.trim(),
        emoji: icon,
        budgetAmount: Number.isFinite(parsedBudget) && parsedBudget > 0 ? parsedBudget : null,
      });
      setName('');
      setBudget('');
      setIcon('party');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Start an outing">
      <View style={styles.iconRow}>
        {OUTING_ICONS.map((choice) => (
          <Pressable
            key={choice}
            onPress={() => setIcon(choice)}
            style={({ pressed }) => [
              styles.iconChoice,
              icon === choice && styles.iconChoiceOn,
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={choice}
            accessibilityState={{ selected: icon === choice }}
          >
            <Icon
              name={choice}
              size={20}
              color={icon === choice ? palette.info : palette.textMuted}
            />
          </Pressable>
        ))}
      </View>
      <Field label="What is it" value={name} onChangeText={setName} placeholder="Movie night" />
      <Field
        label="Cap (optional)"
        value={budget}
        onChangeText={setBudget}
        keyboardType="numeric"
        placeholder="500"
        hint="You'll get a nudge as you approach it."
      />
      {affordability ? (
        <Text style={[styles.affordability, affordabilityStyle(affordability)]}>
          {affordabilityLabel(affordability)}
        </Text>
      ) : null}
      <Text style={styles.note}>
        While this is open, anything you spend is tagged to it automatically.
      </Text>
      <Button label={saving ? 'Starting…' : 'Start'} onPress={save} disabled={!canSave || saving} />
    </Sheet>
  );
}

function OutingDetailSheet({
  outing,
  onClose,
  onChanged,
  onDismissed,
}: {
  outing: OutingSummary | null;
  onClose: () => void;
  onChanged: () => void;
  onDismissed: () => void;
}) {
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [candidates, setCandidates] = useState<TransactionRow[]>([]);
  const [ious, setIous] = useState<IOUDetail[]>([]);
  const [addVisible, setAddVisible] = useState(false);
  const [splitFor, setSplitFor] = useState<TransactionRow | null>(null);
  // Tracked separately from `outing.reservedAmount`: the sheet stays open
  // across a reserve/release action, but `outing` is the OutingSummary the
  // list handed it when it was tapped and does not itself get refetched —
  // only this screen's own list does, on a different render pass.
  const [reserved, setReserved] = useState(0);
  const [reserveAmount, setReserveAmount] = useState('');
  const [reserving, setReserving] = useState(false);

  const refresh = useCallback(async () => {
    if (!outing) return;
    const [tx, cand, iouRows, reservedTotal] = await Promise.all([
      db.getOutingTransactions(outing.id),
      db.getCandidateTransactions(outing.id),
      db.getIOUsForOuting(outing.id),
      db.getOutingReserved(outing.id),
    ]);
    setTransactions(tx);
    setCandidates(cand);
    setIous(iouRows);
    setReserved(reservedTotal);
  }, [outing]);

  React.useEffect(() => {
    refresh();
    setReserveAmount('');
  }, [refresh]);

  if (!outing) return null;

  const owedBack = ious
    .filter((iou) => iou.direction === 'THEY_OWE_ME')
    .reduce((sum, iou) => sum + iou.openAmount, 0);

  const parsedReserve = Number(reserveAmount.replace(/[^\d.]/g, ''));
  const canReserve = Number.isFinite(parsedReserve) && parsedReserve > 0;
  const stillNeeded = outing.budgetAmount !== null ? Math.max(0, outing.budgetAmount - reserved) : null;

  async function adjustReserve(sign: 1 | -1) {
    if (!canReserve || reserving) return;
    setReserving(true);
    try {
      if (sign === 1) {
        await db.reserveForOuting(outing!.id, parsedReserve);
      } else {
        await db.releaseOutingReserve(outing!.id, Math.min(parsedReserve, reserved));
      }
      setReserveAmount('');
      await refresh();
      onChanged();
    } finally {
      setReserving(false);
    }
  }

  return (
    <Sheet visible={outing !== null} onClose={onClose} title={outing.name}>
      {/* Planned, reserved and spent are kept as three separate numbers —
          PRODUCT_SPEC's "Reserved vs spent" note explicitly warns against
          collapsing them into one. */}
      <View style={styles.detailTotals}>
        {outing.budgetAmount !== null ? (
          <View style={styles.detailStat}>
            <Text style={styles.detailStatLabel}>Planned</Text>
            <Text style={styles.detailStatValue}>{formatMoney(outing.budgetAmount)}</Text>
          </View>
        ) : null}
        <View style={styles.detailStat}>
          <Text style={styles.detailStatLabel}>Reserved</Text>
          <Text style={[styles.detailStatValue, { color: palette.info }]}>{formatMoney(reserved)}</Text>
        </View>
        <View style={styles.detailStat}>
          <Text style={styles.detailStatLabel}>Spent</Text>
          <Text style={styles.detailStatValue}>{formatMoney(outing.totalSpent)}</Text>
        </View>
      </View>

      <View style={styles.detailTotals}>
        <View style={styles.detailStat}>
          <Text style={styles.detailStatLabel}>Your share</Text>
          <Text style={[styles.detailStatValue, { color: palette.accent }]}>
            {formatMoney(outing.yourShare)}
          </Text>
        </View>
        <View style={styles.detailStat}>
          <Text style={styles.detailStatLabel}>Owed back</Text>
          <Text style={[styles.detailStatValue, { color: palette.accent }]}>{formatMoney(owedBack)}</Text>
        </View>
        {stillNeeded !== null ? (
          <View style={styles.detailStat}>
            <Text style={styles.detailStatLabel}>Still needed</Text>
            <Text style={[styles.detailStatValue, stillNeeded > 0 && { color: palette.warning }]}>
              {formatMoney(stillNeeded)}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Reserving here never writes a Transaction — see reserveForOuting.
          The money isn't moving; it's being marked as spoken for, the same
          way a goal contribution is. */}
      <View style={styles.reserveRow}>
        <Field
          label="Reserve or release"
          value={reserveAmount}
          onChangeText={setReserveAmount}
          keyboardType="numeric"
          placeholder="0"
        />
        <View style={styles.reserveButtons}>
          <Button
            label="Reserve"
            variant="secondary"
            onPress={() => adjustReserve(1)}
            disabled={!canReserve || reserving}
            style={styles.flex}
          />
          <Button
            label="Release"
            variant="ghost"
            onPress={() => adjustReserve(-1)}
            disabled={!canReserve || reserving || reserved <= 0}
            style={styles.flex}
          />
        </View>
      </View>

      <Button label="Add an expense" variant="secondary" onPress={() => setAddVisible(true)} />

      {candidates.length > 0 ? (
        <Card style={{ backgroundColor: layer(palette.info, 0.12) }}>
          <CardTitle>Spent during this outing</CardTitle>
          {candidates.map((tx) => (
            <Row
              key={tx.id}
              title={tx.merchant}
              subtitle={formatRelative(tx.occurred_at)}
              right={
                <Chip
                  label="Add"
                  color={palette.info}
                  onPress={async () => {
                    await db.setTransactionOuting(tx.id, outing.id);
                    await refresh();
                    onChanged();
                  }}
                />
              }
            />
          ))}
        </Card>
      ) : null}

      {transactions.length > 0 ? (
        <View>
          <Text style={styles.groupLabel}>Items</Text>
          {transactions.map((tx) => {
            const alreadySplit = ious.some((iou) => iou.transactionId === tx.id);
            return (
              <Row
                key={tx.id}
                left={<Dot color={categoryColor(tx.category)} />}
                title={tx.merchant}
                subtitle={formatRelative(tx.occurred_at)}
                right={
                  <View style={styles.itemRight}>
                    <Text style={styles.itemAmount}>{formatMoney(tx.amount)}</Text>
                    <Chip
                      label={alreadySplit ? 'Split again' : 'Split'}
                      color={palette.info}
                      onPress={() => setSplitFor(tx)}
                    />
                  </View>
                }
              />
            );
          })}
        </View>
      ) : null}

      {ious.length > 0 ? (
        <View>
          <Text style={styles.groupLabel}>Who owes what</Text>
          {ious.map((iou) => (
            <Row
              key={iou.id}
              title={iou.contactName}
              subtitle={iou.openAmount <= 0.009 ? 'settled' : 'still open'}
              right={
                <Text
                  style={[
                    styles.itemAmount,
                    { color: iou.openAmount <= 0.009 ? palette.textMuted : palette.accent },
                  ]}
                >
                  {formatMoney(iou.amount)}
                </Text>
              }
            />
          ))}
        </View>
      ) : null}

      {outing.closedAt === null ? (
        <Button
          label="Close outing"
          variant="secondary"
          onPress={() => {
            // Closing already stops the reserve counting toward protected
            // money (getTotalOutingReserved only sums open outings) — no
            // separate release action needed, just telling the user it
            // happened rather than leaving them to notice their available
            // budget changed for an unstated reason.
            const confirm = () => db.closeOuting(outing!.id).then(onDismissed);
            if (reserved > 0.009) {
              Alert.alert(
                'Close this outing?',
                `${formatMoney(reserved)} still reserved for it returns to your available budget.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Close', onPress: confirm },
                ]
              );
            } else {
              confirm();
            }
          }}
        />
      ) : (
        <Button
          label="Reopen"
          variant="ghost"
          onPress={async () => {
            await db.reopenOuting(outing.id);
            onDismissed();
          }}
        />
      )}

      <Button
        label="Delete outing"
        variant="danger"
        onPress={() => {
          Alert.alert(
            'Delete this outing?',
            `"${outing.name}" will be removed. The ${outing.transactionCount} item${
              outing.transactionCount === 1 ? '' : 's'
            } and any debts stay in your ledger — they just stop being grouped under it.${
              reserved > 0.009 ? ` ${formatMoney(reserved)} reserved for it returns to your available budget.` : ''
            }`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await db.deleteOuting(outing.id);
                    onDismissed();
                  } catch (error) {
                    Alert.alert(
                      'Could not delete',
                      error instanceof Error ? error.message : 'Something went wrong.'
                    );
                  }
                },
              },
            ]
          );
        }}
      />
      <Text style={styles.note}>
        Deleting an outing never deletes the spending inside it.
      </Text>

      <AddExpenseSheet
        visible={addVisible}
        defaultOutingId={outing.id}
        onClose={() => setAddVisible(false)}
        onSaved={async () => {
          setAddVisible(false);
          await refresh();
          onChanged();
        }}
      />

      <SplitModal
        visible={splitFor !== null}
        transaction={splitFor}
        outingId={outing.id}
        onClose={() => setSplitFor(null)}
        onSplit={async () => {
          setSplitFor(null);
          await refresh();
          onChanged();
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    ...typography.micro,
    color: palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.xs,
  },

  outingHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },

  outingHeadText: { flex: 1 },
  outingName: { ...typography.cardTitle, color: palette.textPrimary },
  outingMeta: { ...typography.caption, color: palette.textSecondary, marginTop: 2 },
  outingTotal: { ...typography.bodyBold, fontSize: 17, color: palette.textPrimary },
  outingShare: { ...typography.micro, color: palette.textSecondary, marginTop: 2 },
  outingBudget: { ...typography.caption, color: palette.textSecondary, marginTop: spacing.sm },

  iconRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  iconChoice: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
  },
  iconChoiceOn: { borderColor: palette.info, backgroundColor: layer(palette.info, 0.14) },
  note: { ...typography.caption, color: palette.textMuted, lineHeight: 17 },
  affordability: { ...typography.caption, lineHeight: 17 },

  detailTotals: { flexDirection: 'row', gap: spacing.sm },
  detailStat: { flex: 1, alignItems: 'center', gap: 2 },
  detailStatLabel: { ...typography.micro, color: palette.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  detailStatValue: { ...typography.bodyBold, fontSize: 17, color: palette.textPrimary },

  reserveRow: { gap: spacing.sm },
  reserveButtons: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },

  groupLabel: {
    ...typography.micro,
    color: palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  itemRight: { alignItems: 'flex-end', gap: 4 },
  itemAmount: { ...typography.bodyBold, color: palette.textPrimary },
});
