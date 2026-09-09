import React, { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as db from '../db/dbService';
import { GoalProgress } from '../db/repos/goals';
import { getRoundUpGoalId, setRoundUpGoalId } from '../settings/settingsStore';
import { goalReserve } from '../math/budget';
import { getBudgetSnapshot } from '../services/budgetService';
import { getMonthlyAllowance } from '../settings/settingsStore';
import { formatMoney } from '../utils/format';
import { palette, radii, spacing, typography } from '../theme/theme';
import { Button, Card, CardTitle, Chip, EmptyState, Field, Loading, ProgressBar, Screen, ScreenTitle, Sheet } from '../components/ui';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EMOJI_CHOICES = ['🎯', '💻', '🏖', '🎧', '📱', '🎸', '🚲', '👟', '🎓', '🎁'];

export default function GoalsScreen() {
  const [goals, setGoals] = useState<GoalProgress[] | null>(null);
  const [daysRemaining, setDaysRemaining] = useState(30);
  const [roundUpGoal, setRoundUpGoal] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [contributeTo, setContributeTo] = useState<GoalProgress | null>(null);

  const load = useCallback(async () => {
    const [nextGoals, roundUp, snapshot] = await Promise.all([
      db.getActiveGoals(),
      getRoundUpGoalId(),
      getMonthlyAllowance().then(getBudgetSnapshot),
    ]);
    setGoals(nextGoals);
    setRoundUpGoal(roundUp);
    setDaysRemaining(snapshot.daysRemaining);
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

  if (!goals) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const totalReserved = goals.reduce(
    (sum, goal) =>
      sum +
      goalReserve({
        targetAmount: goal.targetAmount,
        savedAmount: goal.savedAmount,
        daysUntilDeadline: goal.deadline
          ? Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / MS_PER_DAY)
          : null,
        daysRemainingInPeriod: daysRemaining,
      }),
    0
  );

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.textSecondary} />}>
      <ScreenTitle title="Goals" subtitle="Saving happens first, spending is what's left" />

      {goals.length > 0 ? (
        <Card>
          <Text style={styles.reserveLabel}>Held back from spending this period</Text>
          <Text style={styles.reserveAmount}>{formatMoney(totalReserved)}</Text>
          <Text style={styles.reserveNote}>
            Already subtracted from your daily number — you don't have to remember to save it.
          </Text>
        </Card>
      ) : null}

      <Button label="New goal" onPress={() => setCreateVisible(true)} />

      {goals.length === 0 ? (
        <Card>
          <EmptyState
            emoji="🎯"
            title="No goals yet"
            body="A goal claims part of your allowance up front, so the money is gone before you can spend it. Add one and watch it come out of your daily number."
          />
        </Card>
      ) : (
        goals.map((goal) => (
          <GoalCard
            key={goal.id}
            goal={goal}
            daysRemaining={daysRemaining}
            isRoundUp={roundUpGoal === goal.id}
            onContribute={() => setContributeTo(goal)}
            onToggleRoundUp={async () => {
              const next = roundUpGoal === goal.id ? null : goal.id;
              await setRoundUpGoalId(next);
              setRoundUpGoal(next);
            }}
          />
        ))
      )}

      <CreateGoalSheet
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onSaved={() => {
          setCreateVisible(false);
          load();
        }}
      />

      <ContributeSheet
        goal={contributeTo}
        onClose={() => setContributeTo(null)}
        onSaved={() => {
          setContributeTo(null);
          load();
        }}
      />
    </Screen>
  );
}

function GoalCard({
  goal,
  daysRemaining,
  isRoundUp,
  onContribute,
  onToggleRoundUp,
}: {
  goal: GoalProgress;
  daysRemaining: number;
  isRoundUp: boolean;
  onContribute: () => void;
  onToggleRoundUp: () => void;
}) {
  const daysLeft = goal.deadline
    ? Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / MS_PER_DAY)
    : null;
  const perDay =
    daysLeft && daysLeft > 0 ? goal.remainingAmount / daysLeft : goal.remainingAmount / 30;
  const overdue = daysLeft !== null && daysLeft < 0 && !goal.isComplete;

  return (
    <Card>
      <View style={styles.goalHead}>
        <Text style={styles.goalEmoji}>{goal.emoji}</Text>
        <View style={styles.goalHeadText}>
          <Text style={styles.goalName}>{goal.name}</Text>
          <Text style={styles.goalMeta}>
            {formatMoney(goal.savedAmount)} of {formatMoney(goal.targetAmount)}
            {daysLeft !== null
              ? overdue
                ? ` · ${Math.abs(daysLeft)}d overdue`
                : ` · ${daysLeft}d left`
              : ''}
          </Text>
        </View>
        <Text style={[styles.goalPercent, goal.isComplete && { color: palette.neonGreen }]}>
          {Math.round(goal.fraction * 100)}%
        </Text>
      </View>

      <ProgressBar
        fraction={goal.fraction}
        color={goal.isComplete ? palette.neonGreen : overdue ? palette.warningAmber : palette.violet}
        height={10}
      />

      {goal.isComplete ? (
        <Text style={styles.goalDone}>Fully funded. Go get it 🎉</Text>
      ) : (
        <Text style={styles.goalPace}>
          {formatMoney(perDay)}/day to finish{daysLeft !== null ? ' on time' : ''}
        </Text>
      )}

      <View style={styles.goalActions}>
        <Button label="Add money" variant="secondary" onPress={onContribute} style={styles.flex} />
        <Chip
          label={isRoundUp ? '↑ Round-ups on' : 'Round-ups'}
          selected={isRoundUp}
          onPress={onToggleRoundUp}
          color={palette.violet}
        />
      </View>
    </Card>
  );
}

