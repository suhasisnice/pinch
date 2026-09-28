import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import * as db from '../db/dbService';
import { HoldingSummary } from '../db/repos/holdings';
import { postInvestment } from '../services/captureService';
import {
  WealthSnapshot,
  getWealthSnapshot,
  payCushion,
  payGoals,
  savePayPlan,
  startCushion,
} from '../services/wealthService';
import { BalanceState } from '../db/repos/balance';
import { PaydayItem } from '../math/payday';
import { habitLine, milestoneTitle } from '../math/progress';
import { milestonesJustReached, paydayJustDone } from '../math/moments';
import { celebrate } from '../components/Moment';
import BalanceCard from '../components/BalanceCard';
import { ChartHero } from '../components/Heroes';
import {
  HabitBars,
  InvestSheet,
  Milestones,
  PaydayChecklist,
  PlanSheet,
} from '../components/WealthParts';
import {
  HABIT_MONTHS,
  HOLDING_KINDS,
  HoldingKind,
  TIME_MONTHS,
  VALUE_STALE_DAYS,
  holdingKindLabel,
  holdingWorth,
  projectValue,
  wealthLine,
} from '../math/wealth';
import { setReturnRate } from '../settings/settingsStore';
import { formatMoney, formatMoneyCompact } from '../utils/format';
import { MS_PER_DAY } from '../math/budget';
import { palette, spacing, typography } from '../theme/theme';
import {
  Button,
  Chip,
  ChipRow,
  Field,
  Group,
  Hero,
  Loading,
  ProgressBar,
  Row,
  Screen,
  Section,
  Sheet,
  TextLink,
  TopBar,
} from '../components/ui';
import { showConfirm } from '../components/Dialog';
import { MASK, useMoneyReveal } from '../security/MoneyReveal';
import CushionFloor from '../components/CushionFloor';

/**
 * Wealth: the slow money, on its own tab (the user's choice — see
 * docs/WEALTH.md for the spec conflict this settles).
 *
 * Pinch cannot buy anything and does not know what anything is worth; it is
 * offline and it is not an adviser. What it can do is keep the order right
 * (a cushion before risk), keep the habit going (a monthly amount, held back
 * from the budget like a goal), and keep the long view in front of you.
 */
