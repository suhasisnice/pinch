import { formatMoney } from '../utils/format';

/**
 * The voice of the app.
 *
 * Rules the copy follows, because a budgeting app that scolds you gets muted
 * within a week:
 *   - lowercase, conversational, never corporate
 *   - the number is always in there — a joke with no data is noise
 *   - it gets funnier as things get worse, not meaner. The app is on your
 *     side even at 200% of the daily limit
 *   - one emoji, at the end, or none
 */

export type NotificationType =
  | 'TXN_PULSE'
  | 'SPLIT_PROMPT'
  | 'OVERSPEND'
  | 'GOAL_MILESTONE'
  | 'STREAK'
  | 'SETTLE_REMINDER'
  | 'DAY_RESET';

export type Tier = 'FRESH' | 'STEADY' | 'CLOSE' | 'OVER' | 'WRECKED';

export interface MessageContext {
  amount?: number;
  merchant?: string;
  remainingToday?: number;
  dailyLimit?: number;
  spentToday?: number;
  overBy?: number;
  goalName?: string;
  goalEmoji?: string;
  goalDelayDays?: number;
  contactName?: string;
  days?: number;
  percent?: number;
  peopleCount?: number;
}

type Template = (ctx: MessageContext) => string;

const money = (value: number | undefined) => formatMoney(Math.abs(value ?? 0));

// ---------------------------------------------------------------------------
// Per-transaction pulse — the "visualise the daily limit" nudge.
// Fires on every captured spend, so these have to stay light.
// ---------------------------------------------------------------------------

const PULSE: Record<Tier, Template[]> = {
  FRESH: [
    (c) => `${money(c.amount)} at ${c.merchant}. still ${money(c.remainingToday)} to play with today 💸`,
    (c) => `noted: ${money(c.amount)}. today's budget is barely dented — ${money(c.remainingToday)} left`,
    (c) => `${money(c.amount)} gone, ${money(c.remainingToday)} to go. we're chilling`,
  ],
  STEADY: [
    (c) => `${money(c.amount)} at ${c.merchant} → ${money(c.remainingToday)} left today`,
    (c) => `that's ${money(c.spentToday)} today. ${money(c.remainingToday)} still yours`,
    (c) => `${money(c.amount)} down. you've got ${money(c.remainingToday)} before today's cap`,
  ],
  CLOSE: [
    (c) => `${money(c.amount)} at ${c.merchant}. only ${money(c.remainingToday)} left today — pace yourself 🫡`,
    (c) => `you're at ${c.percent}% of today's limit. ${money(c.remainingToday)} to last till midnight`,
    (c) => `${money(c.remainingToday)} left today. it's giving "cook at home" energy`,
  ],
  OVER: [
    (c) => `bestie. you're ${money(c.overBy)} over today's limit 😭`,
    (c) => `${money(c.amount)} at ${c.merchant} pushed you ${money(c.overBy)} past today. it happens`,
    (c) => `today's cap: gone. you're ${money(c.overBy)} deep. tomorrow's a new number`,
  ],
  WRECKED: [
    (c) => `${money(c.spentToday)} today against a ${money(c.dailyLimit)} limit. bold strategy 💀`,
    (c) => `no bc what happened today — ${money(c.overBy)} over 💀`,
    (c) => `the way you looked at today's budget and said "nah" 💀`,
  ],
};

// ---------------------------------------------------------------------------
// Split prompt — fires on a larger spend at somewhere social.
// ---------------------------------------------------------------------------

const SPLIT: Template[] = [
  (c) => `${money(c.amount)} at ${c.merchant}. splitting this with anyone? 👀`,
  (c) => `${money(c.amount)} at ${c.merchant} — did you cover for the group again?`,
  (c) => `that ${money(c.amount)} at ${c.merchant} looks like a group activity. tap to split`,
  (c) => `paying for everyone at ${c.merchant} again? let's get that ${money(c.amount)} back`,
];

// ---------------------------------------------------------------------------
// Overspend warning — the standalone alert, distinct from the pulse.
// ---------------------------------------------------------------------------

const OVERSPEND: Record<'MILD' | 'BAD' | 'DIRE', Template[]> = {
  MILD: [
    (c) => `you're ${money(c.overBy)} over today. not the end of the world — just ease up tomorrow`,
    (c) => `${money(c.overBy)} past the line today. we move`,
  ],
  BAD: [
    (c) => `${money(c.overBy)} over today, and that's the 2nd time this week. checking in 🫤`,
    (c) => `today cost you ${money(c.overBy)} extra. your daily limit just dropped to ${money(c.dailyLimit)}`,
  ],
  DIRE: [
    (c) => `you've spent ${money(c.spentToday)} today. the rest of the month is now ${money(c.dailyLimit)}/day 😬`,
    (c) => `real talk: at this rate you're broke in ${c.days} days`,
    (c) => `${money(c.overBy)} over. ${c.goalName ? `${c.goalName} is the one paying for this` : 'this is future-you\'s problem now'} 💀`,
  ],
};

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

