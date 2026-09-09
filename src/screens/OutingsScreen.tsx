import React, { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as db from '../db/dbService';
import { OutingSummary } from '../db/repos/outings';
import { IOUDetail, TransactionRow } from '../db/types';
import { formatMoney, formatRelative } from '../utils/format';
import { categoryColor, palette, radii, spacing, typography } from '../theme/theme';
import { Button, Card, CardTitle, Chip, Dot, EmptyState, Field, Loading, ProgressBar, Row, Screen, ScreenTitle, Sheet } from '../components/ui';
import AddExpenseSheet from '../components/AddExpenseSheet';

const EMOJI_CHOICES = ['🎉', '🏖', '🎬', '🍕', '🎤', '⛰', '🎳', '🏏', '🎂', '🚗'];

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
            emoji="🎉"
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
        <Text style={styles.outingEmoji}>{outing.emoji}</Text>
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
            color={overBudget ? palette.danger : (outing.budgetFraction ?? 0) > 0.8 ? palette.warningAmber : palette.violet}
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
  const [emoji, setEmoji] = useState('🎉');
  const [saving, setSaving] = useState(false);

  const parsedBudget = Number(budget.replace(/[^\d.]/g, ''));
  const canSave = name.trim().length > 0;

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await db.createOuting({
        name: name.trim(),
        emoji,
        budgetAmount: Number.isFinite(parsedBudget) && parsedBudget > 0 ? parsedBudget : null,
      });
      setName('');
      setBudget('');
      setEmoji('🎉');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Start an outing">
      <View style={styles.emojiRow}>
        {EMOJI_CHOICES.map((choice) => (
          <Chip key={choice} label={choice} selected={emoji === choice} onPress={() => setEmoji(choice)} color={palette.violet} />
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

  const refresh = useCallback(async () => {
    if (!outing) return;
    const [tx, cand, iouRows] = await Promise.all([
      db.getOutingTransactions(outing.id),
      db.getCandidateTransactions(outing.id),
      db.getIOUsForOuting(outing.id),
    ]);
    setTransactions(tx);
    setCandidates(cand);
    setIous(iouRows);
  }, [outing]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  if (!outing) return null;

  const owedBack = ious
    .filter((iou) => iou.direction === 'THEY_OWE_ME')
    .reduce((sum, iou) => sum + iou.openAmount, 0);

  return (
    <Sheet visible={outing !== null} onClose={onClose} title={`${outing.emoji} ${outing.name}`}>
      <View style={styles.detailTotals}>
        <View style={styles.detailStat}>
          <Text style={styles.detailStatLabel}>Total</Text>
          <Text style={styles.detailStatValue}>{formatMoney(outing.totalSpent)}</Text>
        </View>
        <View style={styles.detailStat}>
          <Text style={styles.detailStatLabel}>Your share</Text>
          <Text style={[styles.detailStatValue, { color: palette.neonGreen }]}>
            {formatMoney(outing.yourShare)}
          </Text>
        </View>
        <View style={styles.detailStat}>
          <Text style={styles.detailStatLabel}>Owed back</Text>
          <Text style={[styles.detailStatValue, { color: palette.mint }]}>{formatMoney(owedBack)}</Text>
        </View>
      </View>

      <Button label="Add an expense" variant="secondary" onPress={() => setAddVisible(true)} />

      {candidates.length > 0 ? (
        <Card style={{ borderColor: palette.violet }}>
          <CardTitle>Spent during this outing</CardTitle>
          {candidates.map((tx) => (
            <Row
              key={tx.id}
              title={tx.merchant}
              subtitle={formatRelative(tx.occurred_at)}
              right={
                <Chip
                  label="Add"
                  color={palette.violet}
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
          {transactions.map((tx) => (
            <Row
              key={tx.id}
              left={<Dot color={categoryColor(tx.category)} />}
              title={tx.merchant}
              subtitle={formatRelative(tx.occurred_at)}
              right={<Text style={styles.itemAmount}>{formatMoney(tx.amount)}</Text>}
            />
          ))}
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
                    { color: iou.openAmount <= 0.009 ? palette.textMuted : palette.mint },
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
          onPress={async () => {
            await db.closeOuting(outing.id);
            onDismissed();
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
  outingEmoji: { fontSize: 28 },
  outingHeadText: { flex: 1 },
  outingName: { ...typography.cardTitle, color: palette.textPrimary },
  outingMeta: { ...typography.caption, color: palette.textSecondary, marginTop: 2 },
  outingTotal: { ...typography.bodyBold, fontSize: 17, color: palette.textPrimary },
  outingShare: { ...typography.micro, color: palette.textSecondary, marginTop: 2 },
  outingBudget: { ...typography.caption, color: palette.textSecondary, marginTop: spacing.sm },

  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  note: { ...typography.caption, color: palette.textMuted, lineHeight: 17 },

  detailTotals: { flexDirection: 'row', gap: spacing.sm },
  detailStat: { flex: 1, alignItems: 'center', gap: 2 },
  detailStatLabel: { ...typography.micro, color: palette.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  detailStatValue: { ...typography.bodyBold, fontSize: 17, color: palette.textPrimary },

  groupLabel: {
    ...typography.micro,
    color: palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  itemAmount: { ...typography.bodyBold, color: palette.textPrimary },
});
