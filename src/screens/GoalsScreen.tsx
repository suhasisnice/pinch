import React, { useCallback, useEffect, useState } from 'react';
import { showConfirm, showMessage } from '../components/Dialog';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as db from '../db/dbService';
import { GoalProgress } from '../db/repos/goals';
import { getRoundUpGoalId, setRoundUpGoalId } from '../settings/settingsStore';
import { estimatedCompletionDate, goalTrackingStatus } from '../math/budget';
import { getBudgetSnapshot } from '../services/budgetService';
import { getMonthlyAllowance } from '../settings/settingsStore';
import { formatMoney } from '../utils/format';
import { layer, palette, radii, spacing, typography } from '../theme/theme';
import {
  Button,
  Card,
  CardTitle,
  Chip,
  Field,
  Group,
  Loading,
  ProgressBar,
  Screen,
  Sheet,
  TopBar,
} from '../components/ui';
import Icon, { GOAL_ICONS } from '../components/Icon';
import { AnimatedMoney } from '../components/motion';
import { JarsHero } from '../components/Heroes';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function monthYear(date: Date): string {
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

export default function GoalsScreen({ top }: { top?: React.ReactNode } = {}) {
  const [goals, setGoals] = useState<GoalProgress[] | null>(null);
  const [reserveCapped, setReserveCapped] = useState(false);
  const [roundUpGoal, setRoundUpGoal] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [contributeTo, setContributeTo] = useState<GoalProgress | null>(null);
  const [totalInvested, setTotalInvested] = useState(0);
  // The engine's figure, not a second calculation — Plans and Today must agree.
  const [totalReserved, setTotalReserved] = useState(0);

  const load = useCallback(async () => {
    const [nextGoals, roundUp, snapshot, invested] = await Promise.all([
      db.getActiveGoals(),
      getRoundUpGoalId(),
      getMonthlyAllowance().then(getBudgetSnapshot),
      db.getTotalInvested(),
    ]);
    setGoals(nextGoals);
    setRoundUpGoal(roundUp);
    setReserveCapped(snapshot.goalReserveCapped);
    setTotalReserved(snapshot.budget.goalReserve + (snapshot.budget.planReserve ?? 0));
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
      <TopBar
        left={top ?? 'Saving'}
        action={{ label: 'New goal', onPress: () => setCreateVisible(true) }}
      />

      {goals.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing saved for yet.</Text>
          <Text style={styles.emptyBody}>
            Pick something you want. Pinch sets a little aside each day, before you can spend it.
          </Text>
        </View>
      ) : (
        <>
          <JarsHero
            amount={totalSaved}
            label="saved so far"
            goals={goals.map((g) => ({
              name: g.name,
              saved: g.savedAmount,
              target: g.targetAmount,
            }))}
            line={savingLine(goals)}
            meta={`${formatMoney(totalReserved)} set aside this month${
              totalInvested > 0.009 ? ` · ${formatMoney(totalInvested)} invested` : ''
            }`}
          />
          {reserveCapped ? (
            <Text style={styles.capped}>
              Your goals wanted more than half the allowance, so Pinch is pacing them slower.
            </Text>
          ) : null}

          <Group title="Goals">
            {goals.map((goal) => (
              <GoalRow
                key={goal.id}
                goal={goal}
                isRoundUp={roundUpGoal === goal.id}
                onOpen={() => setContributeTo(goal)}
                onToggleRoundUp={async () => {
                  const next = roundUpGoal === goal.id ? null : goal.id;
                  await setRoundUpGoalId(next);
                  setRoundUpGoal(next);
                }}
              />
            ))}
          </Group>
        </>
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

/** The line under the total: how the goals are doing, in one kind sentence. */
function savingLine(goals: GoalProgress[]): string {
  const open = goals.filter((g) => !g.isComplete);
  if (open.length === 0) return 'Everything funded. Treat yourself, carefully.';
  const behind = open.filter(
    (g) => goalTrackingStatus(g.savedAmount, g.targetAmount, g.createdAt, g.deadline) === 'BEHIND'
  );
  if (behind.length > 0) {
    return behind.length === 1
      ? `${behind[0].name} could use a little attention.`
      : `${behind.length} goals could use a little attention.`;
  }
  const closest = [...open].sort((a, b) => b.fraction - a.fraction)[0];
  return `${closest.name} is ${Math.round(closest.fraction * 100)}% there. Steady on.`;
}

/**
 * One goal as a row: name and percentage, a hairline of progress, and one
 * line of how it is going. Tap for money in or out.
 */
function GoalRow({
  goal,
  isRoundUp,
  onOpen,
  onToggleRoundUp,
}: {
  goal: GoalProgress;
  isRoundUp: boolean;
  onOpen: () => void;
  onToggleRoundUp: () => void;
}) {
  const daysLeft = goal.deadline
    ? Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / MS_PER_DAY)
    : null;
  const perDay = daysLeft && daysLeft > 0 ? goal.remainingAmount / daysLeft : 0;
  const overdue = daysLeft !== null && daysLeft < 0 && !goal.isComplete;
  const status = goal.isComplete
    ? null
    : goalTrackingStatus(goal.savedAmount, goal.targetAmount, goal.createdAt, goal.deadline);
  const projected =
    !goal.deadline && !goal.isComplete
      ? estimatedCompletionDate(goal.savedAmount, goal.targetAmount, goal.createdAt)
      : null;

  const detail = goal.isComplete
    ? 'Done. All of it.'
    : overdue
      ? `Deadline passed ${Math.abs(daysLeft!)} days ago. No judgement.`
      : [
          status === 'BEHIND' ? 'A bit behind' : status === 'ON_TRACK' ? 'On track' : null,
          // Only a deadline makes a daily amount meaningful; open goals show a date.
          daysLeft !== null ? `${formatMoney(perDay)} a day` : null,
          daysLeft !== null
            ? `${daysLeft} days left`
            : projected
              ? `by ${monthYear(projected)}`
              : null,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${goal.name}, ${formatMoney(goal.savedAmount)} of ${formatMoney(goal.targetAmount)}`}
      style={({ pressed }) => [styles.goal, pressed && styles.pressed]}
    >
      <View style={styles.goalHead}>
        <Text style={styles.goalName} numberOfLines={1}>
          {goal.name}
        </Text>
        <Text style={styles.goalAmount}>
          {formatMoney(goal.savedAmount)}
          <Text style={styles.goalOf}> / {formatMoney(goal.targetAmount)}</Text>
        </Text>
      </View>
      <ProgressBar
        fraction={goal.fraction}
        color={overdue || status === 'BEHIND' ? palette.warning : palette.textPrimary}
        height={2}
      />
      <View style={styles.goalFoot}>
        <Text style={[styles.goalDetail, status === 'BEHIND' && { color: palette.warning }]}>
          {detail}
        </Text>
        <Pressable
          onPress={onToggleRoundUp}
          hitSlop={8}
          accessibilityRole="switch"
          accessibilityState={{ checked: isRoundUp }}
          accessibilityLabel="Round-ups"
        >
          <Text style={[styles.roundUp, isRoundUp && styles.roundUpOn]}>
            {isRoundUp ? 'round-ups on' : 'round-ups'}
          </Text>
        </Pressable>
      </View>
    </Pressable>
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
      <Field
        label="How much"
        value={target}
        onChangeText={setTarget}
        keyboardType="numeric"
        placeholder="45000"
      />
      <Field
        label="In how many days"
        value={days}
        onChangeText={setDays}
        keyboardType="numeric"
        placeholder="180"
        hint="Optional. Blank paces it over 90 days."
      />
      <Button
        label={saving ? 'Creating…' : 'Create goal'}
        onPress={save}
        disabled={!canSave || saving}
      />
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
        ? String(
            Math.max(0, Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / MS_PER_DAY))
          )
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
  pressed: { opacity: 0.6 },
  flex: { flex: 1 },
  empty: { paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...typography.quip, color: palette.textPrimary },
  emptyBody: { ...typography.body, color: palette.textSecondary },
  capped: { ...typography.caption, color: palette.warning, textAlign: 'center' },

  goal: { paddingVertical: spacing.md, gap: 10 },
  goalHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.md },
  goalName: { ...typography.bodyBold, color: palette.textPrimary, flex: 1 },
  goalAmount: { ...typography.body, color: palette.textPrimary },
  goalOf: { color: palette.textMuted },
  goalFoot: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  goalDetail: { ...typography.caption, color: palette.textMuted, flex: 1 },
  roundUp: { ...typography.caption, color: palette.textMuted },
  roundUpOn: { color: palette.accent },

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
  iconChoiceOn: { borderColor: palette.textPrimary, backgroundColor: palette.surfaceElevated },
  dangerNote: { ...typography.caption, color: palette.textMuted, textAlign: 'center' },
  contributeMeta: { ...typography.body, color: palette.textSecondary, textAlign: 'center' },
});
