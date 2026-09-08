export const SURVIVAL_MODE_THRESHOLD = 1000;

/** Below this Safe-to-Spend balance, the UI switches into Survival Mode. */
export function isSurvivalMode(safeToSpend: number, threshold: number = SURVIVAL_MODE_THRESHOLD): boolean {
  return safeToSpend < threshold;
}

/** Number of days remaining in the current calendar month, today inclusive. */
export function daysLeftInMonth(now: Date = new Date()): number {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const today = now.getUTCDate();
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return lastDayOfMonth - today + 1;
}

/**
 * Daily Survival Cap = Current Balance / Days Left in Month. Guards against
 * a divide-by-zero on the last instant of the month by treating "0 days
 * left" as 1 (today is still spendable).
 */
export function computeDailySurvivalCap(currentBalance: number, daysLeft: number): number {
  const safeDaysLeft = daysLeft > 0 ? daysLeft : 1;
  return currentBalance / safeDaysLeft;
}
