import { IOUDetail, TransactionRow } from '../db/types';

export const MICRO_TRANSACTION_THRESHOLD = 100;
// Timestamps are stored as UTC ISO strings, and the rest of the math layer
// treats day/hour boundaries in UTC too, so late-night detection stays
// consistent with that rather than depending on the device's timezone.
export const LATE_NIGHT_START_HOUR = 23; // 11 PM
export const LATE_NIGHT_END_HOUR = 4; // 4 AM, exclusive

export interface TopDebtor {
  contactName: string;
  totalOwed: number;
}

export interface InsightsSummary {
  microTransactionCount: number;
  microTransactionTotal: number;
  lateNightCount: number;
  lateNightTotal: number;
  topDebtor: TopDebtor | null;
}

function isLateNightHour(hour: number): boolean {
  return hour >= LATE_NIGHT_START_HOUR || hour < LATE_NIGHT_END_HOUR;
}

/** Only real spending counts. Repayments in either direction are not expenses. */
function spendOnly(transactions: TransactionRow[]): TransactionRow[] {
  return transactions.filter((t) => t.kind === 'SPEND');
}

/**
 * Local-history insights, computed client-side from already-loaded
 * transactions and open IOUs — no new DB queries needed.
 */
export function computeInsights(
  transactions: TransactionRow[],
  openIOUs: IOUDetail[]
): InsightsSummary {
  const debits = spendOnly(transactions);

  const microTransactions = debits.filter((t) => t.amount < MICRO_TRANSACTION_THRESHOLD);
  const microTransactionTotal = microTransactions.reduce((sum, t) => sum + t.amount, 0);

  const lateNightTransactions = debits.filter((t) =>
    isLateNightHour(new Date(t.occurred_at).getUTCHours())
  );
  const lateNightTotal = lateNightTransactions.reduce((sum, t) => sum + t.amount, 0);

  const owedByContact = new Map<string, number>();
  for (const iou of openIOUs) {
    if (iou.direction !== 'THEY_OWE_ME' || iou.openAmount <= 0) continue;
    owedByContact.set(iou.contactName, (owedByContact.get(iou.contactName) ?? 0) + iou.openAmount);
  }

  let topDebtor: TopDebtor | null = null;
  for (const [contactName, totalOwed] of owedByContact) {
    if (!topDebtor || totalOwed > topDebtor.totalOwed) {
      topDebtor = { contactName, totalOwed };
    }
  }

  return {
    microTransactionCount: microTransactions.length,
    microTransactionTotal,
    lateNightCount: lateNightTransactions.length,
    lateNightTotal,
    topDebtor,
  };
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export interface CategorySlice {
  category: string;
  total: number;
  count: number;
  fraction: number;
}

/** Category totals as fractions of the whole, largest first. */
export function categoryBreakdown(
  rows: Array<{ category: string; total: number; count: number }>
): CategorySlice[] {
  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);
  if (grandTotal <= 0) return [];

  return rows
    .map((row) => ({ ...row, fraction: row.total / grandTotal }))
    .sort((a, b) => b.total - a.total);
}

export interface WeekComparison {
  thisWeek: number;
  lastWeek: number;
  /** Fractional change; null when last week had no spending to compare against. */
  change: number | null;
  direction: 'UP' | 'DOWN' | 'FLAT';
}

export function compareWeeks(thisWeek: number, lastWeek: number): WeekComparison {
  if (lastWeek <= 0) {
    return {
      thisWeek,
      lastWeek,
      change: null,
      direction: thisWeek > 0 ? 'UP' : 'FLAT',
    };
  }

  const change = (thisWeek - lastWeek) / lastWeek;
  const direction = Math.abs(change) < 0.05 ? 'FLAT' : change > 0 ? 'UP' : 'DOWN';
  return { thisWeek, lastWeek, change, direction };
}

/**
 * Mean daily spend over the days that actually have data. Dividing by the
 * full window instead would drag the average down for anyone who installed
 * mid-period and make every projection too optimistic.
 */
export function averageDailySpend(daily: Array<{ day: string; total: number }>): number {
  if (daily.length === 0) return 0;
  const total = daily.reduce((sum, d) => sum + d.total, 0);
  return total / daily.length;
}

/**
 * Consecutive days, counting back from the most recent, that finished at or
 * under the daily limit. Days with no spending count as under.
 */
