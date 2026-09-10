import { CategoryShift, CategorySlice, RecurringCharge } from './insights';

/**
 * Turns the numbers Insights already had into things worth reading.
 *
 * The screen used to be twelve cards of evidence in no particular order,
 * every one the same size, leaving the reader to do the analysis. A chart of
 * daily bars is not an insight; "you are spending faster than this month can
 * take, and food is why" is. This works out which of those sentences are
 * true right now and how much each one matters, so the screen can lead with
 * the two that do and put the evidence underneath.
 *
 * Everything here is derived from figures computed elsewhere. Nothing new is
 * measured — it is the reading of them that was missing.
 */

export type FindingTone = 'CRITICAL' | 'WARNING' | 'NEUTRAL' | 'GOOD';

export interface Finding {
  id: string;
  /** The conclusion, in one line. */
  headline: string;
  /** Why it is true, and what to do about it where there is something to do. */
  detail: string;
  tone: FindingTone;
  /**
   * Ranking weight. Higher wins. Not a severity — a finding can be alarming
   * and still not be the most useful thing to say, and a calm one can be the
   * most useful thing on the screen.
   */
  weight: number;
}

export interface FindingsInput {
  /** Everything still spendable across the rest of the period. */
  spendablePool: number;
  allowance: number;
  dailyLimit: number;
  daysRemaining: number;
  /** Length of the whole period, for working out how far through it is. */
  periodDays: number;
  grossSpend: number;
  /** Median spend on the days that had any. */
  typicalDay: number;
  /** Mean, which a few big days can pull well above the median. */
  meanDay: number;
  /** Days until the pool runs out at the current pace, null when it will not. */
  brokeIn: number | null;
  categories: CategorySlice[];
  shifts: CategoryShift[];
  recurring: RecurringCharge[];
  thisWeek: number;
  lastWeek: number;
  /** Rows with no category, so the screen can admit when it is guessing blind. */
  uncategorisedFraction: number;
}

const money = (amount: number): string => `₹${Math.round(amount).toLocaleString('en-IN')}`;

/**
 * How far through the period, as a fraction. Guards the first day, when
 * nothing has elapsed and every "you are ahead of pace" reading is noise.
 */
function elapsedFraction(input: FindingsInput): number {
  if (input.periodDays <= 0) return 0;
  const elapsed = input.periodDays - input.daysRemaining;
  return Math.max(0, Math.min(1, elapsed / input.periodDays));
}