function CreateGoalSheet({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [days, setDays] = useState('');
  const [emoji, setEmoji] = useState('🎯');
  const [saving, setSaving] = useState(false);

  const parsedTarget = Number(target.replace(/[^\d.]/g, ''));
  const parsedDays = Number(days.replace(/[^\d]/g, ''));
  const canSave = name.trim().length > 0 && Number.isFinite(parsedTarget) && parsedTarget > 0;

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await db.createGoal({
        name: name.trim(),
        targetAmount: parsedTarget,
        emoji,
        deadline:
          Number.isFinite(parsedDays) && parsedDays > 0
            ? new Date(Date.now() + parsedDays * MS_PER_DAY).toISOString()
            : null,
      });
      setName('');
      setTarget('');
      setDays('');
      setEmoji('🎯');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="New goal">
      <View style={styles.emojiRow}>
        {EMOJI_CHOICES.map((choice) => (
          <Chip key={choice} label={choice} selected={emoji === choice} onPress={() => setEmoji(choice)} color={palette.violet} />
        ))}
      </View>
      <Field label="What for" value={name} onChangeText={setName} placeholder="Laptop" />
      <Field label="How much" value={target} onChangeText={setTarget} keyboardType="numeric" placeholder="45000" />
      <Field
        label="In how many days"
        value={days}
        onChangeText={setDays}
        keyboardType="numeric"
        placeholder="180"
        hint="Leave blank for no deadline — it'll be paced over 90 days."
      />
      <Button label={saving ? 'Creating…' : 'Create goal'} onPress={save} disabled={!canSave || saving} />
    </Sheet>
  );
}

function ContributeSheet({
  goal,
  onClose,
  onSaved,
}: {
  goal: GoalProgress | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  if (!goal) return null;

  const parsed = Number(amount.replace(/[^\d.]/g, ''));
  const canSave = Number.isFinite(parsed) && parsed > 0;

  async function apply(sign: 1 | -1) {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await db.contributeToGoal(goal!.id, parsed * sign, 'MANUAL');
      setAmount('');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={goal !== null} onClose={onClose} title={`${goal.emoji} ${goal.name}`}>
      <Text style={styles.contributeMeta}>
        {formatMoney(goal.remainingAmount)} to go of {formatMoney(goal.targetAmount)}
      </Text>
      <Field label="Amount" value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="0" autoFocus />
      <Button label={saving ? 'Saving…' : 'Add to goal'} onPress={() => apply(1)} disabled={!canSave || saving} />
      {/* Rough weeks happen. Better to let someone take money back honestly
          than have them abandon the goal and the app with it. */}
      <Button label="Take some back" variant="ghost" onPress={() => apply(-1)} disabled={!canSave || saving} />
      <Button label="Archive this goal" variant="danger" onPress={async () => { await db.archiveGoal(goal!.id); onSaved(); }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  reserveLabel: { ...typography.micro, color: palette.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  reserveAmount: { ...typography.heroCompact, color: palette.violet, marginTop: 4 },
  reserveNote: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xs, lineHeight: 17 },

  goalHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  goalEmoji: { fontSize: 28 },
  goalHeadText: { flex: 1 },
  goalName: { ...typography.cardTitle, color: palette.textPrimary },
  goalMeta: { ...typography.caption, color: palette.textSecondary, marginTop: 2 },
  goalPercent: { ...typography.bodyBold, fontSize: 17, color: palette.violet },
  goalPace: { ...typography.caption, color: palette.textSecondary, marginTop: spacing.sm },
  goalDone: { ...typography.caption, color: palette.neonGreen, marginTop: spacing.sm },
  goalActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  flex: { flex: 1 },

  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  contributeMeta: { ...typography.body, color: palette.textSecondary, textAlign: 'center' },
});