export default function WealthScreen() {
  const [snap, setSnap] = useState<WealthSnapshot | null>(null);
  const [balance, setBalance] = useState<BalanceState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<HoldingSummary | null>(null);
  const { revealed, reveal } = useMoneyReveal();
  const [cushionOpen, setCushionOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [investFor, setInvestFor] = useState<number | null>(null);

  const last = useRef<{ paydayDone: boolean | null; milestones: string[] } | null>(null);

  const load = useCallback(async () => {
    const [next, bal] = await Promise.all([getWealthSnapshot(), db.getBalanceState()]);
    // Moments fire on the change, not on opening the tab to find it done.
    const paydayDone = next.payday ? next.payday.allDone : null;
    const keys = next.milestones.map((m) => m.key);
    if (last.current) {
      if (paydayJustDone(last.current.paydayDone, paydayDone === true)) {
        celebrate('Paid yourself first. The rest is yours.');
      }
      for (const key of milestonesJustReached(last.current.milestones, keys)) {
        celebrate(`Milestone: ${milestoneTitle(key)}.`);
      }
    }
    last.current = { paydayDone, milestones: keys };
    setSnap(next);
    setBalance(bal);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  if (!snap || !balance) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const { ladder } = snap;
  const kept = snap.habit.length > 0 ? snap.habit[snap.habit.length - 1].kept : 0;
  const lastMonth =
    snap.netWorthHistory.length > 1
      ? snap.netWorthHistory[snap.netWorthHistory.length - 2].value
      : null;

  async function tick(item: PaydayItem) {
    const left = Math.max(0, item.amount - item.done);
    if (item.key === 'CUSHION') await payCushion(left);
    else if (item.key === 'GOALS') await payGoals(left);
    else {
      setInvestFor(left);
      return;
    }
    await load();
  }

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
        left="Wealth"
        action={{
          label: snap.plan.enabled ? 'Your split' : 'Pay yourself first',
          icon: snap.plan.enabled ? 'edit' : 'savings',
          onPress: () => setPlanOpen(true),
        }}
      />

      {/* The one number. Net worth once there is a bank balance to rest it on;
          until then, what has been kept — never a guessed total. */}
      {snap.netWorth !== null ? (
        <>
          {/* Net worth is built on the bank balance, so it hides with it:
              the number, the change since last month, and the bank figure. */}
          <ChartHero
            amount={snap.netWorth}
            label="net worth"
            history={snap.netWorthHistory}
            masked={!revealed}
            onReveal={() => void reveal()}
            line={revealed ? netWorthLine(snap.netWorth, lastMonth) : undefined}
            meta={`${revealed ? formatMoney(balance.projected ?? 0) : MASK} in the bank · ${formatMoney(snap.worth)} invested`}
          />
        </>
      ) : (
        <>
          <Hero
            amount={(snap.cushion?.savedAmount ?? 0) + snap.worth}
            label="kept for later"
            line="Add your bank balance and this becomes your net worth."
          />
          <BalanceCard state={balance} onChanged={load} />
        </>
      )}

      <Section title="Payday">
        {snap.payday ? (
          <PaydayChecklist
            payday={snap.payday}
            plan={snap.plan}
            onTick={tick}
            onEdit={() => setPlanOpen(true)}
            onMoveIdleCushion={async () => {
              await savePayPlan({
                ...snap.plan,
                investPct: snap.plan.investPct + snap.plan.cushionPct,
                cushionPct: 0,
              });
              await load();
            }}
          />
        ) : (
          <View style={styles.offPlan}>
            <Text style={styles.offPlanLine}>
              Pay yourself first. When the allowance lands, a slice goes to you before spending
              starts, and Today only divides what is left.
            </Text>
            <TextLink label="Set your split" accent onPress={() => setPlanOpen(true)} />
          </View>
        )}
      </Section>

      <Section title="Saving rate">
        <Text style={styles.habitLine}>{habitLine(snap.habit)}</Text>
        <HabitBars habit={snap.habit} />
        {kept > 0.009 ? (
          <Text style={styles.habitMeta}>
            {formatMoney(kept)} kept this month
            {snap.streak > 1 ? ` · ${snap.streak} months in a row at 10% or more` : ''}
          </Text>
        ) : null}
      </Section>

      {snap.insight ? (
        <Section title="In ten years">
          <Text style={styles.insight}>
            {snap.insight.category} spending runs about{' '}
            {formatMoney(Math.round(snap.insight.monthly / 10) * 10)} a month. Keep a quarter of it,{' '}
            {formatMoney(snap.insight.trimmed)}, every month and in ten years that is around{' '}
            {formatMoneyCompact(snap.insight.tenYears)}.
          </Text>
        </Section>
      ) : null}

      <Group title="Ladder">
        <Rung
          n={1}
          title="A cushion"
          state={ladder.cushion.done ? 'done' : ladder.current === 1 ? 'now' : 'later'}
          detail={
            ladder.cushion.done
              ? `${formatMoney(ladder.cushion.target)} set aside. Sleep well.`
              : snap.cushion && balance.projected !== null && ladder.cushion.saved > 0.009
                ? 'Kept under your balance, not spent. For the week life happens.'
                : snap.cushion
                ? `${formatMoney(ladder.cushion.saved)} of ${formatMoney(ladder.cushion.target)}. For the week life happens.`
                : `Three months of allowance, about ${formatMoney(ladder.cushion.target)}. For the week life happens.`
          }
          fraction={
            snap.cushion && !ladder.cushion.done && balance.projected === null
              ? ladder.cushion.fraction
              : undefined
          }
          extra={
            // With a bank balance to draw it under, the cushion is a floor,
            // not a progress bar: what is below the line is not spendable.
            snap.cushion && balance.projected !== null && ladder.cushion.saved > 0.009 ? (
              <CushionFloor
                balance={balance.projected}
                saved={ladder.cushion.saved}
                target={ladder.cushion.target}
                masked={!revealed}
              />
            ) : undefined
          }
          onPress={
            snap.cushion
              ? () => setCushionOpen(true)
              : async () => {
                  await startCushion();
                  await load();
                  setCushionOpen(true);
                }
          }
          action={snap.cushion ? undefined : 'Start the cushion'}
        />
        <Rung
          n={2}
          title="A habit"
          state={ladder.habit.done ? 'done' : ladder.current === 2 ? 'now' : 'later'}
          detail={
            ladder.habit.done
              ? `${formatMoney(snap.monthly)} a month, on autopilot.`
              : ladder.habit.hasPlan
                ? `${Math.min(ladder.habit.months, HABIT_MONTHS)} of ${HABIT_MONTHS} months in. Small and steady beats big and once.`
                : 'A monthly amount into a holding. Small is fine; regular is the point.'
          }
        />
        <Rung
          n={3}
          title="Time"
          state={ladder.time.done ? 'done' : ladder.current === 3 ? 'now' : 'later'}
          detail={
            ladder.time.done
              ? `${ladder.time.months} months in. The dull part is working.`
              : `${Math.min(ladder.time.months, TIME_MONTHS)} of ${TIME_MONTHS} months without touching it. The dull part is the part that works.`
          }
        />
      </Group>

      <Group title="Holdings" action="Add" onAction={() => setCreating(true)}>
        {snap.holdings.length === 0 && snap.unassigned <= 0.009 ? (
          <Text key="empty" style={styles.emptyBody}>
            A holding is wherever the slow money lives: a fund, an FD, gold. Pinch keeps count; your
            broker still does the buying.
          </Text>
        ) : (
          [
            ...snap.holdings.map((holding) => (
              <HoldingRow key={holding.id} holding={holding} onPress={() => setManaging(holding)} />
            )),
            snap.unassigned > 0.009 ? (
              <Row
                key="unassigned"
                title="Not in a holding"
                subtitle="Logged before holdings existed"
                right={<Text style={styles.value}>{formatMoney(snap.unassigned)}</Text>}
              />
            ) : null,
          ]
        )}
      </Group>

      {ladder.current === 1 && snap.holdings.length > 0 ? (
        <Text style={styles.caution}>
          Investing before the cushion is full is how people end up selling at the worst moment.
        </Text>
      ) : null}

      <Section title="Milestones">
        <Milestones achieved={snap.milestones} next={snap.next} />
      </Section>

      {snap.worth > 0.009 || snap.monthly > 0 ? (
        <Projection
          worth={snap.worth}
          monthly={snap.monthly}
          rate={snap.returnRate}
          cautious={snap.cautiousRate}
          onRate={async (rate) => {
            await setReturnRate(rate);
            await load();
          }}
        />
      ) : null}

      <Text style={styles.disclaimer}>
        Pinch doesn’t pick funds or know prices. Values are what you type in; projections are
        arithmetic, not advice.
      </Text>

      <PlanSheet
        visible={planOpen}
        plan={snap.plan}
        allowance={snap.allowance}
        daysInPeriod={snap.periodDays}
        onClose={() => setPlanOpen(false)}
        onSave={async (plan) => {
          await savePayPlan(plan);
          setPlanOpen(false);
          await load();
        }}
      />
      <InvestSheet
        visible={investFor !== null}
        amount={investFor ?? 0}
        holdings={snap.holdings}
        onClose={() => setInvestFor(null)}
        onSaved={async () => {
          setInvestFor(null);
          await load();
        }}
        onAddHolding={() => {
          setInvestFor(null);
          setCreating(true);
        }}
      />
      <HoldingSheet
        visible={creating}
        holding={null}
        onClose={() => setCreating(false)}
        onSaved={async () => {
          setCreating(false);
          await load();
        }}
      />
      <HoldingSheet
        visible={managing !== null}
        holding={managing}
        onClose={() => setManaging(null)}
        onSaved={async () => {
          setManaging(null);
          await load();
        }}
      />
      <CushionSheet
        visible={cushionOpen}
        snap={snap}
        onClose={() => setCushionOpen(false)}
        onSaved={async () => {
          setCushionOpen(false);
          await load();
        }}
      />
    </Screen>
  );
}

/** The line under net worth: which way it moved, said kindly. */
function netWorthLine(now: number, lastMonth: number | null): string {
  if (lastMonth === null) return 'The first mark on the chart. Next month gives it a direction.';
  const diff = now - lastMonth;
  if (diff > 0.5)
    return `Up ${formatMoney(diff)} since last month. That is the habit, compounding.`;
  if (diff < -0.5)
    return `Down ${formatMoney(-diff)} since last month. One month is weather, not climate.`;
  return 'Level with last month. Holding steady counts.';
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * One rung: a thin numeral, a name, one line. The rung to work on now is
 * the only coloured thing in the group.
 */
function Rung({
  n,
  title,
  detail,
  state,
  fraction,
  extra,
  onPress,
  action,
}: {
  n: number;
  title: string;
  detail: string;
  state: 'done' | 'now' | 'later';
  fraction?: number;
  /** Drawn under the detail line in place of a bar — the cushion floor. */
  extra?: React.ReactNode;
  onPress?: () => void;
  action?: string;
}) {
  const body = (
    <>
      <Text style={[styles.rungNumber, state === 'later' && styles.muted]}>{n}</Text>
      <View style={styles.rungBody}>
        <View style={styles.rungHead}>
          <Text style={[styles.rungTitle, state === 'later' && styles.muted]}>{title}</Text>
          <Text style={[styles.rungState, state === 'now' && styles.rungNow]}>
            {state === 'done' ? 'done' : state === 'now' ? 'now' : ''}
          </Text>
        </View>
        <Text style={styles.rungDetail}>{detail}</Text>
        {fraction !== undefined ? (
          <View style={styles.rungBar}>
            <ProgressBar fraction={fraction} height={2} />
          </View>
        ) : null}
        {extra ? <View style={styles.rungBar}>{extra}</View> : null}
        {action ? <Text style={styles.rungAction}>{action} →</Text> : null}
      </View>
    </>
  );

  if (!onPress) return <View style={styles.rung}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      style={({ pressed }) => [styles.rung, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

function ordinal(day: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = day % 100;
  return `${day}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

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

function HoldingRow({ holding, onPress }: { holding: HoldingSummary; onPress: () => void }) {
  const worth = holdingWorth(holding.putIn, holding.currentValue);
  const change =
    holding.currentValue !== null && holding.putIn > 0.009
      ? (holding.currentValue - holding.putIn) / holding.putIn
      : null;
  const stale =
    holding.valueUpdatedAt !== null &&
    Date.now() - new Date(holding.valueUpdatedAt).getTime() > VALUE_STALE_DAYS * MS_PER_DAY;

  const subtitle = [
    holdingKindLabel(holding.kind),
    holding.sipAmount && holding.sipDay
      ? `${formatMoneyCompact(holding.sipAmount)} on the ${ordinal(holding.sipDay)}`
      : null,
    stale ? `value from ${SHORT_MONTHS[new Date(holding.valueUpdatedAt!).getMonth()]}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Row
      title={holding.name}
      subtitle={subtitle}
      onPress={onPress}
      right={
        <View style={styles.holdingRight}>
          <Text style={styles.value}>{formatMoney(worth)}</Text>
          {change !== null ? (
            <Text style={styles.change}>
              {change >= 0 ? '+' : '−'}
              {Math.abs(change * 100).toFixed(1)}%
            </Text>
          ) : null}
        </View>
      }
    />
  );
}

const RATES = [0.06, 0.08, 0.1, 0.12];

/**
 * What patience does, as three figures. Always shown beside a cautious rate,
 * so one optimistic number can never be read as the promise.
 */
function Projection({
  worth,
  monthly,
  rate,
  cautious,
  onRate,
}: {
  worth: number;
  monthly: number;
  rate: number;
  cautious: number;
  onRate: (rate: number) => void;
}) {
  const ten = projectValue(worth, monthly, rate, 10);
  const tenCautious = projectValue(worth, monthly, cautious, 10);
  const putInTen = worth + monthly * 120;

  return (
    <Section title="Projection">
      <Text style={styles.projectionLine}>
        {monthly > 0
          ? `Keep ${formatMoney(monthly)} a month going and in ten years it could be around ${formatMoneyCompact(ten)} — ${formatMoneyCompact(putInTen)} put in by you, the rest patience.`
          : `Left alone for ten years, ${formatMoney(worth)} could be around ${formatMoneyCompact(ten)}.`}
      </Text>
      <View style={styles.years}>
        {[5, 10, 20].map((years) => (
          <View key={years} style={styles.year}>
            <Text style={styles.yearValue}>
              {formatMoneyCompact(projectValue(worth, monthly, rate, years))}
            </Text>
            <Text style={styles.yearLabel}>{years} years</Text>
          </View>
        ))}
      </View>
      {cautious < rate ? (
        <Text style={styles.cautious}>
          At a cautious {Math.round(cautious * 100)}%, ten years is{' '}
          {formatMoneyCompact(tenCautious)}.
        </Text>
      ) : null}
      <Text style={styles.assume}>Assume a year grows by</Text>
      <ChipRow>
        {RATES.map((r) => (
          <Chip
            key={r}
            label={`${Math.round(r * 100)}%`}
            selected={Math.abs(r - rate) < 0.001}
            onPress={() => onRate(r)}
          />
        ))}
      </ChipRow>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

function parseAmount(text: string): number {
  const n = Number(text.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** New holding, or everything about an existing one. */
function HoldingSheet({
  visible,
  holding,
  onClose,
  onSaved,
}: {
  visible: boolean;
  holding: HoldingSummary | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<HoldingKind>('MUTUAL_FUND');
  const [monthly, setMonthly] = useState('');
  const [day, setDay] = useState('');
  const [value, setValue] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(holding?.name ?? '');
    setKind((holding?.kind as HoldingKind) ?? 'MUTUAL_FUND');
    setMonthly(holding?.sipAmount ? String(holding.sipAmount) : '');
    setDay(holding?.sipDay ? String(holding.sipDay) : '');
    setValue(
      holding?.currentValue !== null && holding?.currentValue !== undefined
        ? String(holding.currentValue)
        : ''
    );
    setAmount('');
  }, [visible, holding]);

  async function run(task: () => Promise<void>) {
    if (saving) return;
    setSaving(true);
    try {
      await task();
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const monthlyAmount = parseAmount(monthly);
  const dayNumber = Math.round(parseAmount(day)) || 1;
  const moneyAmount = parseAmount(amount);

  if (!holding) {
    return (
      <Sheet visible={visible} onClose={onClose} title="New holding">
        <Field
          label="What is it"
          value={name}
          onChangeText={setName}
          placeholder="Nifty 50 index fund"
        />
        <KindPicker value={kind} onChange={setKind} />
        <Field
          label="Every month"
          value={monthly}
          onChangeText={setMonthly}
          keyboardType="numeric"
          placeholder="500"
          hint="Optional. Held back from your budget on its day, like a goal."
        />
        {monthlyAmount > 0 ? (
          <Field
            label="On the"
            value={day}
            onChangeText={setDay}
            keyboardType="numeric"
            placeholder="5"
            hint="Day of the month, 1–28."
          />
        ) : null}
        <Button
          label={saving ? 'Adding…' : 'Add holding'}
          disabled={name.trim().length === 0 || saving}
          onPress={() =>
            run(async () => {
              await db.createHolding({
                name,
                kind,
                sipAmount: monthlyAmount > 0 ? monthlyAmount : null,
                sipDay: monthlyAmount > 0 ? dayNumber : null,
              });
            })
          }
        />
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={holding.name}>
      <Text style={styles.sheetLead}>
        {formatMoney(holding.putIn)} put in
        {holding.currentValue !== null
          ? `, worth ${formatMoney(holding.currentValue)} when you last looked.`
          : '.'}
      </Text>

      <Field
        label="Money in or out"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        placeholder="1000"
      />
      <View style={styles.actions}>
        <Button
          label="Put in"
          disabled={moneyAmount <= 0 || saving}
          style={styles.flex}
          onPress={() =>
            run(async () => {
              await postInvestment({
                amount: moneyAmount,
                direction: 'CONTRIBUTION',
                label: holding.name,
                holdingId: holding.id,
              });
            })
          }
        />
        <Button
          label="Took out"
          variant="outlined"
          disabled={moneyAmount <= 0 || saving}
          style={styles.flex}
          onPress={() =>
            run(async () => {
              await postInvestment({
                amount: moneyAmount,
                direction: 'WITHDRAWAL',
                label: holding.name,
                holdingId: holding.id,
              });
            })
          }
        />
      </View>

      <Field
        label="Worth today"
        value={value}
        onChangeText={setValue}
        keyboardType="numeric"
        placeholder={String(Math.round(holding.putIn))}
        hint="From your broker’s app, now and then. Monthly is plenty."
      />
      <Button
        label="Update value"
        variant="outlined"
        size="small"
        disabled={parseAmount(value) <= 0 || saving}
        onPress={() => run(() => db.setHoldingValue(holding.id, parseAmount(value)))}
      />

      <Field
        label="Every month"
        value={monthly}
        onChangeText={setMonthly}
        keyboardType="numeric"
        placeholder="500"
      />
      {monthlyAmount > 0 ? (
        <Field
          label="On the"
          value={day}
          onChangeText={setDay}
          keyboardType="numeric"
          placeholder="5"
          hint="Day of the month, 1–28."
        />
      ) : null}
      <View style={styles.actions}>
        <Button
          label={holding.sipAmount ? 'Save plan' : 'Start plan'}
          variant="outlined"
          size="small"
          disabled={monthlyAmount <= 0 || saving}
          onPress={() => run(() => db.setHoldingPlan(holding.id, monthlyAmount, dayNumber))}
        />
        {holding.sipAmount ? (
          <Button
            label="Stop plan"
            variant="text"
            size="small"
            disabled={saving}
            onPress={() => run(() => db.setHoldingPlan(holding.id, null, null))}
          />
        ) : null}
      </View>

      <TextLink
        label="Archive this holding"
        onPress={() => {
          void showConfirm({
            title: 'Archive this holding?',
            message: 'It leaves the list and its plan stops. What you put in stays in your totals.',
            confirmLabel: 'Archive',
          }).then((ok) => {
            if (ok) void run(() => db.archiveHolding(holding.id));
          });
        }}
      />
    </Sheet>
  );
}

function KindPicker({
  value,
  onChange,
}: {
  value: HoldingKind;
  onChange: (kind: HoldingKind) => void;
}) {
  return (
    <ChipRow>
      {HOLDING_KINDS.map((k) => (
        <Chip
          key={k.kind}
          label={k.label}
          selected={value === k.kind}
          onPress={() => onChange(k.kind)}
        />
      ))}
    </ChipRow>
  );
}

/** Rung one: money into (or back out of) the emergency-fund goal. */
function CushionSheet({
  visible,
  snap,
  onClose,
  onSaved,
}: {
  visible: boolean;
  snap: WealthSnapshot;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (visible) setAmount('');
  }, [visible]);

  const cushion = snap.cushion;
  if (!cushion) return null;
  const parsed = parseAmount(amount);

  async function apply(sign: 1 | -1) {
    if (parsed <= 0 || saving) return;
    setSaving(true);
    try {
      await db.contributeToGoal(cushion!.id, parsed * sign, 'MANUAL');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Cushion">
      <Text style={styles.sheetLead}>
        {formatMoney(cushion.savedAmount)} of {formatMoney(cushion.targetAmount)}. It stays in your
        account, just spoken for — so a bad week never means selling investments.
      </Text>
      <Field
        label="Amount"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        placeholder="1000"
      />
      <View style={styles.actions}>
        <Button
          label="Set aside"
          disabled={parsed <= 0 || saving}
          style={styles.flex}
          onPress={() => apply(1)}
        />
        <Button
          label="Needed it"
          variant="outlined"
          disabled={parsed <= 0 || saving}
          style={styles.flex}
          onPress={() => apply(-1)}
        />
      </View>
      <Text style={styles.sheetNote}>It’s also a goal under Plans, so round-ups can fill it.</Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
  muted: { color: palette.textMuted },
  flex: { flex: 1 },
  value: { ...typography.body, color: palette.textPrimary },

  rung: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md },
  rungNumber: {
    ...typography.numeral,
    fontSize: 28,
    lineHeight: 30,
    letterSpacing: -1,
    color: palette.textPrimary,
    width: 22,
  },
  rungBody: { flex: 1, gap: 4 },
  rungHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  rungTitle: { ...typography.bodyBold, color: palette.textPrimary, flex: 1 },
  rungState: { ...typography.caption, color: palette.textMuted },
  rungNow: { color: palette.accent },
  rungDetail: { ...typography.caption, color: palette.textSecondary, lineHeight: 18 },
  rungBar: { marginTop: 6 },
  rungAction: { ...typography.caption, color: palette.accent, marginTop: 2 },

  emptyBody: { ...typography.body, color: palette.textSecondary, paddingVertical: spacing.md },
  offPlan: { gap: spacing.md },
  offPlanLine: { ...typography.body, color: palette.textPrimary, lineHeight: 22 },
  habitLine: { ...typography.body, color: palette.textPrimary, lineHeight: 22 },
  habitMeta: { ...typography.caption, color: palette.textMuted, marginTop: spacing.sm },
  insight: { ...typography.body, color: palette.textPrimary, lineHeight: 22 },

  holdingRight: { alignItems: 'flex-end', gap: 2 },
  change: { ...typography.caption, color: palette.textMuted },
  caution: { ...typography.caption, color: palette.warning, lineHeight: 18 },

  projectionLine: { ...typography.body, color: palette.textPrimary, lineHeight: 22 },
  years: { flexDirection: 'row', marginTop: spacing.lg, marginBottom: spacing.sm },
  year: { flex: 1, gap: 2 },
  yearValue: {
    ...typography.numeral,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -1,
    color: palette.textPrimary,
  },
  yearLabel: { ...typography.caption, color: palette.textMuted },
  cautious: { ...typography.caption, color: palette.textSecondary, marginBottom: spacing.md },
  assume: { ...typography.caption, color: palette.textMuted, marginBottom: spacing.xs },

  disclaimer: {
    ...typography.caption,
    color: palette.textMuted,
    lineHeight: 18,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },

  sheetLead: { ...typography.body, color: palette.textSecondary, lineHeight: 21 },
  sheetNote: { ...typography.caption, color: palette.textMuted },
  actions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
});
