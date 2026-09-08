import { OpenIOUDetail, TransactionRow } from '../db/types';

export const MICRO_TRANSACTION_THRESHOLD = 100;
// Timestamps are stored as UTC ISO strings (toISOString()), and the rest of
// the math layer (currentYearMonth, daysLeftInMonth) treats day/hour
// boundaries in UTC too, so late-night detection stays consistent with that
// rather than depending on the device's local timezone.
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

/**
 * Local-history insights, computed client-side from already-loaded
 * transactions and open IOUs — no new DB queries needed.
 */
export function computeInsights(
  transactions: TransactionRow[],
  openIOUs: OpenIOUDetail[]
): InsightsSummary {
  const debits = transactions.filter((t) => t.type === 'DEBIT');

  const microTransactions = debits.filter((t) => t.amount < MICRO_TRANSACTION_THRESHOLD);
  const microTransactionTotal = microTransactions.reduce((sum, t) => sum + t.amount, 0);

  const lateNightTransactions = debits.filter((t) => isLateNightHour(new Date(t.timestamp).getUTCHours()));
  const lateNightTotal = lateNightTransactions.reduce((sum, t) => sum + t.amount, 0);

  const owedByContact = new Map<string, number>();
  for (const iou of openIOUs) {
    owedByContact.set(iou.contactName, (owedByContact.get(iou.contactName) ?? 0) + iou.splitAmount);
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
