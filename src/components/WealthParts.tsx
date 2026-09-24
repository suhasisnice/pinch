import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HoldingSummary } from '../db/repos/holdings';
import {
  MAX_PLAN_SHARE,
  PayPlan,
  Payday,
  PaydayItem,
  clampPlan,
  payday as computePayday,
} from '../math/payday';
import { HABIT_RATE, milestoneTitle } from '../math/progress';
import { postInvestment } from '../services/captureService';
import { formatMoney, formatMoneyCompact } from '../utils/format';
import { layer, palette, spacing, typography } from '../theme/theme';
import { Button, Chip, ChipRow, Field, Sheet, TextLink } from './ui';
import Icon from './Icon';

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// ---------------------------------------------------------------------------
// Payday checklist
// ---------------------------------------------------------------------------

const ITEM_WORDS: Record<PaydayItem['key'], string> = {
  CUSHION: 'to the cushion',
  GOALS: 'to your goals',
  INVEST: 'invested',
};

/**
 * Pay yourself first, as a checklist. Each line is one tap: the money goes
 * where it is meant to, and the line goes quiet. Today does not move when you
 * tick — it was held back from the start.
 */
export function PaydayChecklist({
  payday,
  plan,
  onTick,
  onEdit,
  onMoveIdleCushion,
}: {
  payday: Payday;
  plan: PayPlan;
  onTick: (item: PaydayItem) => void;
  onEdit: () => void;
  onMoveIdleCushion: () => void;
}) {
  return (
    <View style={styles.payday}>
      <Text style={styles.paydayLine}>
        {payday.allDone
          ? `All paid. ${formatMoney(payday.forSpending)} is yours to spend, guilt-free.`
          : `${formatMoney(payday.total)} to you first. ${formatMoney(payday.forSpending)} for spending.`}
      </Text>
      {payday.items.map((item) => {
        const left = Math.max(0, item.amount - item.done);
        return (
          <Pressable
            key={item.key}
            disabled={item.complete}
            onPress={() => onTick(item)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.complete }}
            accessibilityLabel={`${formatMoney(item.amount)} ${ITEM_WORDS[item.key]}`}
            style={({ pressed }) => [styles.check, pressed && styles.pressed]}
          >
            <View style={[styles.tick, item.complete && styles.tickOn]}>
              {item.complete ? <Icon name="check" size={13} color={palette.background} /> : null}
            </View>
            <Text style={[styles.checkText, item.complete && styles.checkDone]}>
              {formatMoney(item.amount)} {ITEM_WORDS[item.key]}
            </Text>
            {!item.complete ? (
              <Text style={styles.checkAction}>
                {item.done > 0.009
                  ? `${formatMoney(left)} left`
                  : item.key === 'INVEST'
                    ? 'Log it'
                    : 'Set aside'}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
      {payday.cushionShareIdle ? (
        <TextLink
          label={`Cushion's full. Move its ${Math.round(plan.cushionPct * 100)}% to investing`}
          accent
          onPress={onMoveIdleCushion}
        />
      ) : null}
      <TextLink label="Change the split" onPress={onEdit} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// The split
// ---------------------------------------------------------------------------

const STEP = 0.01;

function Stepper({
  label,
  hint,
  pct,
  allowance,
  onChange,
}: {
  label: string;
  hint: string;
  pct: number;
  allowance: number;
  onChange: (pct: number) => void;
}) {
  const whole = Math.round(pct * 100);
  return (
    <View style={styles.stepper}>
      <View style={styles.stepperText}>
        <Text style={styles.stepperLabel}>{label}</Text>
        <Text style={styles.stepperHint}>
          {formatMoney(Math.round((allowance * pct) / 10) * 10)} · {hint}
        </Text>
      </View>
      <Pressable
        onPress={() => onChange(Math.max(0, pct - STEP))}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Less to ${label}`}
        style={styles.stepButton}
      >
        <Text style={styles.stepGlyph}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>{whole}%</Text>
      <Pressable
        onPress={() => onChange(pct + STEP)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`More to ${label}`}
        style={styles.stepButton}
      >
        <Text style={styles.stepGlyph}>+</Text>
      </Pressable>
    </View>
  );
}

/** Setting the split: three steppers and one sentence saying what it means. */
export function PlanSheet({
  visible,
  plan,
  allowance,
  daysInPeriod,
  onClose,
  onSave,
}: {
  visible: boolean;
  plan: PayPlan;
  allowance: number;
  daysInPeriod: number;
  onClose: () => void;
  onSave: (plan: PayPlan) => void;
}) {
  const [draft, setDraft] = useState(plan);
  useEffect(() => {
    if (visible) setDraft(plan);
  }, [visible, plan]);

  const clamped = clampPlan(draft);
  const preview = computePayday({
    allowance,
    plan: { ...clamped, enabled: true },
    cushionRemaining: Number.POSITIVE_INFINITY,
    openGoals: 1,
    sipDue: 0,
    cushionDone: 0,
    goalsDone: 0,
    investedDone: 0,
  });
  const rate = Math.round((clamped.cushionPct + clamped.goalsPct + clamped.investPct) * 100);
  // At the ceiling, + does nothing rather than quietly shrinking the other two.
  const set = (key: 'cushionPct' | 'goalsPct' | 'investPct') => (pct: number) =>
    setDraft((d) => {
      const next = { ...d, [key]: Math.round(pct * 100) / 100 };
      return next.cushionPct + next.goalsPct + next.investPct > MAX_PLAN_SHARE + 1e-9 ? d : next;
    });

  return (
    <Sheet visible={visible} onClose={onClose} title="Pay yourself first">
      <Text style={styles.sheetLead}>
        When the allowance lands, this much goes to you before spending starts. Today only divides
        what's left.
      </Text>
      <Stepper
        label="Cushion"
        hint="for the bad week"
        pct={clamped.cushionPct}
        allowance={allowance}
        onChange={set('cushionPct')}
      />
      <Stepper
        label="Goals"
        hint="the laptop, the trip"
        pct={clamped.goalsPct}
        allowance={allowance}
        onChange={set('goalsPct')}
      />
      <Stepper
        label="Investing"
        hint="the slow money"
        pct={clamped.investPct}
        allowance={allowance}
        onChange={set('investPct')}
      />
      <Text style={styles.planSum}>
        {rate}% to you: {formatMoney(preview.total)}. Spending gets{' '}
        {formatMoney(preview.forSpending)}, about{' '}
        {formatMoney(Math.floor(preview.forSpending / Math.max(1, daysInPeriod)))} a day.
      </Text>
      {rate < 10 ? (
        <Text style={styles.planHint}>10% is a good first habit. 5% still beats 0%.</Text>
      ) : null}
      <Button
        label={plan.enabled ? 'Save the split' : 'Start paying yourself first'}
        onPress={() => onSave({ ...clamped, enabled: true })}
      />
      {plan.enabled ? (
        <Button
          label="Turn it off"
          variant="text"
          onPress={() => onSave({ ...clamped, enabled: false })}
        />
      ) : null}
    </Sheet>
  );
}

/** The invest line: which holding, how much, done. */
export function InvestSheet({
  visible,
  amount,
  holdings,
  onClose,
  onSaved,
  onAddHolding,
}: {
  visible: boolean;
  amount: number;
  holdings: HoldingSummary[];
  onClose: () => void;
  onSaved: () => void;
  onAddHolding: () => void;
}) {
  const [value, setValue] = useState('');
  const [holdingId, setHoldingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setValue(amount > 0 ? String(Math.round(amount)) : '');
    const planned = holdings.filter((h) => h.sipAmount);
    setHoldingId(
      planned.length === 1 ? planned[0].id : holdings.length === 1 ? holdings[0].id : null
    );
  }, [visible, amount, holdings]);

  const parsed = Number(value.replace(/[^\d.]/g, ''));
  const holding = holdings.find((h) => h.id === holdingId);

  return (
    <Sheet visible={visible} onClose={onClose} title="Invested">
      {holdings.length === 0 ? (
        <>
          <Text style={styles.sheetLead}>
            Add where the money goes first: a fund, an FD, gold. Your broker's app does the buying.
          </Text>
          <TextLink label="Add a holding" accent onPress={onAddHolding} />
        </>
      ) : (
        <>
          <Text style={styles.sheetLead}>Done it in your broker's app? Log it here.</Text>
          <ChipRow>
            {holdings.map((h) => (
              <Chip
                key={h.id}
                label={h.name}
                selected={holdingId === h.id}
                onPress={() => setHoldingId(h.id)}
              />
            ))}
          </ChipRow>
          <Field label="Amount" value={value} onChangeText={setValue} keyboardType="numeric" />
          <Button
            label={saving ? 'Saving…' : 'Invested'}
            disabled={!holding || !(parsed > 0) || saving}
            onPress={async () => {
              if (!holding) return;
              setSaving(true);
              try {
                await postInvestment({
                  amount: parsed,
                  direction: 'CONTRIBUTION',
                  label: holding.name,
                  holdingId: holding.id,
                });
                onSaved();
              } finally {
                setSaving(false);
              }
            }}
          />
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// The habit
// ---------------------------------------------------------------------------

/**
 * Share of each recent month kept, as thin bars. The 10% mark is a hairline;
 * a month at or over it is white, under it grey. The current month is
 * labelled so it reads as still running.
 */
export function HabitBars({ habit }: { habit: { label: string; rate: number }[] }) {
  if (habit.length === 0) return null;
  const height = 64;
  const top = Math.max(0.25, ...habit.map((h) => h.rate));
  const markY = height - (HABIT_RATE / top) * height;

  return (
    <View style={styles.bars}>
      <View style={[styles.barsArea, { height }]}>
        <View style={[styles.habitMark, { top: markY }]} />
        {habit.map((h, i) => {
          const current = i === habit.length - 1;
          const good = h.rate >= HABIT_RATE - 1e-9;
          return (
            <View key={`${h.label}-${i}`} style={styles.barSlot}>
              <Text style={styles.barValue}>{Math.round(Math.max(0, h.rate) * 100)}%</Text>
              <View
                style={[
                  styles.bar,
                  {
                    height: Math.max(2, (Math.max(0, h.rate) / top) * (height - 16)),
                    backgroundColor: good ? palette.textPrimary : layer(palette.textPrimary, 0.25),
                  },
                  current && !good && { backgroundColor: layer(palette.textPrimary, 0.4) },
                ]}
              />
            </View>
          );
        })}
      </View>
      <View style={styles.barLabels}>
        {habit.map((h, i) => (
          <Text
            key={`${h.label}-l-${i}`}
            style={[styles.barLabel, i === habit.length - 1 && styles.barLabelNow]}
          >
            {i === habit.length - 1 ? 'now' : h.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

function dayMonth(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

export function Milestones({
  achieved,
  next,
}: {
  achieved: { key: string; achievedAt: string }[];
  next: { title: string; toGo: number | null } | null;
}) {
  return (
    <View>
      {next ? (
        <View style={styles.milestone}>
          <View style={styles.tick} />
          <Text style={styles.milestoneNext}>{next.title}</Text>
          {next.toGo !== null && next.toGo > 0 ? (
            <Text style={styles.milestoneMeta}>{formatMoneyCompact(next.toGo)} to go</Text>
          ) : (
            <Text style={styles.milestoneMeta}>next</Text>
          )}
        </View>
      ) : null}
      {achieved.slice(0, 4).map((m) => (
        <View key={m.key} style={styles.milestone}>
          <View style={[styles.tick, styles.tickOn]}>
            <Icon name="check" size={13} color={palette.background} />
          </View>
          <Text style={styles.milestoneTitle}>{milestoneTitle(m.key)}</Text>
          <Text style={styles.milestoneMeta}>{dayMonth(m.achievedAt)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },

  payday: { gap: spacing.xs },
  paydayLine: {
    ...typography.body,
    color: palette.textPrimary,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  check: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  tick: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickOn: { backgroundColor: palette.textPrimary, borderColor: palette.textPrimary },
  checkText: { ...typography.body, color: palette.textPrimary, flex: 1 },
  checkDone: { color: palette.textMuted },
  checkAction: { ...typography.caption, color: palette.accent },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10 },
  stepperText: { flex: 1, gap: 2 },
  stepperLabel: { ...typography.bodyBold, color: palette.textPrimary },
  stepperHint: { ...typography.caption, color: palette.textMuted },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepGlyph: { ...typography.body, fontSize: 18, color: palette.textPrimary },
  stepValue: { ...typography.body, color: palette.textPrimary, width: 40, textAlign: 'center' },
  planSum: { ...typography.body, color: palette.textPrimary, lineHeight: 22 },
  planHint: { ...typography.caption, color: palette.textMuted },
  sheetLead: { ...typography.body, color: palette.textSecondary, lineHeight: 21 },

  bars: { marginTop: spacing.md },
  barsArea: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  habitMark: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: layer(palette.textPrimary, 0.22),
  },
  barSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  bar: { width: '100%', maxWidth: 28, borderRadius: 2 },
  barValue: { ...typography.caption, color: palette.textMuted },
  barLabels: { flexDirection: 'row', gap: spacing.sm, marginTop: 6 },
  barLabel: { ...typography.caption, color: palette.textMuted, flex: 1, textAlign: 'center' },
  barLabelNow: { color: palette.textPrimary },

  milestone: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  milestoneNext: { ...typography.body, color: palette.textSecondary, flex: 1 },
  milestoneTitle: { ...typography.body, color: palette.textPrimary, flex: 1 },
  milestoneMeta: { ...typography.caption, color: palette.textMuted },
});
