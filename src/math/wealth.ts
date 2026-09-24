/**
 * Wealth: the slow money. Pure functions only — the repo gathers the rows,
 * this decides what they mean.
 *
 * Two rules hold throughout, because the app is offline and is not an
 * adviser:
 *  - Nothing here knows what a fund is worth. A value is only ever one the
 *    user typed in; otherwise the honest figure is what was put in.
 *  - Nothing here picks what to buy. The ladder is about order (a cushion
 *    before risk, a habit before size, time before judgement), not products.
 */

// ---------------------------------------------------------------------------
// Holdings
// ---------------------------------------------------------------------------

export type HoldingKind = 'MUTUAL_FUND' | 'STOCKS' | 'FD' | 'GOLD' | 'RETIREMENT' | 'OTHER';

export const HOLDING_KINDS: { kind: HoldingKind; label: string }[] = [
  { kind: 'MUTUAL_FUND', label: 'Mutual fund' },
  { kind: 'STOCKS', label: 'Stocks' },
  { kind: 'FD', label: 'FD / RD' },
  { kind: 'GOLD', label: 'Gold' },
  { kind: 'RETIREMENT', label: 'PPF / NPS' },
  { kind: 'OTHER', label: 'Other' },
];

export function holdingKindLabel(kind: string): string {
  return HOLDING_KINDS.find((k) => k.kind === kind)?.label ?? 'Other';
}

/**
 * What a holding is worth as far as Pinch knows: the value the user last
 * typed in, or — never told — exactly what went in. Never a guess.
 */
export function holdingWorth(putIn: number, currentValue: number | null): number {
  return currentValue ?? putIn;
}

/** A value older than this is stale enough to ask about, gently. */
export const VALUE_STALE_DAYS = 45;

// ---------------------------------------------------------------------------
// Monthly plan (SIP) reserve
// ---------------------------------------------------------------------------

/**
 * How many times a day-of-month falls inside [start, end). Local calendar,
 * because "the 5th" means the 5th where the user is. Days are 1–28 by
 * schema, so every month has one.
 */
export function sipOccurrences(day: number, startIso: string, endIso: string): number {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (!(end > start)) return 0;

  let count = 0;
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor < end) {
    const due = new Date(cursor.getFullYear(), cursor.getMonth(), day);
    if (due >= start && due < end) count += 1;
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return count;
}

export interface SipPlanInput {
  amount: number;
  day: number;
  /** Money logged into this holding within the window (contributions only). */
  contributedInWindow: number;
}

/**
 * Money this period's monthly plans still lay claim to.
 *
 * A plan is an allocation, like a goal reserve: it holds money back from
 * spending until the contribution actually happens. At that point the
 * contribution is real cash leaving (see `investedNet` in the budget), and
 * the reserve for it drops by the same amount — so logging the SIP moves
 * nothing on Today, which is exactly right: the decision was made on the
 * day the plan was set, not the day the bank ran it.
 *
 * Never negative. Putting in more than planned does not free up budget.
 */
