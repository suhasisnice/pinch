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

// ---------------------------------------------------------------------------
// Mid-Month Calibration / Fresh Start
//
// Instead of assuming a rigid full calendar month, the user can tell the
// app "as of today I actually have ₹X left, with Y days left" — e.g. after
// installing partway through the month, or to correct drift. From that
// point on, Safe-to-Spend is rebased on that balance plus only the
// spending logged after the calibration moment (spending before it is
// already baked into the ₹X the user typed in), and the day count winds
// down from Y rather than from the calendar's real days-left.
// ---------------------------------------------------------------------------

export interface CalibrationBaseline {
  /** What the user says they actually have in-pocket, right now. */
  balance: number;
  /** How many days they're budgeting that balance across, starting today. */
  daysRemaining: number;
  /** ISO timestamp of when this baseline was set. */
  calibratedAt: string;
}

/**
 * Days left in the calibrated budget window: daysRemaining at calibration
 * time, minus full days elapsed since. Floors at 1 so "today" is always
 * still spendable.
 */
export function effectiveDaysRemaining(baseline: CalibrationBaseline, now: Date = new Date()): number {
  const elapsedMs = now.getTime() - new Date(baseline.calibratedAt).getTime();
  const daysElapsed = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
  return Math.max(1, baseline.daysRemaining - daysElapsed);
}

/**
 * DB-aware wrapper: same isolate-open-IOUs math as getSafeToSpend, rebased
 * on the calibration baseline instead of the calendar month.
 */
export async function getCalibratedSafeToSpend(
  baseline: CalibrationBaseline
): Promise<SafeToSpendBreakdown & { daysRemaining: number }> {
  const [debitSinceCalibration, openIOUSinceCalibration] = await Promise.all([
    dbService.getDebitTotalSince(baseline.calibratedAt),
    dbService.getOpenIOUTotalSince(baseline.calibratedAt),
  ]);
  const breakdown = computeSafeToSpend(baseline.balance, debitSinceCalibration, openIOUSinceCalibration);
  return { ...breakdown, daysRemaining: effectiveDaysRemaining(baseline) };
}
