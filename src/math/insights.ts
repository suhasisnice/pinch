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
    Subscriptions: { label: 'The Subscriber', blurb: `${percent}% on things that auto-renew 👀` },
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
