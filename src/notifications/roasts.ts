import { formatMoney } from '../utils/format';
import { pickMessage } from './messages';

/**
 * Reprimands (0.9.19, docs/INTERVENTIONS.md). The user asked for active
 * reprimands, savage by default — which overrides the "funnier, not meaner"
 * rule in messages.ts for these lines only.
 *
 * Rules the savage lines still keep:
 *   - roast the spending, never the person: no looks, brains, family or worth
 *   - the number is always in the line
 *   - good news is never savage (recovery done stays warm)
 *
 * Every line has a firm twin, used when "Roast me" is switched off in Settings.
 */

export type Tone = 'SAVAGE' | 'FIRM';

export interface RoastContext {
  amount?: number;
  merchant?: string;
  label?: string;
  count?: number;
  total?: number;
  usual?: number;
  cap?: number;
  overBy?: number;
  target?: number;
  days?: number;
  dayNumber?: number;
  window?: string;
  average?: number;
  leftToday?: number;
  goalName?: string;
}

type Line = (c: RoastContext) => string;
const m = (v: number | undefined) => formatMoney(Math.abs(Math.round(v ?? 0)));

export type RoastKind =
  | 'OVERSPEND'
  | 'RECOVERY_START'
  | 'RECOVERY_SLIP'
  | 'RECOVERY_DONE'
  | 'RECOVERY_FAILED'
  | 'CALLOUT'
  | 'CAP_NEAR'
  | 'CAP_BROKEN'
  | 'HEADS_UP'
  | 'PAYDAY';

