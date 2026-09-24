import * as db from '../db/dbService';
import { BudgetSnapshot } from './budgetService';
import { NotificationSettings, PlannedNotification, isQuietHour } from '../notifications/engine';
import { TITLES } from '../notifications/messages';
import { RoastContext, RoastKind, roast } from '../notifications/roasts';
import { cancelScheduled, scheduleAt } from '../notifications/notificationService';
import {
  addInterventionLog,
  getInterventionLog,
  getRecoveryMission,
  setRecoveryMission,
} from '../settings/settingsStore';
import {
  Mission,
  MissionProgress,
  addDays,
  localDay,
  missionProgress,
  planMission,
  shouldReplan,
} from '../math/recovery';
import {
  Callout,
  CapLevel,
  SpendCap,
  SpendItem,
  capCrossing,
  capLevel,
  capMatches,
  findCallouts,
  keyFor,
  HISTORY_WEEKS,
} from '../math/patterns';
import {
  LOOKBACK_WEEKS,
  afterPaydaySpend,
  findRiskWindows,
  nextWarningAt,
  windowName,
} from '../math/riskWindows';

/**
 * Interventions (0.9.19, docs/INTERVENTIONS.md): the glue between the pure
 * maths (recovery, patterns, riskWindows), what is stored, and what is said.
 *
 * Nothing here changes a budget figure. A mission's tighter number is a
 * target the screen and the reprimands hold you to; the engine's numbers
 * stay the truth underneath it.
 */

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function dayStart(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Monday of the week `now` is in, local. */
export function weekStart(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

async function spentOnDays(days: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const day of days) {
    const from = dayStart(day);
    const to = dayStart(addDays(day, 1));
    out.set(day, await db.getGrossSpendBetween(from.toISOString(), to.toISOString()));
  }
  return out;
}

function tone(settings: NotificationSettings) {
  return settings.roastMe ? 'SAVAGE' : 'FIRM';
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export interface RecoveryView {
  mission: Mission;
  progress: MissionProgress;
  /** What today may still take under the mission's number. */
  leftToday: number;
  spentToday: number;
}

export interface RecoveryUpdate {
  /** The mission as it stands today, when one is running or about to. */
  view: RecoveryView | null;
  /** What changed on this look, for the caller to announce once. */
  events: RoastKind[];
  /** The mission an event is about (a finished one is cleared from storage). */
  about: Mission | null;
}

/**
 * Brings the stored mission up to date with today: starts one after an
 * overspend, re-plans a pending one if today got worse, and closes one that
 * is done or can no longer be done. Each change is reported once.
 */
export async function refreshRecovery(
  snapshot: BudgetSnapshot,
  now: Date = new Date()
): Promise<RecoveryUpdate> {
  const today = localDay(now);
  const log = await getInterventionLog();
  const events: RoastKind[] = [];
  const overBy = Math.max(0, -snapshot.today.remainingToday);
  let mission = await getRecoveryMission();

  const fresh = () =>
    planMission({
      day: today,
      overBy,
      normalLimit: snapshot.today.dailyLimit,
      daysAfter: snapshot.daysRemaining - 1,
    });

  if (!mission && snapshot.today.state === 'OVER') {
    mission = fresh();
    if (mission) await setRecoveryMission(mission);
  } else if (mission && today < mission.startsOn && shouldReplan(mission, overBy)) {
    mission = fresh() ?? mission;
    await setRecoveryMission(mission);
  }
  if (!mission) return { view: null, events, about: null };

  const days: string[] = [];
  for (let i = 0; i < mission.slots; i++) days.push(addDays(mission.startsOn, i));
  const spent = await spentOnDays(days.filter((d) => d < today));
  const progress = missionProgress(mission, today, (d) => spent.get(d) ?? 0);

  const once = async (kind: RoastKind, key: string) => {
    if (log.includes(key)) return;
    events.push(kind);
    await addInterventionLog(key);
  };

  if (progress.status === 'PENDING') {
    await once('RECOVERY_START', `recovery:start:${mission.startsOn}`);
  } else if (progress.status === 'DONE') {
    await once('RECOVERY_DONE', `recovery:done:${mission.startsOn}`);
    await setRecoveryMission(null);
    return { view: null, events, about: mission };
  } else if (progress.status === 'FAILED') {
    await once('RECOVERY_FAILED', `recovery:failed:${mission.startsOn}`);
    await setRecoveryMission(null);
    return { view: null, events, about: mission };
  }

  const spentToday = snapshot.today.spentToday;
  return {
    view: {
      mission,
      progress,
      spentToday,
      leftToday: mission.target - spentToday,
    },
    events,
    about: mission,
  };
}

function recoveryContext(mission: Mission, progress?: MissionProgress): RoastContext {
  return {
    overBy: mission.overBy,
    target: mission.target,
    days: mission.daysNeeded,
    dayNumber: progress?.dayNumber ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Callouts and caps
// ---------------------------------------------------------------------------

function toItems(rows: db.SpendRow[]): SpendItem[] {
  return rows.map((r) => ({ merchant: r.merchant, category: r.category, amount: r.amount }));
}

export interface CapStatus {
  cap: SpendCap;
  spent: number;
  level: CapLevel;
}

export interface WeekPatterns {
  callouts: Callout[];
  caps: CapStatus[];
}

/** This week's callouts (minus any already capped) and every cap's standing. */
export async function getWeekPatterns(now: Date = new Date()): Promise<WeekPatterns> {
  const start = weekStart(now);
  const historyStart = new Date(start);
  historyStart.setDate(historyStart.getDate() - HISTORY_WEEKS * 7);
  // The whole week, not "until now": a payment stamped this very instant
  // (the one being judged) must count.
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const [week, before, caps] = await Promise.all([
    db.getSpendRowsBetween(start.toISOString(), end.toISOString()),
    db.getSpendRowsBetween(historyStart.toISOString(), start.toISOString()),
    db.getSpendCaps(),
  ]);
  const items = toItems(week);
  const capped = new Set(caps.map((c) => `${c.scope}:${c.key}`));
  return {
    callouts: findCallouts(items, toItems(before)).filter(
      (c) => !capped.has(`${c.scope}:${c.key}`)
    ),
    caps: caps.map((cap) => {
      const spent = items.filter((i) => capMatches(cap, i)).reduce((s, i) => s + i.amount, 0);
      return { cap, spent, level: capLevel(cap, spent) };
    }),
  };
}

// ---------------------------------------------------------------------------
// After a payment
// ---------------------------------------------------------------------------

export interface TransactionInterventions {
  planned: PlannedNotification[];
  /** A line to add to the overspend notification rather than buzzing twice. */
  overspendSuffix: string | null;
}

/**
 * What to say about a spend that just landed, beyond the engine's nudges:
 * a recovery starting or slipping, a cap nearly reached or broken, a habit
 * worth naming. Each is said once for the thing it is about.
 */
export async function planTransactionInterventions(input: {
  transactionId: number;
  amount: number;
  merchant: string;
  category: string | null;
  occurredAt: Date;
  snapshot: BudgetSnapshot;
  settings: NotificationSettings;
  now?: Date;
}): Promise<TransactionInterventions> {
  const now = input.now ?? new Date();
  const out: TransactionInterventions = { planned: [], overspendSuffix: null };
  if (!input.settings.interventionsEnabled) return out;

  const t = tone(input.settings);
  const say = (
    kind: RoastKind,
    ctx: RoastContext,
    type: PlannedNotification['type'],
    payload = {}
  ) =>
    out.planned.push({
      type,
      tier: kind,
      title: TITLES[type],
      body: roast(kind, t, ctx),
      payload: { transactionId: input.transactionId, ...payload },
    });

  const isToday = localDay(input.occurredAt) === localDay(now);

  // Recovery.
  const recovery = await refreshRecovery(input.snapshot, now);
  if (recovery.about) {
    for (const event of recovery.events) {
      const ctx = recoveryContext(recovery.about, recovery.view?.progress);
      if (event === 'RECOVERY_START') {
        // Said in the same breath as the overspend that started it.
        out.overspendSuffix = roast('RECOVERY_START', t, ctx);
      } else {
        say(event, ctx, 'RECOVERY');
      }
    }
  }
  const view = recovery.view;
  if (view && view.progress.status === 'ACTIVE' && isToday) {
    const before = view.spentToday - input.amount;
    if (before <= view.mission.target && view.spentToday > view.mission.target + 0.5) {
      const log = await getInterventionLog();
      const key = `recovery:slip:${localDay(now)}`;
      if (!log.includes(key)) {
        await addInterventionLog(key);
        say(
          'RECOVERY_SLIP',
          {
            ...recoveryContext(view.mission, view.progress),
            amount: input.amount,
            merchant: input.merchant,
          },
          'RECOVERY'
        );
      }
    }
  }

  // Caps and callouts only look at this week.
  if (input.occurredAt < weekStart(now)) return out;
  const patterns = await getWeekPatterns(now);
  const week = localDay(weekStart(now));
  const log = await getInterventionLog();
  const item = { merchant: input.merchant, category: input.category };

  for (const status of patterns.caps) {
    if (!capMatches(status.cap, item)) continue;
    const crossing = capCrossing(status.cap, status.spent - input.amount, status.spent);
    if (!crossing) continue;
    const key = `cap:${week}:${status.cap.id}:NEAR`;
    if (crossing === 'NEAR') {
      if (log.includes(key)) continue;
      await addInterventionLog(key);
    }
    say(
      crossing === 'NEAR' ? 'CAP_NEAR' : 'CAP_BROKEN',
      {
        label: status.cap.label,
        total: status.spent,
        cap: status.cap.weeklyAmount,
        amount: input.amount,
      },
      'CAP'
    );
  }

  for (const callout of patterns.callouts) {
    const about =
      callout.scope === 'MERCHANT'
        ? keyFor(input.merchant) === callout.key
        : input.category !== null && keyFor(input.category) === callout.key;
    if (!about) continue;
    const key = `callout:${week}:${callout.scope}:${callout.key}`;
    if (log.includes(key)) continue;
    await addInterventionLog(key);
    say(
      'CALLOUT',
      {
        label: callout.label,
        count: callout.count,
        total: callout.total,
        usual: callout.usualWeekly,
      },
      'CALLOUT',
      { callout: { scope: callout.scope, label: callout.label } }
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// Before: heads-ups
// ---------------------------------------------------------------------------

const HEADS_UP_IDS = ['pinch-headsup-0', 'pinch-headsup-1'];
const PAYDAY_ID = 'pinch-headsup-payday';

/**
 * Re-learns the risky windows and schedules the next warning for each, plus
 * one for the morning of the next payday. Run on every app open, so the
 * windows follow the habits and a stale warning never lingers.
 */
export async function scheduleHeadsUps(
  snapshot: BudgetSnapshot,
  settings: NotificationSettings,
  now: Date = new Date()
): Promise<void> {
  if (!settings.enabled || !settings.headsUpEnabled) {
    for (const id of [...HEADS_UP_IDS, PAYDAY_ID]) await cancelScheduled(id);
    return;
  }
  const t = tone(settings);
  const from = new Date(now.getTime() - LOOKBACK_WEEKS * 7 * 24 * 60 * 60 * 1000);
  const rows = await db.getSpendRowsBetween(from.toISOString(), now.toISOString());
  const spends = rows.map((r) => ({ at: new Date(r.occurred_at), amount: r.amount }));

  const windows = findRiskWindows(spends, now);
  for (let i = 0; i < HEADS_UP_IDS.length; i++) {
    const w = windows[i];
    if (!w) {
      await cancelScheduled(HEADS_UP_IDS[i]);
      continue;
    }
    const at = nextWarningAt(w, now);
    if (isQuietHour(at, settings)) {
      await cancelScheduled(HEADS_UP_IDS[i]);
      continue;
    }
    await scheduleAt(
      HEADS_UP_IDS[i],
      {
        type: 'HEADS_UP',
        tier: 'WINDOW',
        title: TITLES.HEADS_UP,
        body: roast('HEADS_UP', t, {
          window: windowName(w),
          average: w.average,
          leftToday: snapshot.today.dailyLimit,
        }),
      },
      at
    );
  }

  // Payday: the morning the next period starts, if past paydays say the
  // first three days tend to run hot.
  const periodStart = new Date(snapshot.periodStart);
  const usual =
    now.getTime() - periodStart.getTime() > 3 * 24 * 60 * 60 * 1000
      ? afterPaydaySpend(spends, [periodStart])
      : null;
  const nextPayday = new Date(snapshot.periodEnd);
  nextPayday.setHours(10, 0, 0, 0);
  if (usual !== null && usual >= snapshot.today.dailyLimit * 4 && nextPayday > now) {
    await scheduleAt(
      PAYDAY_ID,
      {
        type: 'HEADS_UP',
        tier: 'PAYDAY',
        title: TITLES.HEADS_UP,
        body: roast('PAYDAY', t, { average: usual }),
      },
      nextPayday
    );
  } else {
    await cancelScheduled(PAYDAY_ID);
  }
}
