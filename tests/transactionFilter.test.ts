import { TransactionRow } from '../src/db/types';
import {
  EMPTY_FILTER,
  TransactionFilter,
  activeFilterCount,
  applyTransactionFilter,
  isFilterEmpty,
  resolveDateRange,
  summariseFiltered,
} from '../src/math/transactionFilter';

const NOW = new Date(2026, 8, 24, 14, 0); // 24 Sep 2026, 2pm

function tx(overrides: Partial<TransactionRow>): TransactionRow {
  return {
    id: 1,
    amount: 100,
    direction: 'DEBIT',
    kind: 'SPEND',
    merchant: 'Swiggy',
    category: 'Food',
    subcategory: null,
    category_source: null,
    occurred_at: new Date(2026, 8, 24, 12, 0).toISOString(),
    source: 'SMS',
    raw_text: null,
    external_ref: null,
    dedup_key: null,
    outing_id: null,
    note: null,
    transfer_pair_id: null,
    non_spend_reason: null,
    excluded_at: null,
    status: 'COMPLETED',
    is_adjustment: 0,
    created_at: new Date(2026, 8, 24, 12, 0).toISOString(),
    ...overrides,
  };
}

const filter = (patch: Partial<TransactionFilter> = {}): TransactionFilter => ({
  ...EMPTY_FILTER,
  ...patch,
});

describe('date ranges', () => {
  it('leaves everything unbounded for ALL', () => {
    expect(resolveDateRange(filter(), { now: NOW })).toEqual({ from: null, to: null });
  });

  it('covers the whole of today, including late evening', () => {
    const { from, to } = resolveDateRange(filter({ range: 'TODAY' }), { now: NOW });
    // An 11pm coffee is still today — the bound has to be the next midnight,
    // not the moment the filter was applied.
    const lateTonight = new Date(2026, 8, 24, 23, 30).getTime();
    expect(lateTonight).toBeGreaterThanOrEqual(from!.getTime());
    expect(lateTonight).toBeLessThan(to!.getTime());
  });

  it('counts seven days including today', () => {
    const { from, to } = resolveDateRange(filter({ range: 'WEEK' }), { now: NOW });
    expect(from).toEqual(new Date(2026, 8, 18));
    expect(to).toEqual(new Date(2026, 8, 25));
  });

  it('runs a calendar month from the 1st to the 1st', () => {
    const { from, to } = resolveDateRange(filter({ range: 'MONTH' }), { now: NOW });
    expect(from).toEqual(new Date(2026, 8, 1));
    expect(to).toEqual(new Date(2026, 9, 1));
  });

  it('uses the budget period when there is one', () => {
    const periodStart = new Date(2026, 8, 5).toISOString();
    const periodEnd = new Date(2026, 9, 5).toISOString();
    const { from, to } = resolveDateRange(filter({ range: 'PERIOD' }), {
      now: NOW,
      periodStart,
      periodEnd,
    });
    expect(from).toEqual(new Date(periodStart));
    expect(to).toEqual(new Date(periodEnd));
  });

  it('falls back to unbounded when no period is known', () => {
    expect(resolveDateRange(filter({ range: 'PERIOD' }), { now: NOW })).toEqual({
      from: null,
      to: null,
    });
  });

  it('treats a custom end date as inclusive', () => {
    const { from, to } = resolveDateRange(
      filter({ range: 'CUSTOM', customFrom: '2026-09-01', customTo: '2026-09-10' }),
      { now: NOW }
    );
    // Something at 6pm on the 10th is inside a range ending "10 Sep".
    const onTheLastDay = new Date(2026, 8, 10, 18, 0).getTime();
    expect(onTheLastDay).toBeGreaterThanOrEqual(from!.getTime());
    expect(onTheLastDay).toBeLessThan(to!.getTime());
  });

  it('allows an open-ended custom range', () => {
    const { from, to } = resolveDateRange(
      filter({ range: 'CUSTOM', customFrom: '2026-09-01', customTo: null }),
      { now: NOW }
    );
    expect(from).toEqual(new Date(2026, 8, 1));
    expect(to).toBeNull();
  });
});