export function buildFindings(input: FindingsInput): Finding[] {
  const findings: Finding[] = [];
  const elapsed = elapsedFraction(input);

  // -- Will the money last? The question the screen exists to answer. -----
  if (input.spendablePool < 0) {
    findings.push({
      id: 'underwater',
      headline: `You are ${money(-input.spendablePool)} past the allowance`,
      detail:
        'Everything committed for the rest of this period adds up to more than is left. Either something is counted that should not be, or the next few days have to be very cheap.',
      tone: 'CRITICAL',
      weight: 100,
    });
  } else if (input.brokeIn !== null && input.brokeIn < input.daysRemaining) {
    const shortfall = input.daysRemaining - input.brokeIn;
    findings.push({
      id: 'runs-out-early',
      headline: `At this pace the money runs out ${shortfall} day${shortfall === 1 ? '' : 's'} early`,
      detail: `You have ${money(input.spendablePool)} for ${input.daysRemaining} days, and you are averaging ${money(
        input.meanDay
      )} a day. Spending ${money(input.dailyLimit)} a day instead gets you to the end.`,
      tone: 'CRITICAL',
      weight: 95,
    });
  }

  // -- Pace against how far through the period we actually are. ----------
  // Only meaningful once enough of the period has passed that a percentage
  // is not just noise from a single expensive morning.
  if (elapsed >= 0.15 && input.allowance > 0) {
    const spentFraction = input.grossSpend / input.allowance;
    const gap = spentFraction - elapsed;
    if (gap >= 0.1) {
      findings.push({
        id: 'ahead-of-pace',
        headline: `${Math.round(spentFraction * 100)}% spent, ${Math.round(elapsed * 100)}% through`,
        detail: `Spending is running ahead of the calendar. Holding to ${money(
          input.dailyLimit
        )} a day from here still lands on budget.`,
        tone: 'WARNING',
        weight: 80,
      });
    } else if (gap <= -0.1) {
      findings.push({
        id: 'behind-pace',
        headline: `${Math.round(spentFraction * 100)}% spent, ${Math.round(elapsed * 100)}% through`,
        detail: `You are comfortably under. There is roughly ${money(
          input.dailyLimit
        )} a day available for the rest of the period.`,
        tone: 'GOOD',
        weight: 55,
      });
    }
  }

  // -- Where it actually goes, said as a rate rather than a share. -------
  // "Food is 47%" is a fact about a pie chart. "Food is ₹210 a day against
  // a ₹300 limit" is a fact about tomorrow.
  const top = input.categories[0];
  if (top && top.fraction >= 0.3 && input.daysRemaining > 0) {
    const elapsedDays = Math.max(1, input.periodDays - input.daysRemaining);
    const perDay = top.total / elapsedDays;
    const shareOfLimit = input.dailyLimit > 0 ? perDay / input.dailyLimit : 0;
    findings.push({
      id: 'top-category',
      headline: `${top.category} is ${money(perDay)} a day`,
      detail:
        shareOfLimit >= 0.5
          ? `That is ${Math.round(shareOfLimit * 100)}% of your ${money(
              input.dailyLimit
            )} daily limit going to one category. It is the only place a cut would really show.`
          : `${Math.round(top.fraction * 100)}% of everything you have spent this period.`,
      tone: shareOfLimit >= 0.5 ? 'WARNING' : 'NEUTRAL',
      weight: shareOfLimit >= 0.5 ? 75 : 45,
    });
  }

  // -- What is already spoken for before any choice gets made. -----------
  const committed = input.recurring.reduce((sum, charge) => sum + charge.typicalAmount, 0);
  if (committed > 0 && input.allowance > 0) {
    const share = committed / input.allowance;
    findings.push({
      id: 'committed',
      headline: `${money(committed)} a month is already committed`,
      detail: `${input.recurring.length} repeating charge${
        input.recurring.length === 1 ? '' : 's'
      } — ${Math.round(share * 100)}% of the allowance — before you decide anything. ${
        share >= 0.25
          ? 'That is a large share to be fixed; worth checking nothing on the list is forgotten.'
          : ''
      }`.trim(),
      tone: share >= 0.25 ? 'WARNING' : 'NEUTRAL',
      weight: share >= 0.25 ? 70 : 40,
    });
  }

  // -- The biggest change, which is usually the story. -------------------
  const mover = [...input.shifts]
    .filter((shift) => Math.abs(shift.change) >= 0.35 && shift.currentTotal > 0)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
  if (mover) {
    const up = mover.change > 0;
    findings.push({
      id: 'biggest-mover',
      headline: `${mover.category} is ${Math.abs(Math.round(mover.change * 100))}% ${up ? 'up' : 'down'} on a normal month`,
      detail: `${money(mover.currentTotal)} so far against a typical ${money(mover.typicalTotal)}.`,
      tone: up ? 'WARNING' : 'GOOD',
      weight: 60,
    });
  }

  // -- A mean well above the median means the average is lying. ----------
  if (input.typicalDay > 0 && input.meanDay > input.typicalDay * 1.3) {
    findings.push({
      id: 'skewed',
      headline: `Most days you spend ${money(input.typicalDay)}, not ${money(input.meanDay)}`,
      detail:
        'A few big days pull the average up. The lower figure is the one worth planning against; the gap between them is what one bad evening costs.',
      tone: 'NEUTRAL',
      weight: 35,
    });
  }

  // -- Week on week, but only when it is a real move. --------------------
  if (input.lastWeek > 0) {
    const change = (input.thisWeek - input.lastWeek) / input.lastWeek;
    if (Math.abs(change) >= 0.25) {
      findings.push({
        id: 'week-change',
        headline: `This week is ${Math.abs(Math.round(change * 100))}% ${change > 0 ? 'up' : 'down'} on last`,
        detail: `${money(input.thisWeek)} against ${money(input.lastWeek)}.`,
        tone: change > 0 ? 'WARNING' : 'GOOD',
        weight: 50,
      });
    }
  }

  // -- Say so when the reading is built on incomplete data. --------------
  // Every category finding above is only as good as what has been
  // categorised, and quietly presenting a breakdown of half a ledger as if
  // it were the whole thing is the more misleading option.
  if (input.uncategorisedFraction >= 0.25) {
    findings.push({
      id: 'uncategorised',
      headline: `${Math.round(input.uncategorisedFraction * 100)}% of spending has no category`,
      detail:
        'The breakdown below only covers the rest. Setting a category on any of them teaches the app the words in that name, so the next few sort themselves.',
      tone: 'NEUTRAL',
      weight: 85,
    });
  }

  return findings.sort((a, b) => b.weight - a.weight);
}
