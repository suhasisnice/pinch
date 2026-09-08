import * as dbService from '../db/dbService';

export interface SafeToSpendBreakdown {
  monthlyAllowance: number;
  grossMonthlyExpenses: number;
  openIOUTotal: number;
  netMonthlyExpenses: number;
  safeToSpend: number;
}

/**
 * Pure calculation: Safe-to-Spend = Monthly Allowance - Total Monthly
 * Expenses, where Total Monthly Expenses explicitly EXCLUDES amounts tied
 * to still-open IOUs (money fronted for someone else that will be repaid).
 * Settled IOUs have already been repaid, so they stay counted as a normal
 * expense — only `openIOUTotal` is isolated out here.
 */
export function computeSafeToSpend(
  monthlyAllowance: number,
  grossMonthlyExpenses: number,
  openIOUTotal: number
): SafeToSpendBreakdown {
  const netMonthlyExpenses = grossMonthlyExpenses - openIOUTotal;
  return {
    monthlyAllowance,
    grossMonthlyExpenses,
    openIOUTotal,
    netMonthlyExpenses,
    safeToSpend: monthlyAllowance - netMonthlyExpenses,
  };
}

/** yearMonth format: "YYYY-MM". Defaults to the current calendar month. */
export function currentYearMonth(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * DB-aware wrapper: pulls this month's gross DEBIT total and open-IOU total
 * from the database, then applies the pure calculation above.
 */
export async function getSafeToSpend(
  monthlyAllowance: number,
  yearMonth: string = currentYearMonth()
): Promise<SafeToSpendBreakdown> {
  const [grossMonthlyExpenses, openIOUTotal] = await Promise.all([
    dbService.getMonthlyDebitTotal(yearMonth),
    dbService.getOpenIOUTotalForMonth(yearMonth),
  ]);
  return computeSafeToSpend(monthlyAllowance, grossMonthlyExpenses, openIOUTotal);
}
