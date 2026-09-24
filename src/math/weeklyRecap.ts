/**
 * Last week, told as a handful of slides — one number each.
 *
 * Every slide is a fact that was measured, never a score or a label: no
 * "spending personality", no "financial health 72/100". A slide that has
 * nothing true to say (no regular merchant, one day of spending) is left out
 * rather than padded, so a quiet week gets a short recap.
 *
 * Amounts are what was *yours* — other people's share of bills you fronted is
 * taken off — because "you spent ₹4,000" is wrong in a week where ₹2,400 of
 * it was a dinner for four.
 */

export interface RecapSpend {
  amount: number;
  /** Other people's share of this bill. */
  splitAway: number;
  merchant: string;
  category: string | null;
  occurredAt: string;
}

export interface RecapInput {
  /** Local midnight at the start of the week (a Monday). */
  weekStart: Date;
  spends: RecapSpend[];
  /** What was yours the week before, for the comparison; null when unknown. */
  previousWeekYours: number | null;
  /** The current daily limit, for the "under your limit" and "this week" slides. */
  dailyLimit: number;
}

export interface RecapSlide {
  id: 'total' | 'biggest-day' | 'category' | 'regular' | 'limit' | 'quiet' | 'next';
  /** Small line above the figure. */
  eyebrow: string;
  /** A money figure, when the slide is about an amount. */
  amount?: number;
  /** A word figure, when it isn't — a weekday, a merchant, "5 of 7". */
  figure?: string;
  /** One line under the figure. */
  line: string;
  good?: boolean;
}

export interface WeeklyRecap {
  weekStart: Date;
  /** Last day of the week (Sunday), for the title. */
  weekEnd: Date;
  slides: RecapSlide[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const money = (amount: number): string => `₹${Math.round(amount).toLocaleString('en-IN')}`;

/** Local midnight of the Monday of the week before the one `now` is in. */
export function lastCompletedWeek(now: Date): { start: Date; end: Date } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sinceMonday = (today.getDay() + 6) % 7;
  const thisMonday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - sinceMonday);
  const start = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
  return { start, end: thisMonday };
}

/** 0 = Monday … 6 = Sunday, by the phone's calendar rather than UTC. */
function dayIndex(weekStart: Date, occurredAt: string): number {
  const d = new Date(occurredAt);
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((local.getTime() - weekStart.getTime()) / DAY_MS);
}