export function computeStreak(
  daily: Array<{ day: string; total: number }>,
  dailyLimit: number,
  today: string = new Date().toISOString().slice(0, 10)
): number {
  if (dailyLimit <= 0) return 0;

  const byDay = new Map(daily.map((d) => [d.day, d.total]));
  let streak = 0;
  const cursor = new Date(`${today}T00:00:00.000Z`);

  // Today is still in progress, so start from yesterday.
  cursor.setUTCDate(cursor.getUTCDate() - 1);

  for (let i = 0; i < 400; i += 1) {
    const key = cursor.toISOString().slice(0, 10);
    const spent = byDay.get(key) ?? 0;
    if (spent > dailyLimit) break;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return streak;
}


// ---------------------------------------------------------------------------
// History. Everything above describes the period you are in; these look
// across months, which is the only way to tell a bad week from a habit.
// ---------------------------------------------------------------------------

export interface MonthTotal {
  /** "2026-09" */
  month: string;
  total: number;
  count: number;
  /** Distinct days with any spending. Used to compare part-months fairly. */
  days: number;
}

export interface MonthComparison {
  current: MonthTotal | null;
  previous: MonthTotal | null;
  /** Mean of every complete month before the current one. */
  typical: number | null;
  /**
   * Change against `typical`, as a fraction. Compared on a per-active-day
   * basis, because the current month is usually only part way through and a
   * raw total would always look like an improvement.
   */
  changeVsTypical: number | null;
  direction: 'UP' | 'DOWN' | 'FLAT';
  /** Where this month lands if the current daily pace holds. */
  projectedTotal: number | null;
}

const FLAT_BAND = 0.08;

function perDay(month: MonthTotal | null): number | null {
  if (!month || month.days <= 0) return null;
  return month.total / month.days;
}

/**
 * Positions the current month against the ones before it.
 *
 * `months` is newest-first, as returned by getMonthlySpend. Months with no
 * spending at all simply do not appear, and are not treated as zero-spend
 * months - an app installed three weeks ago has no opinion about July.
 */
export function compareMonths(months: MonthTotal[], daysInMonth = 30): MonthComparison {
  const [current = null, previous = null] = months;
  const history = months.slice(1);

  const typical =
    history.length > 0 ? history.reduce((sum, m) => sum + m.total, 0) / history.length : null;

  const currentPerDay = perDay(current);
  const historyPerDay = history.map(perDay).filter((v): v is number => v !== null);
  const typicalPerDay =
    historyPerDay.length > 0
      ? historyPerDay.reduce((sum, v) => sum + v, 0) / historyPerDay.length
      : null;

  let changeVsTypical: number | null = null;
  if (currentPerDay !== null && typicalPerDay !== null && typicalPerDay > 0) {
    changeVsTypical = (currentPerDay - typicalPerDay) / typicalPerDay;
  }

  const direction =
    changeVsTypical === null || Math.abs(changeVsTypical) < FLAT_BAND
      ? 'FLAT'
      : changeVsTypical > 0
        ? 'UP'
        : 'DOWN';

  return {
    current,
    previous,
    typical,
    changeVsTypical,
    direction,
    projectedTotal: currentPerDay === null ? null : currentPerDay * daysInMonth,
  };
}

export interface CategoryShift {
  category: string;
  currentTotal: number;
  typicalTotal: number;
  /** Fractional change against the typical month. */
  change: number;
}

/**
 * Which categories moved, ranked by how much money the move is worth.
 *
 * Ranking by percentage alone surfaces a 300% jump in a 40-rupee category and
 * buries a 20% rise in the one that actually eats the allowance, so the sort
 * is by rupees moved and the percentage is only shown alongside.
 */
export function categoryShifts(
  rows: Array<{ month: string; category: string; total: number }>,
  currentMonth: string,
  minimumRupees = 100
): CategoryShift[] {
  const current = new Map<string, number>();
  const historyByCategory = new Map<string, number[]>();

  for (const row of rows) {
    if (row.month === currentMonth) {
      current.set(row.category, (current.get(row.category) ?? 0) + row.total);
    } else {
      const list = historyByCategory.get(row.category) ?? [];
      list.push(row.total);
      historyByCategory.set(row.category, list);
    }
  }

  const categories = new Set([...current.keys(), ...historyByCategory.keys()]);
  const shifts: CategoryShift[] = [];

  for (const category of categories) {
    const currentTotal = current.get(category) ?? 0;
    const history = historyByCategory.get(category) ?? [];
    if (history.length === 0) continue;

    const typicalTotal = history.reduce((sum, v) => sum + v, 0) / history.length;
    if (typicalTotal <= 0) continue;
    if (Math.abs(currentTotal - typicalTotal) < minimumRupees) continue;

    shifts.push({
      category,
      currentTotal,
      typicalTotal,
      change: (currentTotal - typicalTotal) / typicalTotal,
    });
  }

  return shifts.sort(
    (a, b) =>
      Math.abs(b.currentTotal - b.typicalTotal) - Math.abs(a.currentTotal - a.typicalTotal)
  );
}

export interface RecurringCharge {
  merchant: string;
  /** Mean charge across the months it appeared in. */
  typicalAmount: number;
  months: number;
  total: number;
  lastAt: string;
  /** Roughly what this costs over a year at the current rate. */
  annualised: number;
}

/**
 * Merchants that charge you every month - the subscriptions people forget.
 *
 * Requires the charge to land in at least three distinct months and to be
 * roughly the same size each time; two coincidental visits to the same cafe
 * are not a subscription, and neither is a merchant whose amounts swing wildly.
 */
export function detectRecurring(
  rows: Array<{ merchant: string; months: number; charges: number; total: number; lastAt: string }>,
  minimumMonths = 3
): RecurringCharge[] {
  return rows
    .filter((row) => row.months >= minimumMonths && row.charges >= row.months)
    .map((row) => {
      const typicalAmount = row.total / row.charges;
      return {
        merchant: row.merchant,
        typicalAmount,
        months: row.months,
        total: row.total,
        lastAt: row.lastAt,
        annualised: typicalAmount * 12,
      };
    })
    .sort((a, b) => b.annualised - a.annualised);
}

export interface WeekdayPattern {
  /** 0 = Sunday, matching Date.getDay(). */
  weekday: number;
  label: string;
  average: number;
  days: number;
}

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Average spend per weekday across all history, heaviest first.
 *
 * Averaged rather than totalled so a month with five Saturdays does not beat
 * one with four purely by counting.
 */
export function weekdayPattern(daily: Array<{ day: string; total: number }>): WeekdayPattern[] {
  const totals = new Map<number, { sum: number; days: number }>();

  for (const entry of daily) {
    const weekday = new Date(`${entry.day}T12:00:00.000Z`).getUTCDay();
    const bucket = totals.get(weekday) ?? { sum: 0, days: 0 };
    bucket.sum += entry.total;
    bucket.days += 1;
    totals.set(weekday, bucket);
  }

  return [...totals.entries()]
    .map(([weekday, bucket]) => ({
      weekday,
      label: WEEKDAY_LABELS[weekday],
      average: bucket.sum / bucket.days,
      days: bucket.days,
    }))
    .sort((a, b) => b.average - a.average);
}


// ---------------------------------------------------------------------------
// Robust statistics.
//
// The mean is the wrong summary for spending. One tuition payment or one
// flight makes "your average day" a number that describes no day you actually
// had, and every comparison built on it inherits the distortion. These use the
// median, and pull genuine one-offs out into their own bucket rather than
// letting them quietly dominate a trend.
// ---------------------------------------------------------------------------

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Median spend across the days that actually had any. */
export function medianDailySpend(daily: Array<{ day: string; total: number }>): number {
  return median(daily.map((d) => d.total));
}

export interface OutlierSplit<T> {
  /** The day-to-day spending a habit is made of. */
  routine: T[];
  /** Individually large items, kept separately rather than averaged in. */
  oneOffs: T[];
  /** The cutoff used, so the UI can explain itself. */
  threshold: number;
}

/**
 * Separates one-off spending from routine spending.
 *
 * The cutoff is the median plus `k` times the median absolute deviation, not
 * a fixed rupee figure: someone spending 200 a day and someone spending 2,000
 * a day both have a sense of "unusually big", and it is not the same number.
 * MAD rather than standard deviation because the outliers being looked for
 * would themselves inflate a standard deviation and hide behind it.
 *
 * A floor is applied so that on very regular spending — where the deviation
 * collapses toward zero — an ordinary purchase is not branded unusual.
 */
export function splitOutliers<T>(
  items: T[],
  amountOf: (item: T) => number,
  k = 3,
  floorMultiple = 2
): OutlierSplit<T> {
  if (items.length < 4) return { routine: items, oneOffs: [], threshold: Infinity };

  const amounts = items.map(amountOf);
  const mid = median(amounts);
  const mad = median(amounts.map((a) => Math.abs(a - mid)));

  const threshold = Math.max(mid + k * mad, mid * floorMultiple);

  const routine: T[] = [];
  const oneOffs: T[] = [];
  for (const item of items) {
    (amountOf(item) > threshold ? oneOffs : routine).push(item);
  }

  return { routine, oneOffs, threshold };
}

export interface TypicalDay {
  /** Median of days with spending — the number that describes a normal day. */
  typical: number;
  /** Mean, kept for comparison; a large gap is itself worth surfacing. */
  mean: number;
  /** True when one-off spending is pulling the mean well above the median. */
  skewed: boolean;
}

export function typicalDay(daily: Array<{ day: string; total: number }>): TypicalDay {
  const typical = medianDailySpend(daily);
  const mean = averageDailySpend(daily);
  // A fifth above the median is where the mean stops describing a normal day.
  return { typical, mean, skewed: typical > 0 && mean > typical * 1.2 };
}

export interface SpendingPersonality {
  label: string;
  blurb: string;
}

/** A shareable one-liner for the month. Descriptive, never scolding. */
export function spendingPersonality(slices: CategorySlice[]): SpendingPersonality | null {
  const top = slices[0];
  if (!top || top.fraction < 0.25) return null;

  const percent = Math.round(top.fraction * 100);
  const byCategory: Record<string, SpendingPersonality> = {
    Food: { label: 'The Feeder', blurb: `${percent}% of your money is food. respect` },
    Outing: { label: 'The Social', blurb: `${percent}% went to going out. worth it probably` },
    Transport: { label: 'The Commuter', blurb: `${percent}% on getting places` },
    Shopping: { label: 'The Cart Filler', blurb: `${percent}% on stuff` },
    Subscriptions: { label: 'The Subscriber', blurb: `${percent}% on things that auto-renew` },
    Academics: { label: 'The Scholar', blurb: `${percent}% on actual college things` },
    Health: { label: 'The Careful One', blurb: `${percent}% on health` },
  };

  return (
    byCategory[top.category] ?? {
      label: 'The Mixed Bag',
      blurb: `${percent}% went to ${top.category.toLowerCase()}`,
    }
  );
}

// ---------------------------------------------------------------------------
// Who you actually split with.
// ---------------------------------------------------------------------------

export interface SplitHistoryEntry {
  contactId: number;
  /** When a bill was split with this person. */
  at: string;
}

export interface RankedContact {
  contactId: number;
  score: number;
  splits: number;
  lastAt: string;
}

/** Half-life, in days, of one past split's contribution to the ranking. */
export const SPLIT_RECENCY_HALF_LIFE = 30;

/**
 * Ranks people by how often you split with them, discounted by how long ago.
 *
 * A plain count is wrong here: the flatmate you split with twenty times last
 * term would sit permanently above the friend you have been out with three
 * times this week, and the point of a quick-add row is the people you are
 * likely to pick *now*. Each past split decays with a 30-day half-life —
 * the same shape used to weight how reliably someone pays you back, so the
 * app ages evidence consistently wherever it does it.
 */
export function rankContactsBySplitHistory(
  history: SplitHistoryEntry[],
  now: Date = new Date()
): RankedContact[] {
  const byContact = new Map<number, { score: number; splits: number; lastAt: string }>();

  for (const entry of history) {
    const days = Math.max(0, (now.getTime() - Date.parse(entry.at)) / 86_400_000);
    const weight = Math.pow(0.5, days / SPLIT_RECENCY_HALF_LIFE);

    const current = byContact.get(entry.contactId);
    if (!current) {
      byContact.set(entry.contactId, { score: weight, splits: 1, lastAt: entry.at });
      continue;
    }

    current.score += weight;
    current.splits += 1;
    if (entry.at > current.lastAt) current.lastAt = entry.at;
  }

  return [...byContact.entries()]
    .map(([contactId, value]) => ({ contactId, ...value }))
    .sort((a, b) => b.score - a.score || b.lastAt.localeCompare(a.lastAt));
}