const LINES: Record<RoastKind, Record<Tone, Line[]>> = {
  OVERSPEND: {
    SAVAGE: [
      (c) => `${m(c.overBy)} over today. the budget didn't break, you just walked through it`,
      (c) =>
        `${m(c.amount)} at ${c.merchant} and now you're ${m(c.overBy)} over. was it at least good?`,
      (c) => `today's limit has left the chat. you're ${m(c.overBy)} past it 💀`,
      (c) =>
        c.goalName
          ? `${m(c.overBy)} over today. ${c.goalName} just got further away, hope ${c.merchant} was worth it`
          : `${m(c.overBy)} over today. future you is sending a strongly worded letter`,
    ],
    FIRM: [
      (c) => `${m(c.overBy)} over today's limit. recovery starts tomorrow`,
      (c) => `${m(c.amount)} at ${c.merchant} put you ${m(c.overBy)} over. stop here for today`,
    ],
  },
  RECOVERY_START: {
    SAVAGE: [
      (c) => `recovery mode: ${c.days} days at ${m(c.target)}. you did this, you fix it`,
      (c) => `the damage: ${m(c.overBy)}. the sentence: ${c.days} days at ${m(c.target)} a day`,
    ],
    FIRM: [(c) => `recovery: ${c.days} days at ${m(c.target)} gets you back on track`],
  },
  RECOVERY_SLIP: {
    SAVAGE: [
      (c) => `day ${c.dayNumber} of recovery and you're already past ${m(c.target)}. bold`,
      (c) => `${m(c.amount)} at ${c.merchant}. in RECOVERY. the audacity 💀`,
      (c) => `recovery said ${m(c.target)}. you said "${c.merchant}". one spare day left, maybe`,
    ],
    FIRM: [(c) => `that's over today's recovery number of ${m(c.target)}. this day won't count`],
  },
  RECOVERY_DONE: {
    SAVAGE: [(c) => `recovered. ${m(c.overBy)} paid back. back to normal, try to stay there`],
    FIRM: [(c) => `recovered: ${m(c.overBy)} paid back. your normal limit is back`],
  },
  RECOVERY_FAILED: {
    SAVAGE: [
      (c) =>
        `recovery failed. the ${m(c.overBy)} is now spread over the rest of the month. congrats, everyone pays`,
      () => `the recovery mission did not survive contact with you. the whole month absorbs it now`,
    ],
    FIRM: [
      (c) => `recovery didn't hold. the ${m(c.overBy)} is now spread across the rest of the month`,
    ],
  },
  CALLOUT: {
    SAVAGE: [
      (c) =>
        c.usual && c.usual > 0
          ? `${ordinal(c.count)} ${c.label} this week. ${m(c.total)}. that's ${ratio(c.total, c.usual)} your usual. are they paying you rent?`
          : `${ordinal(c.count)} ${c.label} this week, ${m(c.total)}. new habit just dropped`,
      (c) =>
        `${c.label}: ${c.count} times, ${m(c.total)} this week. at this point it's a subscription`,
    ],
    FIRM: [
      (c) =>
        c.usual && c.usual > 0
          ? `${c.label}: ${c.count} times this week, ${m(c.total)}, about ${ratio(c.total, c.usual)} your usual`
          : `${c.label}: ${c.count} times this week, ${m(c.total)}`,
    ],
  },
  CAP_NEAR: {
    SAVAGE: [
      (c) => `${c.label}: ${m(c.total)} of your ${m(c.cap)} cap. one more and we're having words`,
      (c) => `80% of the ${c.label} cap gone and it's not even the weekend. pace yourself`,
    ],
    FIRM: [(c) => `${c.label}: ${m(c.total)} of ${m(c.cap)} this week`],
  },
  CAP_BROKEN: {
    SAVAGE: [
      (c) =>
        `you set a ${m(c.cap)} cap on ${c.label}. you're at ${m(c.total)}. the cap was a suggestion, apparently`,
      (c) => `${c.label} cap: broken. ${m(c.total)} against ${m(c.cap)}. past you is disappointed`,
      (c) =>
        `${m(c.amount)} more at ${c.label}. that's ${m((c.total ?? 0) - (c.cap ?? 0))} past the cap you made yourself`,
    ],
    FIRM: [(c) => `${c.label} is past its ${m(c.cap)} weekly cap: ${m(c.total)} so far`],
  },
  HEADS_UP: {
    SAVAGE: [
      (c) =>
        `${c.window} cost you ${m(c.average)} on average. a whole day's budget is ${m(c.leftToday)}. choose violence carefully`,
      (c) => `${c.window} are coming. historically that's ${m(c.average)} gone. not this time`,
    ],
    FIRM: [
      (c) =>
        `heads up: ${c.window} usually cost ${m(c.average)}. a day's budget is ${m(c.leftToday)}`,
    ],
  },
  PAYDAY: {
    SAVAGE: [
      (c) =>
        `payday. last time the first 3 days ate ${m(c.average)}. the money is not going anywhere, stay calm`,
      (c) =>
        `fresh money. last month you spent ${m(c.average)} in 3 days flat. let's not speedrun it again`,
    ],
    FIRM: [(c) => `payday. the first 3 days usually take ${m(c.average)}. go slow`],
  },
};

function ordinal(n: number | undefined): string {
  const v = n ?? 0;
  const s = v % 100 >= 11 && v % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][v % 10] ?? 'th');
  return `${v}${s}`;
}

function ratio(total: number | undefined, usual: number | undefined): string {
  const r = (total ?? 0) / Math.max(1, usual ?? 1);
  if (r >= 1.9 && r < 2.25) return 'double';
  if (r >= 2.75 && r < 3.25) return 'triple';
  return `${r.toFixed(1)}×`;
}

export function roast(
  kind: RoastKind,
  tone: Tone,
  ctx: RoastContext,
  recent: string[] = [],
  random?: () => number
): string {
  return pickMessage(LINES[kind][tone], ctx, recent, random);
}

/** Every line, for the test that checks none of them mentions the person. */
export function allLines(ctx: RoastContext): string[] {
  return Object.values(LINES).flatMap((byTone) =>
    Object.values(byTone).flatMap((lines) => lines.map((l) => l(ctx)))
  );
}