function listDays(indexes: number[]): string {
  const names = indexes.map((i) => SHORT[i]);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function buildWeeklyRecap(input: RecapInput): WeeklyRecap | null {
  const weekEnd = new Date(input.weekStart.getTime() + 6 * DAY_MS);
  const spends = input.spends.filter((s) => {
    const i = dayIndex(input.weekStart, s.occurredAt);
    return i >= 0 && i < 7;
  });
  if (spends.length === 0) return null;

  const yours = (s: RecapSpend) => Math.max(0, s.amount - s.splitAway);
  const totalYours = spends.reduce((sum, s) => sum + yours(s), 0);
  const totalPaid = spends.reduce((sum, s) => sum + s.amount, 0);
  const slides: RecapSlide[] = [];

  // -- The week in one number. -------------------------------------------
  let totalLine: string;
  const prev = input.previousWeekYours;
  if (prev !== null && prev > 0) {
    const change = (totalYours - prev) / prev;
    totalLine =
      Math.abs(change) < 0.05
        ? `About the same as the week before.`
        : `${Math.abs(Math.round(change * 100))}% ${change < 0 ? 'less' : 'more'} than the ${money(prev)} before.`;
  } else {
    totalLine = `${spends.length} spend${spends.length === 1 ? '' : 's'} across the week.`;
  }
  if (totalPaid - totalYours > 0.5) {
    totalLine += ` ${money(totalPaid - totalYours)} more was other people's share.`;
  }
  slides.push({
    id: 'total',
    eyebrow: 'You spent',
    amount: totalYours,
    line: totalLine,
    good: prev !== null && prev > 0 && totalYours < prev * 0.95,
  });

  // -- By day. -----------------------------------------------------------
  const byDay = Array.from({ length: 7 }, () => ({
    paid: 0,
    yours: 0,
    merchants: new Map<string, number>(),
  }));
  for (const s of spends) {
    const day = byDay[dayIndex(input.weekStart, s.occurredAt)];
    day.paid += s.amount;
    day.yours += yours(s);
    day.merchants.set(s.merchant, (day.merchants.get(s.merchant) ?? 0) + yours(s));
  }
  const spendDays = byDay.filter((d) => d.paid > 0).length;

  if (spendDays >= 2) {
    const biggest = byDay.reduce((best, d, i) => (d.yours > byDay[best].yours ? i : best), 0);
    const [topMerchant] = [...byDay[biggest].merchants.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = byDay[biggest].yours / (totalYours || 1);
    slides.push({
      id: 'biggest-day',
      eyebrow: 'Biggest day',
      figure: WEEKDAYS[biggest],
      line: `${money(byDay[biggest].yours)}${
        byDay[biggest].merchants.size > 1 ? `, mostly ${topMerchant}` : ` at ${topMerchant}`
      }${share >= 0.4 ? ` — ${Math.round(share * 100)}% of the week.` : '.'}`,
    });
  }

  // -- Where it went. ----------------------------------------------------
  const byCategory = new Map<string, number>();
  for (const s of spends) {
    if (!s.category) continue;
    byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + yours(s));
  }
  const topCategory = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topCategory && topCategory[1] > 0 && byCategory.size >= 2) {
    slides.push({
      id: 'category',
      eyebrow: 'Most of it went to',
      figure: topCategory[0],
      line: `${money(topCategory[1])}, ${Math.round((topCategory[1] / (totalYours || 1)) * 100)}% of your week.`,
    });
  }

  // -- A regular. --------------------------------------------------------
  const byMerchant = new Map<string, { count: number; total: number }>();
  for (const s of spends) {
    const key = s.merchant.trim();
    const entry = byMerchant.get(key) ?? { count: 0, total: 0 };
    entry.count += 1;
    entry.total += yours(s);
    byMerchant.set(key, entry);
  }
  const regular = [...byMerchant.entries()]
    .filter(([, e]) => e.count >= 3)
    .sort((a, b) => b[1].count - a[1].count || b[1].total - a[1].total)[0];
  if (regular) {
    slides.push({
      id: 'regular',
      eyebrow: 'Your regular',
      figure: regular[0],
      line: `${regular[1].count} times, ${money(regular[1].total)} in all.`,
    });
  }

  // -- Against the limit. ------------------------------------------------
  if (input.dailyLimit > 0) {
    const overDays = byDay
      .map((d, i) => (d.paid > input.dailyLimit ? i : -1))
      .filter((i) => i >= 0);
    const under = 7 - overDays.length;
    slides.push({
      id: 'limit',
      eyebrow: `Under ${money(input.dailyLimit)} a day`,
      figure: `${under} of 7 days`,
      line: overDays.length === 0 ? 'Every single day.' : `Over on ${listDays(overDays)}.`,
      good: overDays.length === 0,
    });
  }

  // -- Days with nothing. ------------------------------------------------
  const quiet = byDay.map((d, i) => (d.paid === 0 ? i : -1)).filter((i) => i >= 0);
  if (quiet.length > 0 && quiet.length < 7) {
    slides.push({
      id: 'quiet',
      eyebrow: 'Spent nothing on',
      figure: `${quiet.length} day${quiet.length === 1 ? '' : 's'}`,
      line: `${listDays(quiet)}.`,
      good: true,
    });
  }

  // -- What this week needs. ---------------------------------------------
  if (input.dailyLimit > 0) {
    slides.push({
      id: 'next',
      eyebrow: 'This week',
      amount: input.dailyLimit,
      line: 'a day keeps you on track.',
    });
  }

  return { weekStart: input.weekStart, weekEnd, slides };
}
