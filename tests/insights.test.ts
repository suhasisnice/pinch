import { computeInsights, MICRO_TRANSACTION_THRESHOLD } from '../src/math/insights';
import { IOUDetail, TransactionRow } from '../src/db/types';

function tx(overrides: Partial<TransactionRow>): TransactionRow {
  return {
    id: 1,
    amount: 50,
    direction: 'DEBIT',
    kind: 'SPEND',
    merchant: 'Test Merchant',
    category: null,
    occurred_at: '2026-09-08T12:00:00.000Z',
    source: 'MANUAL',
    raw_text: null,
    external_ref: null,
    dedup_key: null,
    outing_id: null,
    note: null,
    transfer_pair_id: null,
    excluded_at: null,
    created_at: '2026-09-08T12:00:00.000Z',
    ...overrides,
  };
}

function iou(overrides: Partial<IOUDetail>): IOUDetail {
  const amount = overrides.amount ?? 50;
  return {
    id: 1,
    contactId: 1,
    contactName: 'Alex',
    contactPhone: null,
    transactionId: 1,
    merchant: 'Test Merchant',
    direction: 'THEY_OWE_ME',
    amount,
    settledAmount: 0,
    openAmount: amount,
    reason: null,
    outingId: null,
    createdAt: '2026-09-08T12:00:00.000Z',
    ...overrides,
  };
}

describe('computeInsights — micro-transactions', () => {
  test('counts and sums DEBIT transactions strictly under the threshold', () => {
    const transactions = [
      tx({ id: 1, amount: 50 }),
      tx({ id: 2, amount: 99.99 }),
      tx({ id: 3, amount: MICRO_TRANSACTION_THRESHOLD }), // not a micro-transaction
      tx({ id: 4, amount: 500 }),
    ];
    const summary = computeInsights(transactions, []);
    expect(summary.microTransactionCount).toBe(2);
    expect(summary.microTransactionTotal).toBeCloseTo(149.99);
  });

  test('ignores CREDIT transactions even if under the threshold', () => {
    const transactions = [tx({ amount: 50, direction: 'CREDIT', kind: 'INCOME' })];
    const summary = computeInsights(transactions, []);
    expect(summary.microTransactionCount).toBe(0);
  });
});

describe('computeInsights — late-night spends', () => {
  test('flags a DEBIT logged at 11:30 PM UTC', () => {
    const transactions = [tx({ amount: 300, occurred_at: '2026-09-08T23:30:00.000Z' })];
    const summary = computeInsights(transactions, []);
    expect(summary.lateNightCount).toBe(1);
    expect(summary.lateNightTotal).toBe(300);
  });

  test('flags a DEBIT logged at 2 AM UTC', () => {
    const transactions = [tx({ amount: 150, occurred_at: '2026-09-09T02:00:00.000Z' })];
    const summary = computeInsights(transactions, []);
    expect(summary.lateNightCount).toBe(1);
  });

  test('does not flag a DEBIT logged at 4 AM UTC (window is exclusive)', () => {
    const transactions = [tx({ amount: 150, occurred_at: '2026-09-09T04:00:00.000Z' })];
    const summary = computeInsights(transactions, []);
    expect(summary.lateNightCount).toBe(0);
  });

  test('does not flag a DEBIT logged at noon', () => {
    const transactions = [tx({ amount: 150, occurred_at: '2026-09-08T12:00:00.000Z' })];
    const summary = computeInsights(transactions, []);
    expect(summary.lateNightCount).toBe(0);
  });
});

describe('computeInsights — biggest debtor', () => {
  test('sums split amounts per contact and picks the largest', () => {
    const openIOUs = [
      iou({ id: 1, contactName: 'Alex', amount: 100 }),
      iou({ id: 2, contactName: 'Priya', amount: 400 }),
      iou({ id: 3, contactName: 'Alex', amount: 350 }), // Alex total: 450
    ];
    const summary = computeInsights([], openIOUs);
    expect(summary.topDebtor).toEqual({ contactName: 'Alex', totalOwed: 450 });
  });

  test('null when there are no open IOUs', () => {
    const summary = computeInsights([], []);
    expect(summary.topDebtor).toBeNull();
  });
});
