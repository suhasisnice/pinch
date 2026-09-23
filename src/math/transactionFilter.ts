import { CaptureSource, Direction, TransactionRow } from '../db/types';

/**
 * Filtering the ledger, as one described value rather than a pile of
 * booleans threaded through a screen.
 *
 * Kept here, pure, for the same reason the budget maths is: "which rows
 * does this show" is the sort of thing that is easy to get subtly wrong
 * (an off-by-one on a date boundary, an empty list meaning "none" instead
 * of "all") and impossible to check by looking at a screenshot.
 */

export type DateRangePreset =
  | 'ALL'
  | 'TODAY'
  | 'WEEK'
  | 'MONTH'
  | 'PERIOD'
  | 'CUSTOM';

export const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  ALL: 'All time',
  TODAY: 'Today',
  WEEK: 'Last 7 days',
  MONTH: 'This month',
  PERIOD: 'This budget period',
  CUSTOM: 'Custom',
};

export type DirectionFilter = 'ALL' | 'OUT' | 'IN';

export interface TransactionFilter {
  direction: DirectionFilter;
  range: DateRangePreset;
  /** Inclusive start of a CUSTOM range, as an ISO date (YYYY-MM-DD). */
  customFrom: string | null;
  /** Inclusive end of a CUSTOM range, as an ISO date (YYYY-MM-DD). */
  customTo: string | null;
  /** Empty means every category, including uncategorised. */
  categories: string[];
  /** Empty means every source. */
  sources: CaptureSource[];
  minAmount: number | null;
  maxAmount: number | null;
  /** Matched against the merchant name, case-insensitively. */
  query: string;
  /** Excluded rows are hidden unless this is on — they are not real spending. */
  showIgnored: boolean;
  /** Only payments somebody still owes you for. */
  onlyOwedBack: boolean;
  /** Only ones nothing could categorise, for cleaning them up in a pass. */
  onlyUncategorised: boolean;
}

export const EMPTY_FILTER: TransactionFilter = {
  direction: 'ALL',
  range: 'ALL',
  customFrom: null,
  customTo: null,
  categories: [],
  sources: [],
  minAmount: null,
  maxAmount: null,
  query: '',
  showIgnored: false,
  onlyOwedBack: false,
  onlyUncategorised: false,
};

/** True when the filter would hide nothing, so the UI can say "no filters". */
export function isFilterEmpty(filter: TransactionFilter): boolean {
  return (
    filter.direction === 'ALL' &&
    filter.range === 'ALL' &&
    filter.categories.length === 0 &&
    filter.sources.length === 0 &&
    filter.minAmount === null &&
    filter.maxAmount === null &&
    filter.query.trim() === '' &&
    !filter.showIgnored &&
    !filter.onlyOwedBack &&
    !filter.onlyUncategorised
  );
}

/** How many distinct conditions are narrowing the list, for a badge. */
export function activeFilterCount(filter: TransactionFilter): number {
  let count = 0;
  if (filter.direction !== 'ALL') count += 1;
  if (filter.range !== 'ALL') count += 1;
  if (filter.categories.length > 0) count += 1;
  if (filter.sources.length > 0) count += 1;
  if (filter.minAmount !== null || filter.maxAmount !== null) count += 1;
  if (filter.query.trim() !== '') count += 1;
  if (filter.showIgnored) count += 1;
  if (filter.onlyOwedBack) count += 1;
  if (filter.onlyUncategorised) count += 1;
  return count;
}

