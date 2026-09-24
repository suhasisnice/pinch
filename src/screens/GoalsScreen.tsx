import React, { useCallback, useEffect, useState } from 'react';
import { showConfirm, showMessage } from '../components/Dialog';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as db from '../db/dbService';
import { GoalProgress } from '../db/repos/goals';
import { getRoundUpGoalId, setRoundUpGoalId } from '../settings/settingsStore';
import { estimatedCompletionDate, goalReserve, goalTrackingStatus } from '../math/budget';
import { getBudgetSnapshot } from '../services/budgetService';
import { getMonthlyAllowance } from '../settings/settingsStore';
import { formatMoney } from '../utils/format';
import { layer, palette, radii, spacing, typography } from '../theme/theme';
import { Button, Card, CardTitle, Chip, EmptyState, Field, Loading, ProgressBar, Screen, ScreenTitle, Sheet } from '../components/ui';
import Icon, { GOAL_ICONS } from '../components/Icon';
import { NamedCover } from '../components/Cover';
import { AnimatedMoney } from '../components/motion';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function monthYear(date: Date): string {
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

export default function GoalsScreen() {
  const [goals, setGoals] = useState<GoalProgress[] | null>(null);
  const [daysRemaining, setDaysRemaining] = useState(30);
  const [reserveCapped, setReserveCapped] = useState(false);
  const [roundUpGoal, setRoundUpGoal] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [contributeTo, setContributeTo] = useState<GoalProgress | null>(null);
  const [totalInvested, setTotalInvested] = useState(0);

  const load = useCallback(async () => {
    const [nextGoals, roundUp, snapshot, invested] = await Promise.all([
      db.getActiveGoals(),
      getRoundUpGoalId(),
      getMonthlyAllowance().then(getBudgetSnapshot),
      db.getTotalInvested(),
    ]);
    setGoals(nextGoals);
    setRoundUpGoal(roundUp);
    setDaysRemaining(snapshot.daysRemaining);
    setReserveCapped(snapshot.goalReserveCapped);
    setTotalInvested(invested);
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

  const totalSaved = goals.reduce((sum, goal) => sum + goal.savedAmount, 0);
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
      <ScreenTitle
        title="Savings"
        subtitle="Saved first, spent after"
        action={{ label: 'New goal', onPress: () => setCreateVisible(true) }}
      />

      {/* Total saved is the hero, the way Today leads with one number: it is
          the figure that grows, and the one worth coming back to see. */}
      {goals.length > 0 ? (
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Saved so far</Text>
          <AnimatedMoney
            amount={totalSaved}
            style={styles.heroAmount}
            numberOfLines={1}
            adjustsFontSizeToFit
          />
          <Text style={styles.reserveNote}>
            {formatMoney(totalReserved)} held back from spending this period
          </Text>
          {reserveCapped ? (
            <Text style={styles.reserveCapped}>
              Goals asked for over half your allowance, so they're paced slower. Lower a target
              or extend a deadline.
            </Text>
          ) : null}
        </View>
      ) : null}

      {totalInvested > 0.009 ? (
        <Card>
          <Text style={styles.reserveLabel}>Invested so far</Text>
          <Text style={[styles.reserveAmount, { color: palette.accent }]}>
            {formatMoney(totalInvested)}
          </Text>
          <Text style={styles.reserveNote}>
            What you've put in, not what it's worth today.
          </Text>
        </Card>
      ) : null}

      {goals.length === 0 ? (
        <Card>
          <EmptyState
            icon="goals"
            title="No goals yet"
            body="A goal comes out of your daily number first, so it actually gets saved."
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

  const status = goal.isComplete
    ? null
    : goalTrackingStatus(goal.savedAmount, goal.targetAmount, goal.createdAt, goal.deadline);
  const projectedCompletion =
    !goal.deadline && !goal.isComplete
      ? estimatedCompletionDate(goal.savedAmount, goal.targetAmount, goal.createdAt)
      : null;

  return (
    <Card onPress={onOpen}>
      <View style={styles.goalHead}>
        <NamedCover name={goal.name} icon={goal.emoji} size={56} fill={goal.fraction} />
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
        <Text style={styles.goalPercent}>{Math.round(goal.fraction * 100)}%</Text>
      </View>

      <ProgressBar
        fraction={goal.fraction}
        color={overdue || status === 'BEHIND' ? palette.warning : palette.accent}
        height={6}
      />

      {goal.isComplete ? (
        <Text style={styles.goalDone}>Fully funded. Go get it.</Text>
      ) : (
        <Text style={styles.goalPace}>
          {status ? (
            <Text style={status === 'BEHIND' ? styles.statusBehind : styles.statusOn}>
              {status === 'ON_TRACK' ? 'On track' : 'Behind'}
              {' · '}
            </Text>
          ) : null}
          {formatMoney(perDay)}/day to finish{daysLeft !== null ? ' on time' : ''}
          {projectedCompletion ? ` · by ${monthYear(projectedCompletion)}` : ''}
        </Text>
      )}

      <View style={styles.goalActions}>
        <Button label="Add money" icon="add" variant="tonal" size="small" onPress={onOpen} />
        <Chip
          label={isRoundUp ? 'Round-ups on' : 'Round-ups'}
          selected={isRoundUp}
          onPress={onToggleRoundUp}
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
        hint="Optional. Blank paces it over 90 days."
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
          accessibilityRole="button"
          accessibilityLabel={choice}
          accessibilityState={{ selected: value === choice }}
        >
          <Icon
            name={choice}
            size={20}
            color={value === choice ? palette.textPrimary : palette.textMuted}
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
    void showConfirm({
      title: 'Delete this goal?',
      message: `"${goal!.name}" and everything saved into it (${formatMoney(goal!.savedAmount)}) will be removed. This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      try {
        await db.deleteGoal(goal!.id);
        onSaved();
      } catch (error) {
        await showMessage(
          'Could not delete',
          error instanceof Error ? error.message : 'Something went wrong.'
        );
      }
    });
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
  hero: { paddingTop: spacing.xs, paddingBottom: spacing.xs },
  heroLabel: { ...typography.heroLabel, color: palette.textSecondary },
  heroAmount: {
    ...typography.hero,
    fontSize: 48,
    lineHeight: 54,
    letterSpacing: -1.5,
    color: palette.textPrimary,
    marginTop: 2,
  },
  reserveLabel: { ...typography.caption, color: palette.textSecondary },
  reserveAmount: { ...typography.heroCompact, color: palette.textPrimary, marginTop: 2 },
  reserveNote: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xs, lineHeight: 17 },
  reserveCapped: {
    ...typography.caption,
    color: palette.warning,
    marginTop: spacing.sm,
    lineHeight: 17,
  },

  goalHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  goalHeadText: { flex: 1 },
  goalName: { ...typography.cardTitle, color: palette.textPrimary },
  goalMeta: { ...typography.caption, color: palette.textSecondary, marginTop: 2 },
  goalPercent: { ...typography.bodyBold, color: palette.textSecondary },
  statusOn: { color: palette.accent, fontWeight: '600' },
  statusBehind: { color: palette.warning, fontWeight: '600' },
  goalPace: { ...typography.caption, color: palette.textSecondary, marginTop: spacing.sm },
  goalDone: { ...typography.caption, color: palette.accent, marginTop: spacing.sm },
  goalActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  flex: { flex: 1 },

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
  iconChoiceOn: { borderColor: palette.accent, backgroundColor: palette.accentMuted },
  dangerNote: { ...typography.caption, color: palette.textMuted, textAlign: 'center' },
  contributeMeta: { ...typography.body, color: palette.textSecondary, textAlign: 'center' },
});
