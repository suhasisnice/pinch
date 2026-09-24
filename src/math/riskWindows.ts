/**
 * Warn before, not after (0.9.19, docs/INTERVENTIONS.md §3).
 *
 * Spending is lumpy in time: the same few evenings of the week do most of
 * the damage. Those windows are learned from the last eight weeks, and a
 * heads-up goes out an hour before the next one opens — the one moment a
 * warning can still change anything.
 */

export type Block = 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT';

/** Start hour of each block. NIGHT runs past midnight and belongs to the day it began. */
export const BLOCK_START: Record<Block, number> = {
  MORNING: 6,
  AFTERNOON: 12,
  EVENING: 17,
  NIGHT: 21,
};
const BLOCKS: Block[] = ['MORNING', 'AFTERNOON', 'EVENING', 'NIGHT'];

export const LOOKBACK_WEEKS = 8;
export const RISK_RATIO = 1.5;
export const RISK_MIN_AVERAGE = 250;
/** A window must have cost something in at least this many separate weeks. */
export const RISK_MIN_WEEKS = 3;
export const MAX_WINDOWS = 2;
/** How long before a window opens the heads-up arrives. */
export const LEAD_MINUTES = 60;

export interface TimedSpend {
  at: Date;
  amount: number;
}

export interface RiskWindow {
  /** 0 = Sunday … 6 = Saturday, as Date#getDay. */
  weekday: number;
  block: Block;
  /** Average spend in this window, per week. */
  average: number;
}

/** Which weekday and block a moment belongs to (00:00–05:59 is the previous day's night). */
export function windowOf(at: Date): { weekday: number; block: Block } {
  const h = at.getHours();
  if (h < BLOCK_START.MORNING) {
    return { weekday: (at.getDay() + 6) % 7, block: 'NIGHT' };
  }
  const block =
    h >= BLOCK_START.NIGHT
      ? 'NIGHT'
      : h >= BLOCK_START.EVENING
        ? 'EVENING'
        : h >= BLOCK_START.AFTERNOON
          ? 'AFTERNOON'
          : 'MORNING';
  return { weekday: at.getDay(), block };
}

function weekIndex(at: Date, now: Date): number {
  return Math.floor((now.getTime() - at.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

export function findRiskWindows(spends: TimedSpend[], now: Date): RiskWindow[] {
  const totals = new Map<string, { total: number; weeks: Set<number> }>();
  let all = 0;
  for (const s of spends) {
    const age = weekIndex(s.at, now);
    if (s.amount <= 0 || age < 0 || age >= LOOKBACK_WEEKS) continue;
    const w = windowOf(s.at);
    const key = `${w.weekday}:${w.block}`;
    const t = totals.get(key) ?? { total: 0, weeks: new Set<number>() };
    t.total += s.amount;
    t.weeks.add(age);
    totals.set(key, t);
    all += s.amount;
  }

  const typical = all / (7 * BLOCKS.length * LOOKBACK_WEEKS);
  const out: RiskWindow[] = [];
  for (const [key, t] of totals) {
    const average = t.total / LOOKBACK_WEEKS;
    if (t.weeks.size < RISK_MIN_WEEKS) continue;
    if (average < Math.max(RISK_MIN_AVERAGE, typical * RISK_RATIO)) continue;
    const [weekday, block] = key.split(':');
    out.push({ weekday: Number(weekday), block: block as Block, average });
  }
  return out.sort((a, b) => b.average - a.average).slice(0, MAX_WINDOWS);
}

/** The next moment, after `now`, to warn about this window. */
export function nextWarningAt(window: RiskWindow, now: Date): Date {
  for (let add = 0; add <= 7; add++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add);
    if (day.getDay() !== window.weekday) continue;
    const at = new Date(day);
    at.setHours(BLOCK_START[window.block], 0, 0, 0);
    at.setMinutes(at.getMinutes() - LEAD_MINUTES);
    if (at > now) return at;
  }
  // Same weekday, next week.
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  at.setHours(BLOCK_START[window.block], 0, 0, 0);
  at.setMinutes(at.getMinutes() - LEAD_MINUTES);
  return at;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const BLOCK_NAMES: Record<Block, string> = {
  MORNING: 'mornings',
  AFTERNOON: 'afternoons',
  EVENING: 'evenings',
  NIGHT: 'nights',
};

/** "Friday nights" */
export function windowName(window: Pick<RiskWindow, 'weekday' | 'block'>): string {
  return `${DAY_NAMES[window.weekday]} ${BLOCK_NAMES[window.block]}`;
}

/** What the first `days` days after a payday usually cost, from past periods' starts. */
export function afterPaydaySpend(spends: TimedSpend[], paydays: Date[], days = 3): number | null {
  const totals = paydays.map((start) => {
    const end = start.getTime() + days * 24 * 60 * 60 * 1000;
    return spends
      .filter((s) => s.at.getTime() >= start.getTime() && s.at.getTime() < end)
      .reduce((sum, s) => sum + s.amount, 0);
  });
  if (totals.length === 0) return null;
  return totals.reduce((a, b) => a + b, 0) / totals.length;
}