export interface DateRange {
  /** Inclusive lower bound, or null for unbounded. */
  from: Date | null;
  /** Exclusive upper bound, or null for unbounded. */
  to: Date | null;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export interface RangeContext {
  now: Date;
  /** The current budget period, for the PERIOD preset. */
  periodStart?: string | null;
  periodEnd?: string | null;
}

/**
 * Turns a preset into actual bounds.
 *
 * Every bound lands on a local midnight and the upper one is exclusive, so
 * a range never half-includes the day it ends on depending on what time a
 * payment happened — the mistake that makes "today" quietly drop a coffee
 * bought at 11pm.
 */
export function resolveDateRange(filter: TransactionFilter, context: RangeContext): DateRange {
  const { now } = context;

  switch (filter.range) {
    case 'ALL':
      return { from: null, to: null };

    case 'TODAY': {
      const from = startOfDay(now);
      const to = new Date(from);
      to.setDate(to.getDate() + 1);
      return { from, to };
    }

    case 'WEEK': {
      // Seven days including today, not the last seven whole days before it.
      const to = startOfDay(now);
      to.setDate(to.getDate() + 1);
      const from = new Date(to);
      from.setDate(from.getDate() - 7);
      return { from, to };
    }

    case 'MONTH': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { from, to };
    }

    case 'PERIOD': {
      if (!context.periodStart || !context.periodEnd) return { from: null, to: null };
      return { from: new Date(context.periodStart), to: new Date(context.periodEnd) };
    }

    case 'CUSTOM': {
      // Either end may be left open, so "everything since March" needs no
      // second date invented for it.
      const from = filter.customFrom ? startOfDay(new Date(filter.customFrom)) : null;
      let to: Date | null = null;
      if (filter.customTo) {
        // The typed date is inclusive; the bound is exclusive, so push past it.
        to = startOfDay(new Date(filter.customTo));
        to.setDate(to.getDate() + 1);
      }
      return { from, to };
    }
  }
}

export interface FilterContext extends RangeContext {
  /** Transaction id -> amount still owed back, for `onlyOwedBack`. */
  owedByTransaction?: Map<number, number>;
}

/**
 * Applies every condition. Rows come back in the order they went in.
 *
 * An empty `categories` or `sources` list means "no opinion", not "nothing
 * matches" — the difference between a filter nobody has touched and one
 * that would show an empty screen.
 */
export function applyTransactionFilter(
  rows: TransactionRow[],
  filter: TransactionFilter,
  context: FilterContext
): TransactionRow[] {
  const { from, to } = resolveDateRange(filter, context);
  const fromMs = from?.getTime() ?? null;
  const toMs = to?.getTime() ?? null;
  const needle = filter.query.trim().toLowerCase();

  const wantedDirection: Direction | null =
    filter.direction === 'OUT' ? 'DEBIT' : filter.direction === 'IN' ? 'CREDIT' : null;

  return rows.filter((row) => {
    // Excluded rows are junk the user already dismissed; they only appear
    // when explicitly asked for, and then they are all that appears, so the
    // "Ignored" view is a list of what was thrown away rather than a subtle
    // addition to the normal one.
    const isIgnored = row.excluded_at !== null;
    if (filter.showIgnored !== isIgnored) return false;

    if (wantedDirection !== null && row.direction !== wantedDirection) return false;

    if (fromMs !== null || toMs !== null) {
      const at = Date.parse(row.occurred_at);
      if (Number.isNaN(at)) return false;
      if (fromMs !== null && at < fromMs) return false;
      if (toMs !== null && at >= toMs) return false;
    }

    if (filter.categories.length > 0) {
      // 'Uncategorised' is a selectable category rather than a gap, so a
      // filter can be built for exactly the rows that need fixing.
      const category = row.category ?? 'Uncategorised';
      if (!filter.categories.includes(category)) return false;
    }

    if (filter.sources.length > 0 && !filter.sources.includes(row.source)) return false;

    if (filter.minAmount !== null && row.amount < filter.minAmount) return false;
    if (filter.maxAmount !== null && row.amount > filter.maxAmount) return false;

    if (needle && !row.merchant.toLowerCase().includes(needle)) return false;

    if (filter.onlyUncategorised && row.category !== null) return false;

    if (filter.onlyOwedBack) {
      const owed = context.owedByTransaction?.get(row.id);
      if (owed === undefined || owed <= 0.009) return false;
    }

    return true;
  });
}

export interface FilterTotals {
  count: number;
  /** Money out minus money in, across what is showing. */
  net: number;
  out: number;
  in: number;
}

/** What the filtered set adds up to, for the header. */
export function summariseFiltered(rows: TransactionRow[]): FilterTotals {
  let out = 0;
  let incoming = 0;
  for (const row of rows) {
    if (row.direction === 'DEBIT') out += row.amount;
    else incoming += row.amount;
  }
  return { count: rows.length, net: out - incoming, out, in: incoming };
}