const GOAL_MILESTONE: Template[] = [
  (c) => `${c.goalEmoji} ${c.goalName} is ${c.percent}% funded. you're actually doing it`,
  (c) => `${c.percent}% of the way to ${c.goalName} ${c.goalEmoji}`,
  (c) => `${c.goalName}: ${c.percent}% down. ${money(c.amount)} to go ${c.goalEmoji}`,
];

const GOAL_COMPLETE: Template[] = [
  (c) => `${c.goalEmoji} ${c.goalName} is FULLY FUNDED. go get it`,
  (c) => `you did it. ${c.goalName} is paid for ${c.goalEmoji}`,
];

const GOAL_AT_RISK: Template[] = [
  (c) => `heads up — today's spending pushed ${c.goalName} back by ${c.goalDelayDays} days`,
  (c) => `${c.goalName} ${c.goalEmoji} is slipping. ${money(c.amount)} still needed and the deadline isn't moving`,
];

// ---------------------------------------------------------------------------
// Streaks and settle reminders
// ---------------------------------------------------------------------------

const STREAK: Template[] = [
  (c) => `${c.days} days under budget. you're being so financially responsible rn 💅`,
  (c) => `${c.days}-day streak. quietly iconic`,
  (c) => `${c.days} days in a row under the limit. saving ${money(c.amount)} so far`,
];

const SETTLE_REMINDER: Template[] = [
  (c) => `${c.contactName} has owed you ${money(c.amount)} for ${c.days} days. nudge them?`,
  (c) => `${money(c.amount)} from ${c.contactName}, still pending after ${c.days} days 👀`,
  (c) => `gentle reminder that ${c.contactName} owes you ${money(c.amount)}. it's been ${c.days} days`,
];

const DAY_RESET: Template[] = [
  (c) => `new day, ${money(c.dailyLimit)} to work with`,
  (c) => `today's number: ${money(c.dailyLimit)}. ${c.days} days left in the period`,
  (c) => `${money(c.dailyLimit)} for today. make it count`,
];

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------

/**
 * Chooses a line, avoiding anything in `recentBodies` so the same joke does
 * not land twice in a row. Falls back to the full set once every option has
 * been used recently. `random` is injectable so tests are deterministic.
 */
export function pickMessage(
  templates: Template[],
  ctx: MessageContext,
  recentBodies: string[] = [],
  random: () => number = Math.random
): string {
  if (templates.length === 0) return '';

  const rendered = templates.map((template) => template(ctx));
  const unused = rendered.filter((body) => !recentBodies.includes(body));
  const pool = unused.length > 0 ? unused : rendered;

  return pool[Math.floor(random() * pool.length) % pool.length];
}

export function pulseMessage(
  tier: Tier,
  ctx: MessageContext,
  recentBodies: string[] = [],
  random?: () => number
): string {
  return pickMessage(PULSE[tier], ctx, recentBodies, random);
}

export function splitPromptMessage(
  ctx: MessageContext,
  recentBodies: string[] = [],
  random?: () => number
): string {
  return pickMessage(SPLIT, ctx, recentBodies, random);
}

export function overspendMessage(
  severity: 'MILD' | 'BAD' | 'DIRE',
  ctx: MessageContext,
  recentBodies: string[] = [],
  random?: () => number
): string {
  return pickMessage(OVERSPEND[severity], ctx, recentBodies, random);
}

export function goalMessage(
  kind: 'MILESTONE' | 'COMPLETE' | 'AT_RISK',
  ctx: MessageContext,
  recentBodies: string[] = [],
  random?: () => number
): string {
  const bank =
    kind === 'COMPLETE' ? GOAL_COMPLETE : kind === 'AT_RISK' ? GOAL_AT_RISK : GOAL_MILESTONE;
  return pickMessage(bank, ctx, recentBodies, random);
}

export function streakMessage(
  ctx: MessageContext,
  recentBodies: string[] = [],
  random?: () => number
): string {
  return pickMessage(STREAK, ctx, recentBodies, random);
}

export function settleReminderMessage(
  ctx: MessageContext,
  recentBodies: string[] = [],
  random?: () => number
): string {
  return pickMessage(SETTLE_REMINDER, ctx, recentBodies, random);
}

export function dayResetMessage(
  ctx: MessageContext,
  recentBodies: string[] = [],
  random?: () => number
): string {
  return pickMessage(DAY_RESET, ctx, recentBodies, random);
}

/** Short titles. The body carries the personality; the title carries the fact. */
export const TITLES: Record<NotificationType, string> = {
  TXN_PULSE: 'Pinch',
  SPLIT_PROMPT: 'Split this?',
  OVERSPEND: 'Over the line',
  GOAL_MILESTONE: 'Goal update',
  STREAK: 'Streak',
  SETTLE_REMINDER: 'Someone owes you',
  DAY_RESET: 'New day',
};
