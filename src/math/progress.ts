/**
 * Progress: the numbers that make a habit feel like it is working.
 * Pure functions — the service gathers the rows.
 */
import { projectValue } from './wealth';

// ---------------------------------------------------------------------------
// Net worth
// ---------------------------------------------------------------------------

/**
 * Everything you own minus everything you owe, as far as Pinch can see.
 *
 * Goals and the cushion are deliberately NOT added: they are labels on money
 * already inside the bank balance, and adding them again would count the
 * same rupees twice. Investments are outside the bank, so they are added —
 * at the value the user typed in, or what went in. Money friends owe you is
 * yours; money you owe friends is not.
 *
 * Null without a bank balance: an estimate built on a guessed balance would
 * be the fabricated number this app refuses to show.
 */
export function netWorth(input: {
  bank: number | null;
  investments: number;
  owedToYou: number;
  youOwe: number;
}): number | null {
  if (input.bank === null) return null;
  return input.bank + input.investments + input.owedToYou - input.youOwe;
}

// ---------------------------------------------------------------------------
// The saving habit
// ---------------------------------------------------------------------------

/** Kept as a share of what came in. 0 when nothing came in. */
export function keptRate(kept: number, cameIn: number): number {
  if (!(cameIn > 0)) return 0;
  return kept / cameIn;
}

/** A period counts toward the habit at 10% kept or more. */
export const HABIT_RATE = 0.1;

/** Consecutive periods, most recent first, at or above the habit rate. */
export function habitStreak(ratesNewestFirst: number[]): number {
  let n = 0;
  for (const r of ratesNewestFirst) {
    if (r >= HABIT_RATE - 1e-9) n += 1;
    else break;
  }
  return n;
}

/** The one line under the habit bars. Kind, short, true. */
export function habitLine(rates: { rate: number }[]): string {
  if (rates.length === 0) return 'Your first month starts the record.';
  const now = rates[rates.length - 1].rate;
  const before = rates.length > 1 ? rates[rates.length - 2].rate : null;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (now <= 0.009) return 'Nothing kept yet this month. Payday is the easiest day to start.';
  if (before === null) return `${pct(now)} kept so far this month. A good start.`;
  if (now > before + 0.009)
    return `${pct(now)} kept, up from ${pct(before)}. That's the habit forming.`;
  if (now < before - 0.009)
    return `${pct(now)} kept, ${pct(before)} last month. Plenty of month left.`;
  return `${pct(now)} kept, same as last month. Steady is good.`;
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export interface MilestoneState {
  totalKept: number;
  cushionFraction: number | null;
  paydayDoneEver: boolean;
  habitStreak: number;
  putIn: number;
  netWorth: number | null;
}

export interface MilestoneDef {
  key: string;
  title: string;
  reached: (s: MilestoneState) => boolean;
  /** "₹4,500 to go" — only for the ones that can say it. */
  toGo?: (s: MilestoneState) => number | null;
}

const netWorthMilestone = (amount: number, label: string): MilestoneDef => ({
  key: `NW_${amount}`,
  title: `Net worth ${label}`,
  reached: (s) => s.netWorth !== null && s.netWorth >= amount,
  toGo: (s) => (s.netWorth === null ? null : Math.max(0, amount - s.netWorth)),
});

/** In the order a student usually meets them. */
export const MILESTONES: MilestoneDef[] = [
  {
    key: 'FIRST_1K',
    title: 'First ₹1,000 kept',
    reached: (s) => s.totalKept >= 1000,
    toGo: (s) => Math.max(0, 1000 - s.totalKept),
  },
  { key: 'FIRST_PAYDAY', title: 'Paid yourself first', reached: (s) => s.paydayDoneEver },
  {
    key: 'CUSHION_HALF',
    title: 'Cushion half full',
    reached: (s) => (s.cushionFraction ?? 0) >= 0.5,
  },
  { key: 'CUSHION_FULL', title: 'Cushion full', reached: (s) => (s.cushionFraction ?? 0) >= 0.999 },
  { key: 'HABIT_3', title: 'Three months of keeping 10%', reached: (s) => s.habitStreak >= 3 },
  { key: 'FIRST_INVEST', title: 'First money invested', reached: (s) => s.putIn > 0.009 },
  netWorthMilestone(25_000, '₹25,000'),
  netWorthMilestone(50_000, '₹50,000'),
  netWorthMilestone(100_000, '₹1 lakh'),
  netWorthMilestone(500_000, '₹5 lakh'),
];

export function reachedMilestones(state: MilestoneState): string[] {
  return MILESTONES.filter((m) => m.reached(state)).map((m) => m.key);
}

/** The first one not yet reached, in list order — the next thing to aim at. */
export function nextMilestone(
  state: MilestoneState,
  achieved: Set<string>
): { title: string; toGo: number | null } | null {
  const next = MILESTONES.find((m) => !achieved.has(m.key) && !m.reached(state));
  if (!next) return null;
  return { title: next.title, toGo: next.toGo ? next.toGo(state) : null };
}

export function milestoneTitle(key: string): string {
  return MILESTONES.find((m) => m.key === key)?.title ?? key;
}

// ---------------------------------------------------------------------------
// The one insight that changes a habit
// ---------------------------------------------------------------------------

/**
 * Spending a student chooses week to week, as opposed to fees, rent, bills,
 * travel to college and health — trimming those is not a habit, it's hardship.
 */
const DISCRETIONARY = new Set([
  'Food',
  'Shopping',
  'Outing',
  'Subscriptions',
  'Entertainment',
  'Uncategorised',
]);

export interface HabitInsight {
  category: string;
  /** Monthly run-rate of the category. */
  monthly: number;
  /** A quarter of it, kept monthly. */
  trimmed: number;
  /** What that quarter becomes in ten years at the given rate. */
  tenYears: number;
}

/**
 * The biggest discretionary category, as a monthly figure, and what a
 * quarter of it would become if kept instead — the "₹60 chai a day is
 * ₹X in ten years" arithmetic, done on the user's own numbers rather than a
 * generic example, and never as a scold. Null when nothing is big enough to
 * be worth a sentence.
 */
export function habitInsight(
  categories: { category: string; total: number }[],
  daysElapsed: number,
  rate: number
): HabitInsight | null {
  if (daysElapsed < 5) return null; // too early in the month to extrapolate honestly
  const top = categories
    .filter((c) => DISCRETIONARY.has(c.category) && c.category !== 'Uncategorised')
    .sort((a, b) => b.total - a.total)[0];
  if (!top) return null;
  const monthly = (top.total / Math.max(1, daysElapsed)) * 30;
  if (monthly < 400) return null;
  const trimmed = Math.round((monthly * 0.25) / 10) * 10;
  return {
    category: top.category,
    monthly,
    trimmed,
    tenYears: projectValue(0, trimmed, rate, 10),
  };
}