export function sipReserve(plans: SipPlanInput[], startIso: string, endIso: string): number {
  return plans.reduce((sum, plan) => {
    if (!(plan.amount > 0)) return sum;
    const due = plan.amount * sipOccurrences(plan.day, startIso, endIso);
    return sum + Math.max(0, due - Math.max(0, plan.contributedInWindow));
  }, 0);
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/** The default growth assumption. Deliberately unexciting. */
export const DEFAULT_RETURN_RATE = 0.1;
/** The cautious line shown beside it, so one number never reads as a promise. */
export const CAUTIOUS_RETURN_RATE = 0.06;

/**
 * Future value of what exists today plus a steady monthly amount, compounded
 * monthly at an annual rate. An illustration of patience, not a forecast.
 */
export function projectValue(
  today: number,
  monthly: number,
  annualRate: number,
  years: number
): number {
  const months = Math.max(0, Math.round(years * 12));
  if (months === 0) return today;
  const r = Math.pow(1 + annualRate, 1 / 12) - 1;
  if (Math.abs(r) < 1e-12) return today + monthly * months;
  const growth = Math.pow(1 + r, months);
  return today * growth + monthly * ((growth - 1) / r);
}

// ---------------------------------------------------------------------------
// The safety ladder
// ---------------------------------------------------------------------------

/** Months of allowance the cushion should hold. */
export const CUSHION_MONTHS = 3;
/** Distinct months with a contribution before the habit counts as a habit. */
export const HABIT_MONTHS = 3;
/** Months since the first contribution before time is on your side. */
export const TIME_MONTHS = 12;

export function cushionTarget(monthlyAllowance: number): number {
  return Math.max(0, monthlyAllowance) * CUSHION_MONTHS;
}

export interface LadderInput {
  cushionSaved: number;
  cushionTarget: number;
  /** Is any holding on a monthly plan? */
  hasPlan: boolean;
  /** Distinct calendar months with at least one contribution. */
  monthsContributed: number;
  /** Whole months since the first contribution; null if none yet. */
  monthsInvested: number | null;
}

export interface Ladder {
  cushion: { saved: number; target: number; fraction: number; done: boolean };
  habit: { months: number; hasPlan: boolean; done: boolean };
  time: { months: number; done: boolean };
  /** The rung to work on now; 4 once all three are done. */
  current: 1 | 2 | 3 | 4;
}

export function ladder(input: LadderInput): Ladder {
  const target = Math.max(0, input.cushionTarget);
  const saved = Math.max(0, input.cushionSaved);
  const cushionDone = target > 0 && saved >= target - 0.009;
  const habitDone = input.hasPlan && input.monthsContributed >= HABIT_MONTHS;
  const months = input.monthsInvested ?? 0;
  const timeDone = months >= TIME_MONTHS;

  const current: Ladder['current'] = !cushionDone ? 1 : !habitDone ? 2 : !timeDone ? 3 : 4;

  return {
    cushion: {
      saved,
      target,
      fraction: target > 0 ? Math.min(1, saved / target) : 0,
      done: cushionDone,
    },
    habit: { months: input.monthsContributed, hasPlan: input.hasPlan, done: habitDone },
    time: { months, done: timeDone },
    current,
  };
}

/** Whole calendar months between two instants (floor), never negative. */
export function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1;
  return Math.max(0, months);
}

// ---------------------------------------------------------------------------
// Spotting an investment in a bank message — a suggestion, never a tag
// ---------------------------------------------------------------------------

/**
 * Words that, in an Indian bank SMS or payment notification, almost only
 * ever describe money going into or out of an investment: the platforms,
 * the clearing houses and registrars their payments route through, and the
 * product names themselves. Matched as whole words so "coin" in "Coinbase"
 * or "BSE" inside another word never fires.
 *
 * This only decides whether Review *asks*. A false positive costs one tap
 * ("No, a normal spend"); a false negative costs nothing that manual entry
 * did not already cost. Which is why it is allowed to exist at all when
 * Phase 9 refused to auto-tag.
 */
const INVESTMENT_WORDS = [
  'sip',
  'mutual fund',
  'mutual funds',
  'mf',
  'groww',
  'zerodha',
  'kite',
  'upstox',
  'kuvera',
  'paytm money',
  'indmoney',
  'smallcase',
  'et money',
  'angel one',
  'iccl',
  'indian clearing corp',
  'indian clearing corporation',
  'nse clearing',
  'bse ltd',
  'bse limited',
  'cams',
  'kfintech',
  'kfin',
  'ppf',
  'nps',
  'sovereign gold bond',
  'redemption',
];

const INVESTMENT_PATTERN = new RegExp(
  `(^|[^a-z0-9])(${INVESTMENT_WORDS.map((w) => w.replace(/ /g, '\\s+')).join('|')})([^a-z0-9]|$)`,
  'i'
);

export function looksLikeInvestment(text: string, merchant?: string | null): boolean {
  const haystack = `${text ?? ''} ${merchant ?? ''}`.toLowerCase();
  return INVESTMENT_PATTERN.test(haystack);
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** The one kind sentence under the Wealth hero. */
export function wealthLine(input: {
  worth: number;
  putIn: number;
  current: Ladder['current'];
  monthly: number;
}): string {
  if (input.putIn <= 0.009 && input.worth <= 0.009) {
    return input.current === 1
      ? 'First a cushion, then the slow money.'
      : 'Nothing invested yet. No rush — just a start.';
  }
  const gain = input.worth - input.putIn;
  if (gain < -0.009) return 'Down a little. It does that. Time is the whole trick.';
  if (input.monthly > 0) return 'Ticking along. The boring part is the part that works.';
  return 'Growing quietly. A monthly amount would help it along.';
}
