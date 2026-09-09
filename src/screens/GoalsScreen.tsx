import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
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
import Icon, { GOAL_ICONS } from '../components/Icon';
import { LabelIconBadge } from '../components/LabelIcon';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export default function GoalsScreen() {
  const [goals, setGoals] = useState<GoalProgress[] | null>(null);
  const [daysRemaining, setDaysRemaining] = useState(30);
  const [reserveCapped, setReserveCapped] = useState(false);
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
    setReserveCapped(snapshot.goalReserveCapped);
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
          {reserveCapped ? (
            <Text style={styles.reserveCapped}>
              Your goals wanted more than half your allowance, so Pinch is holding back less
              than they asked for. They will take longer than planned. Lower a target, add a
              longer deadline, or delete one to change that.
            </Text>
          ) : null}
        </Card>
      ) : null}

      <Button label="New goal" onPress={() => setCreateVisible(true)} />

      {goals.length === 0 ? (
        <Card>
          <EmptyState
            icon="goals"
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
            onOpen={() => setContributeTo(goal)}
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

      <ManageGoalSheet
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
  onOpen,
  onToggleRoundUp,
}: {
  goal: GoalProgress;
  daysRemaining: number;
  isRoundUp: boolean;
  onOpen: () => void;
  onToggleRoundUp: () => void;
}) {
  const daysLeft = goal.deadline
    ? Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / MS_PER_DAY)
    : null;
  const perDay =
    daysLeft && daysLeft > 0 ? goal.remainingAmount / daysLeft : goal.remainingAmount / 30;
  const overdue = daysLeft !== null && daysLeft < 0 && !goal.isComplete;

  return (
    <Card onPress={onOpen}>
      <View style={styles.goalHead}>
        <LabelIconBadge label={goal.emoji} color={palette.violet} />
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
        <Text style={styles.goalDone}>Fully funded. Go get it.</Text>
      ) : (
        <Text style={styles.goalPace}>
          {formatMoney(perDay)}/day to finish{daysLeft !== null ? ' on time' : ''}
        </Text>
      )}

      <View style={styles.goalActions}>
        <Button label="Add money or edit" variant="secondary" onPress={onOpen} style={styles.flex} />
        <Chip
          label={isRoundUp ? 'Round-ups on' : 'Round-ups'}
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
  const [icon, setIcon] = useState<string>('goals');
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
        emoji: icon,
        deadline:
          Number.isFinite(parsedDays) && parsedDays > 0
            ? new Date(Date.now() + parsedDays * MS_PER_DAY).toISOString()
            : null,
      });
      setName('');
      setTarget('');
      setDays('');
      setIcon('goals');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="New goal">
      <IconPicker value={icon} onChange={setIcon} />
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