describe('filtering', () => {
  const rows: TransactionRow[] = [
    tx({ id: 1, merchant: 'Swiggy', amount: 250, category: 'Food', source: 'SMS' }),
    tx({
      id: 2,
      merchant: 'Rahul',
      amount: 500,
      direction: 'CREDIT',
      kind: 'INCOME',
      category: null,
      source: 'NOTIFICATION',
    }),
    tx({ id: 3, merchant: 'Metro', amount: 30, category: 'Transport', source: 'MANUAL' }),
    tx({
      id: 4,
      merchant: 'Old junk',
      amount: 900,
      category: null,
      excluded_at: new Date(2026, 8, 20).toISOString(),
    }),
    tx({
      id: 5,
      merchant: 'Toit',
      amount: 2400,
      category: 'Outing',
      occurred_at: new Date(2026, 7, 2, 20, 0).toISOString(),
    }),
  ];

  const ctx = { now: NOW };

  it('shows everything real and hides what was ignored, by default', () => {
    const result = applyTransactionFilter(rows, filter(), ctx);
    expect(result.map((r) => r.id)).toEqual([1, 2, 3, 5]);
  });

  it('shows only the ignored ones when asked', () => {
    const result = applyTransactionFilter(rows, filter({ showIgnored: true }), ctx);
    expect(result.map((r) => r.id)).toEqual([4]);
  });

  it('splits by direction', () => {
    expect(applyTransactionFilter(rows, filter({ direction: 'IN' }), ctx).map((r) => r.id)).toEqual([2]);
    expect(applyTransactionFilter(rows, filter({ direction: 'OUT' }), ctx).map((r) => r.id)).toEqual([
      1, 3, 5,
    ]);
  });

  it('narrows to a date range', () => {
    const result = applyTransactionFilter(rows, filter({ range: 'MONTH' }), ctx);
    // The August one drops out.
    expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('treats an empty category list as no opinion, not as nothing', () => {
    expect(applyTransactionFilter(rows, filter({ categories: [] }), ctx)).toHaveLength(4);
  });

  it('filters by category, with Uncategorised selectable', () => {
    expect(
      applyTransactionFilter(rows, filter({ categories: ['Food', 'Transport'] }), ctx).map((r) => r.id)
    ).toEqual([1, 3]);
    expect(
      applyTransactionFilter(rows, filter({ categories: ['Uncategorised'] }), ctx).map((r) => r.id)
    ).toEqual([2]);
  });

  it('filters by where it came from', () => {
    expect(
      applyTransactionFilter(rows, filter({ sources: ['MANUAL'] }), ctx).map((r) => r.id)
    ).toEqual([3]);
  });

  it('filters by amount, inclusive at both ends', () => {
    expect(
      applyTransactionFilter(rows, filter({ minAmount: 250, maxAmount: 500 }), ctx).map((r) => r.id)
    ).toEqual([1, 2]);
  });

  it('searches the merchant name case-insensitively', () => {
    expect(applyTransactionFilter(rows, filter({ query: 'swig' }), ctx).map((r) => r.id)).toEqual([1]);
  });

  it('finds only what still needs a category', () => {
    expect(
      applyTransactionFilter(rows, filter({ onlyUncategorised: true }), ctx).map((r) => r.id)
    ).toEqual([2]);
  });

  it('finds only what someone still owes back', () => {
    const owed = new Map([[1, 125]]);
    const result = applyTransactionFilter(rows, filter({ onlyOwedBack: true }), {
      ...ctx,
      owedByTransaction: owed,
    });
    expect(result.map((r) => r.id)).toEqual([1]);
  });

  it('combines conditions rather than picking one', () => {
    const result = applyTransactionFilter(
      rows,
      filter({ direction: 'OUT', range: 'MONTH', maxAmount: 100 }),
      ctx
    );
    expect(result.map((r) => r.id)).toEqual([3]);
  });
});

describe('describing the filter', () => {
  it('knows when nothing is narrowing the list', () => {
    expect(isFilterEmpty(filter())).toBe(true);
    expect(activeFilterCount(filter())).toBe(0);
  });

  it('counts each distinct condition once', () => {
    const f = filter({ direction: 'OUT', range: 'WEEK', categories: ['Food'], minAmount: 100 });
    expect(isFilterEmpty(f)).toBe(false);
    expect(activeFilterCount(f)).toBe(4);
  });
});

describe('totals for what is showing', () => {
  it('nets money out against money in', () => {
    const rows = [
      tx({ id: 1, amount: 250, direction: 'DEBIT' }),
      tx({ id: 2, amount: 100, direction: 'CREDIT' }),
    ];
    expect(summariseFiltered(rows)).toEqual({ count: 2, net: 150, out: 250, in: 100 });
  });

  it('is all zeroes for an empty list', () => {
    expect(summariseFiltered([])).toEqual({ count: 0, net: 0, out: 0, in: 0 });
  });
});

describe('subcategoryBreakdown (0.9.21)', () => {
  it('splits one category by sub-category, biggest first, unsorted last', () => {
    const { subcategoryBreakdown, NOT_SORTED } = jest.requireActual('../src/math/transactionFilter');
    const rows = [
      tx({ id: 1, amount: 300, category: 'Food', subcategory: 'Delivery' }),
      tx({ id: 2, amount: 100, category: 'Food', subcategory: null }),
      tx({ id: 3, amount: 500, category: 'Food', subcategory: 'Dining out' }),
      tx({ id: 4, amount: 900, category: 'Shopping', subcategory: 'Online' }),
      tx({ id: 5, amount: 50, category: 'Food', subcategory: 'Delivery', direction: 'CREDIT', kind: 'REFUND' }),
    ];
    const shares = subcategoryBreakdown(rows, 'Food');
    expect(shares.map((s: { subcategory: string }) => s.subcategory)).toEqual(['Dining out', 'Delivery', NOT_SORTED]);
    expect(shares[0].share).toBeCloseTo(500 / 900);
  });

  it('filters to one sub-category only when one category is chosen', () => {
    const rows = [
      tx({ id: 1, category: 'Food', subcategory: 'Delivery' }),
      tx({ id: 2, category: 'Food', subcategory: 'Dining out' }),
    ];
    const shown = applyTransactionFilter(
      rows,
      { ...EMPTY_FILTER, categories: ['Food'], subcategory: 'Delivery' },
      { now: NOW, periodStart: null, periodEnd: null }
    );
    expect(shown.map((r) => r.id)).toEqual([1]);
  });
});
