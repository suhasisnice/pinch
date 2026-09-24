import { BudgetBreakdown, TodayStatus, daysUntilBroke } from '../math/budget';
import {
  MessageContext,
  NotificationType,
  TITLES,
  Tier,
  goalMessage,
  overspendMessage,
  pulseMessage,
  settleReminderMessage,
  splitPromptMessage,
  streakMessage,
} from './messages';
import { roast } from './roasts';

export interface PlannedNotification {
  type: NotificationType;
  tier: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

export interface NotificationSettings {
  enabled: boolean;
  pulseEnabled: boolean;
  splitPromptsEnabled: boolean;
  overspendEnabled: boolean;
  goalsEnabled: boolean;
  streaksEnabled: boolean;
  settleRemindersEnabled: boolean;
  /** Local hour (0-23) when quiet time starts. */
  quietStartHour: number;
  /** Local hour (0-23) when quiet time ends. */
  quietEndHour: number;
  /** Hard ceiling across every type. */
  maxPerDay: number;
  /** A spend at or above this, in a social category, offers a split. */
  splitPromptThreshold: number;
  /**
   * Hold every captured payment for confirmation instead of logging it
   * outright. Nothing is lost either way - an unanswered one waits in
   * Review exactly like a low-confidence parse - but with this on, the
   * budget does not move until the payment is confirmed.
   */
  confirmBeforeLogging: boolean;
  /** Ask for a category when a logged payment could not be given one. */
  categoryPromptsEnabled: boolean;
  /**
   * Reprimands in the savage voice (0.9.19, the user's choice). Off falls
   * back to the firm lines — same facts, no roast.
   */
  roastMe: boolean;
  /** Recovery missions, callouts and cap warnings (docs/INTERVENTIONS.md). */
  interventionsEnabled: boolean;
  /** Heads-ups before a risky window and on payday. */
  headsUpEnabled: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  pulseEnabled: true,
  splitPromptsEnabled: true,
  overspendEnabled: true,
  goalsEnabled: true,
  streaksEnabled: true,
  settleRemindersEnabled: true,
  quietStartHour: 23,
  quietEndHour: 8,
  maxPerDay: 12,
  splitPromptThreshold: 300,
  confirmBeforeLogging: true,
  categoryPromptsEnabled: true,
  roastMe: true,
  interventionsEnabled: true,
  headsUpEnabled: true,
};

/** Per-type caps and cooldowns. A nudge that fires too often becomes wallpaper. */
const LIMITS: Record<NotificationType, { maxPerDay: number; cooldownMinutes: number }> = {
  TXN_PULSE: { maxPerDay: 8, cooldownMinutes: 3 },
  SPLIT_PROMPT: { maxPerDay: 3, cooldownMinutes: 10 },
  OVERSPEND: { maxPerDay: 2, cooldownMinutes: 180 },
  GOAL_MILESTONE: { maxPerDay: 3, cooldownMinutes: 60 },
  STREAK: { maxPerDay: 1, cooldownMinutes: 720 },
  SETTLE_REMINDER: { maxPerDay: 1, cooldownMinutes: 1440 },
  DAY_RESET: { maxPerDay: 1, cooldownMinutes: 720 },
  // Neither is a nudge - one gates a payment from counting at all, the
  // other is the only prompt that will ever ask about that transaction.
  // Rate-limiting them would silently drop real work on a busy day.
  TXN_CONFIRM: { maxPerDay: Number.MAX_SAFE_INTEGER, cooldownMinutes: 0 },
  CATEGORY_PROMPT: { maxPerDay: Number.MAX_SAFE_INTEGER, cooldownMinutes: 0 },
  // Interventions (0.9.19). Each is also de-duplicated by what it is about
  // (interventionService's log), so these are only a ceiling.
  RECOVERY: { maxPerDay: 2, cooldownMinutes: 0 },
  CAP: { maxPerDay: 4, cooldownMinutes: 0 },
  CALLOUT: { maxPerDay: 2, cooldownMinutes: 60 },
  HEADS_UP: { maxPerDay: 2, cooldownMinutes: 0 },
};

/** Categories where paying for the group is the norm. */
const SOCIAL_CATEGORIES = new Set(['Food', 'Outing']);

export interface DeliveryHistory {
  /** Count already sent today, per type. */
  sentTodayByType: Partial<Record<NotificationType, number>>;
  /** ISO timestamp of the last send, per type. */
  lastSentAt: Partial<Record<NotificationType, string | null>>;
  /** Recently used bodies, per type, so the copy picker can avoid repeats. */
  recentBodies: Partial<Record<NotificationType, string[]>>;
  /** Total sent today across all types. */
  totalSentToday: number;
}

export const EMPTY_HISTORY: DeliveryHistory = {
  sentTodayByType: {},
  lastSentAt: {},
  recentBodies: {},
  totalSentToday: 0,
};

/**
 * Quiet hours, handling the usual wrap past midnight (23:00 -> 08:00).
 */
export function isQuietHour(now: Date, settings: NotificationSettings): boolean {
  const hour = now.getHours();
  const { quietStartHour: start, quietEndHour: end } = settings;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function canSend(
  type: NotificationType,
  now: Date,
  history: DeliveryHistory,
  settings: NotificationSettings
): boolean {
  if (!settings.enabled) return false;
  if (history.totalSentToday >= settings.maxPerDay) return false;

  const limit = LIMITS[type];
  if ((history.sentTodayByType[type] ?? 0) >= limit.maxPerDay) return false;

  const last = history.lastSentAt[type];
  if (last) {
    const elapsedMinutes = (now.getTime() - new Date(last).getTime()) / 60000;
    if (elapsedMinutes < limit.cooldownMinutes) return false;
  }

  return true;
}

function tierForToday(today: TodayStatus): Tier {
  if (today.usedFraction >= 1.5) return 'WRECKED';
  if (today.usedFraction >= 1) return 'OVER';
  if (today.usedFraction >= 0.8) return 'CLOSE';
  if (today.usedFraction >= 0.3) return 'STEADY';
  return 'FRESH';
}

export interface TransactionEventContext {
  now: Date;
  transactionId: number;
  amount: number;
  merchant: string;
  category: string | null;
  /** Whether this spend already has IOUs attached. */
  alreadySplit: boolean;
  today: TodayStatus;
  budget: BudgetBreakdown;
  /** Consecutive days finishing under the daily limit. */
  streakDays: number;
  goalsCrossed: Array<{ name: string; emoji: string; percent: number; remaining: number }>;
  avgDailyBurn: number;
  history: DeliveryHistory;
  settings: NotificationSettings;
  random?: () => number;
}

/**
 * Decides what to fire after a transaction lands.
 *
 * Ordered by importance and capped by the daily ceiling, so when several
 * things are true at once the user gets the one that matters rather than four
 * buzzes in a row. Quiet hours suppress everything except nothing — no
 * notification is urgent enough to wake someone up over a coffee.
 */
export function planForTransaction(ctx: TransactionEventContext): PlannedNotification[] {
  const { now, settings, history } = ctx;
  if (!settings.enabled || isQuietHour(now, settings)) return [];

  const planned: PlannedNotification[] = [];
  // Local copy so several notifications in one batch respect the daily cap.
  const running: DeliveryHistory = {
    ...history,
    sentTodayByType: { ...history.sentTodayByType },
    lastSentAt: { ...history.lastSentAt },
  };

  const take = (
    type: NotificationType,
    tier: string,
    body: string,
    payload?: Record<string, unknown>
  ) => {
    if (!body) return;
    if (!canSend(type, now, running, settings)) return;
    planned.push({ type, tier, title: TITLES[type], body, payload });
    running.sentTodayByType[type] = (running.sentTodayByType[type] ?? 0) + 1;
    running.lastSentAt[type] = now.toISOString();
    running.totalSentToday += 1;
  };

  const base: MessageContext = {
    amount: ctx.amount,
    merchant: ctx.merchant,
    remainingToday: Math.max(0, ctx.today.remainingToday),
    dailyLimit: ctx.today.dailyLimit,
    spentToday: ctx.today.spentToday,
    overBy: Math.max(0, -ctx.today.remainingToday),
    percent: Math.round(ctx.today.usedFraction * 100),
    days: daysUntilBroke(ctx.budget.spendablePool, ctx.avgDailyBurn) ?? 0,
  };

  // 1. Overspend warning takes priority over the routine pulse — they would
  //    otherwise say the same thing twice with different wording.
  const isOver = ctx.today.usedFraction >= 1;
  if (isOver && settings.overspendEnabled) {
    const severity =
      ctx.today.usedFraction >= 1.5 ? 'DIRE' : ctx.today.usedFraction >= 1.2 ? 'BAD' : 'MILD';
    const goal = ctx.goalsCrossed[0];
    const recent = history.recentBodies.OVERSPEND ?? [];
    take(
      'OVERSPEND',
      severity,
      // Savage by default (0.9.19, the user's choice); "Roast me" off keeps
      // the original, gentler lines.
      settings.roastMe
        ? roast(
            'OVERSPEND',
            'SAVAGE',
            {
              amount: ctx.amount,
              merchant: ctx.merchant,
              overBy: base.overBy,
              goalName: goal?.name,
            },
            recent,
            ctx.random
          )
        : overspendMessage(severity, { ...base, goalName: goal?.name }, recent, ctx.random),
      { transactionId: ctx.transactionId }
    );
  } else if (settings.pulseEnabled) {
    const tier = tierForToday(ctx.today);
    take(
      'TXN_PULSE',
      tier,
      pulseMessage(tier, base, history.recentBodies.TXN_PULSE ?? [], ctx.random),
      {
        transactionId: ctx.transactionId,
      }
    );
  }

  // 2. Split prompt — only where fronting for the group is plausible.
  const isSocial = ctx.category !== null && SOCIAL_CATEGORIES.has(ctx.category);
  if (
    settings.splitPromptsEnabled &&
    !ctx.alreadySplit &&
    ctx.amount >= settings.splitPromptThreshold &&
    (isSocial || ctx.category === null)
  ) {
    take(
      'SPLIT_PROMPT',
      'PROMPT',
      splitPromptMessage(base, history.recentBodies.SPLIT_PROMPT ?? [], ctx.random),
      { transactionId: ctx.transactionId, amount: ctx.amount, merchant: ctx.merchant }
    );
  }

  // 3. Goal milestones crossed by this spend's round-up.
  if (settings.goalsEnabled) {
    for (const goal of ctx.goalsCrossed) {
      const kind = goal.percent >= 100 ? 'COMPLETE' : 'MILESTONE';
      take(
        'GOAL_MILESTONE',
        kind,
        goalMessage(
          kind,
          {
            goalName: goal.name,
            goalEmoji: goal.emoji,
            percent: goal.percent,
            amount: goal.remaining,
          },
          history.recentBodies.GOAL_MILESTONE ?? [],
          ctx.random
        ),
        { goalName: goal.name }
      );
    }
  }

  // 4. Streak, only on the milestone days worth celebrating.
  if (settings.streaksEnabled && [3, 7, 14, 30, 60, 100].includes(ctx.streakDays)) {
    take(
      'STREAK',
      String(ctx.streakDays),
      streakMessage(
        { days: ctx.streakDays, amount: ctx.budget.spendablePool },
        history.recentBodies.STREAK ?? [],
        ctx.random
      ),
      { streakDays: ctx.streakDays }
    );
  }

  return planned;
}

export interface SettleReminderContext {
  now: Date;
  contactName: string;
  amount: number;
  daysOutstanding: number;
  history: DeliveryHistory;
  settings: NotificationSettings;
  random?: () => number;
}

/** Nudges about an aging debt. Only for debts old enough to be worth raising. */
export function planSettleReminder(ctx: SettleReminderContext): PlannedNotification | null {
  if (!ctx.settings.enabled || !ctx.settings.settleRemindersEnabled) return null;
  if (isQuietHour(ctx.now, ctx.settings)) return null;
  if (ctx.daysOutstanding < 5) return null;
  if (!canSend('SETTLE_REMINDER', ctx.now, ctx.history, ctx.settings)) return null;

  const body = settleReminderMessage(
    { contactName: ctx.contactName, amount: ctx.amount, days: ctx.daysOutstanding },
    ctx.history.recentBodies.SETTLE_REMINDER ?? [],
    ctx.random
  );
  if (!body) return null;

  return {
    type: 'SETTLE_REMINDER',
    tier: 'AGING',
    title: TITLES.SETTLE_REMINDER,
    body,
    payload: { contactName: ctx.contactName, amount: ctx.amount },
  };
}