/** The shared icon grid, used when creating and when editing a goal. */
function IconPicker({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <View style={styles.iconRow}>
      {GOAL_ICONS.map((choice) => (
        <Pressable
          key={choice}
          onPress={() => onChange(choice)}
          style={({ pressed }) => [
            styles.iconChoice,
            value === choice && styles.iconChoiceOn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Icon
            name={choice}
            size={20}
            color={value === choice ? palette.violet : palette.textMuted}
          />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Everything you can do to a goal once it exists: put money in, take money
 * back out, change what it is, or get rid of it.
 *
 * Archive and delete are both offered because they answer different
 * questions. Archiving keeps a finished goal and the contributions behind it
 * as a record; deleting is for a goal that should never have existed, and
 * takes its contribution history with it.
 */
function ManageGoalSheet({
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
  const [editing, setEditing] = useState(false);

  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [days, setDays] = useState('');
  const [icon, setIcon] = useState('goals');

  useEffect(() => {
    if (!goal) return;
    setAmount('');
    setEditing(false);
    setName(goal.name);
    setTarget(String(goal.targetAmount));
    setIcon(goal.emoji);
    setDays(
      goal.deadline
        ? String(Math.max(0, Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / MS_PER_DAY)))
        : ''
    );
  }, [goal]);

  if (!goal) return null;

  const parsed = Number(amount.replace(/[^\d.]/g, ''));
  const canContribute = Number.isFinite(parsed) && parsed > 0;

  const parsedTarget = Number(target.replace(/[^\d.]/g, ''));
  const parsedDays = Number(days.replace(/[^\d]/g, ''));
  const canSaveEdits = name.trim().length > 0 && Number.isFinite(parsedTarget) && parsedTarget > 0;

  async function apply(sign: 1 | -1) {
    if (!canContribute || saving) return;
    setSaving(true);
    try {
      await db.contributeToGoal(goal!.id, parsed * sign, 'MANUAL');
      setAmount('');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function saveEdits() {
    if (!canSaveEdits || saving) return;
    setSaving(true);
    try {
      await db.updateGoal(goal!.id, {
        name: name.trim(),
        targetAmount: parsedTarget,
        emoji: icon,
        deadline:
          Number.isFinite(parsedDays) && parsedDays > 0
            ? new Date(Date.now() + parsedDays * MS_PER_DAY).toISOString()
            : null,
      });
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    Alert.alert(
      'Delete this goal?',
      `"${goal!.name}" and everything saved into it (${formatMoney(goal!.savedAmount)}) will be removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await db.deleteGoal(goal!.id);
              onSaved();
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
  }

  if (editing) {
    return (
      <Sheet visible={goal !== null} onClose={() => setEditing(false)} title="Edit goal">
        <IconPicker value={icon} onChange={setIcon} />
        <Field label="What for" value={name} onChangeText={setName} placeholder="Laptop" />
        <Field
          label="How much"
          value={target}
          onChangeText={setTarget}
          keyboardType="numeric"
          placeholder="45000"
        />
        <Field
          label="Days left"
          value={days}
          onChangeText={setDays}
          keyboardType="numeric"
          placeholder="180"
          hint="Leave blank to drop the deadline."
        />
        <Button
          label={saving ? 'Saving…' : 'Save changes'}
          onPress={saveEdits}
          disabled={!canSaveEdits || saving}
        />
        <Button label="Cancel" variant="ghost" onPress={() => setEditing(false)} />
      </Sheet>
    );
  }

  return (
    <Sheet visible={goal !== null} onClose={onClose} title={goal.name}>
      <Text style={styles.contributeMeta}>
        {formatMoney(goal.remainingAmount)} to go of {formatMoney(goal.targetAmount)}
      </Text>
      <Field
        label="Amount"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        placeholder="0"
      />
      <Button
        label={saving ? 'Saving…' : 'Add to goal'}
        onPress={() => apply(1)}
        disabled={!canContribute || saving}
      />
      {/* Rough weeks happen. Better to let someone take money back honestly
          than have them abandon the goal and the app with it. */}
      <Button
        label="Take some back"
        variant="ghost"
        onPress={() => apply(-1)}
        disabled={!canContribute || saving}
      />

      <Button label="Edit goal" variant="secondary" onPress={() => setEditing(true)} />
      <Button
        label="Archive"
        variant="ghost"
        onPress={async () => {
          await db.archiveGoal(goal!.id);
          onSaved();
        }}
      />
      <Button label="Delete goal" variant="danger" onPress={confirmDelete} />
      <Text style={styles.dangerNote}>
        Archiving keeps the record. Deleting removes the goal and its contributions.
      </Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  reserveLabel: { ...typography.micro, color: palette.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  reserveAmount: { ...typography.heroCompact, color: palette.violet, marginTop: 4 },
  reserveNote: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xs, lineHeight: 17 },
  reserveCapped: {
    ...typography.caption,
    color: palette.warningAmber,
    marginTop: spacing.sm,
    lineHeight: 17,
  },

  goalHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  goalHeadText: { flex: 1 },
  goalName: { ...typography.cardTitle, color: palette.textPrimary },
  goalMeta: { ...typography.caption, color: palette.textSecondary, marginTop: 2 },
  goalPercent: { ...typography.bodyBold, fontSize: 17, color: palette.violet },
  goalPace: { ...typography.caption, color: palette.textSecondary, marginTop: spacing.sm },
  goalDone: { ...typography.caption, color: palette.neonGreen, marginTop: spacing.sm },
  goalActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  flex: { flex: 1 },

  iconRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  iconChoice: {
    width: 44,
    height: 44,
    borderRadius: radii.input,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
  },
  iconChoiceOn: { borderColor: palette.violet, backgroundColor: 'rgba(167,139,250,0.14)' },
  dangerNote: { ...typography.micro, color: palette.textMuted, textAlign: 'center' },
  contributeMeta: { ...typography.body, color: palette.textSecondary, textAlign: 'center' },
});
