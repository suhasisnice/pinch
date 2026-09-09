import {
  TRANSFER_AUTO_THRESHOLD,
  TransferSide,
  detectTransfers,
  scoreTransfer,
} from '../src/math/transfers';

const AT = '2026-09-09T10:00:00.000Z';

function side(overrides: Partial<TransferSide> & { id: number }): TransferSide {
  return {
    amount: 10000,
    direction: 'DEBIT',
    kind: 'SPEND',
    merchant: 'Transfer',
    occurredAt: AT,
    rawText: null,
    accountHint: null,
    linkedToPerson: false,
    ...overrides,
  };
}

function minutesLater(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60 * 1000).toISOString();
}

describe('scoreTransfer', () => {
  it('is confident about the textbook case', () => {
    const debit = side({
      id: 1,
      accountHint: '1234',
      rawText: 'Rs 10000 debited from A/c XX1234 - IMPS transfer to own account',
    });
    const credit = side({
      id: 2,
      direction: 'CREDIT',
      kind: 'INCOME',
      accountHint: '5678',
      occurredAt: minutesLater(AT, 2),
      rawText: 'Rs 10000 credited to A/c XX5678 by IMPS self transfer',
    });

    const scored = scoreTransfer(debit, credit)!;
    expect(scored.confidence).toBeGreaterThanOrEqual(TRANSFER_AUTO_THRESHOLD);
    expect(scored.reasons).toContain('message says it went to your own account');
  });

  it('refuses to call a friend repaying you a transfer', () => {
    // The dangerous false positive. You buy dinner, Rahul sends his share an
    // hour later, and the amounts happen to match. Erasing that would delete
    // an expense you genuinely bore.
    const debit = side({ id: 1, amount: 900, merchant: 'Toit', accountHint: '1234' });
    const credit = side({
      id: 2,
      amount: 900,
      direction: 'CREDIT',
      kind: 'SETTLE_IN',
      merchant: 'Rahul Kumar',
      accountHint: '1234',
      occurredAt: minutesLater(AT, 60),
      linkedToPerson: true,
    });

    const scored = scoreTransfer(debit, credit)!;
    expect(scored.confidence).toBeLessThan(TRANSFER_AUTO_THRESHOLD);
  });

  it('is wary when the credit comes from something shaped like a person', () => {
    const debit = side({ id: 1, amount: 500, accountHint: '1234' });
    const credit = side({
      id: 2,
      amount: 500,
      direction: 'CREDIT',
      merchant: 'Priya Sharma',
      accountHint: '5678',
      occurredAt: minutesLater(AT, 3),
    });

    const scored = scoreTransfer(debit, credit)!;
    expect(scored.confidence).toBeLessThan(TRANSFER_AUTO_THRESHOLD);
  });

  it('treats the same account on both sides as a refund, not a transfer', () => {
    const debit = side({ id: 1, amount: 1200, accountHint: '1234' });
    const credit = side({
      id: 2,
      amount: 1200,
      direction: 'CREDIT',
      accountHint: '1234',
      occurredAt: minutesLater(AT, 4),
    });

    const scored = scoreTransfer(debit, credit)!;
    expect(scored.reasons).toContain('same account both sides — more likely a refund');
    expect(scored.confidence).toBeLessThan(TRANSFER_AUTO_THRESHOLD);
  });

  it('will not pair amounts that differ', () => {
    expect(
      scoreTransfer(side({ id: 1, amount: 500 }), side({ id: 2, amount: 501, direction: 'CREDIT' }))
    ).toBeNull();
  });

  it('will not pair legs more than a day apart', () => {
    const credit = side({
      id: 2,
      direction: 'CREDIT',
      occurredAt: minutesLater(AT, 60 * 25),
    });
    expect(scoreTransfer(side({ id: 1 }), credit)).toBeNull();
  });

  it('will not accept a credit that arrived before the debit', () => {
    const credit = side({
      id: 2,
      direction: 'CREDIT',
      occurredAt: minutesLater(AT, -30),
    });
    expect(scoreTransfer(side({ id: 1 }), credit)).toBeNull();
  });
});

describe('detectTransfers', () => {
  it('lets each transaction belong to only one pair', () => {
    // Three identical payments and one matching credit: exactly one pairing
    // is possible, and the other two payments must stay as spending.
    const rows: TransferSide[] = [
      side({ id: 1, amount: 500, accountHint: '1111', rawText: 'self transfer' }),
      side({ id: 2, amount: 500, accountHint: '1111', rawText: 'self transfer' }),
      side({ id: 3, amount: 500, accountHint: '1111', rawText: 'self transfer' }),
      side({
        id: 4,
        amount: 500,
        direction: 'CREDIT',
        accountHint: '2222',
        occurredAt: minutesLater(AT, 1),
        rawText: 'self transfer credited',
      }),
    ];

    const pairs = detectTransfers(rows);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].credit.id).toBe(4);
  });

  it('finds nothing when there is nothing to find', () => {
    const rows: TransferSide[] = [
      side({ id: 1, amount: 250, merchant: 'Zomato' }),
      side({ id: 2, amount: 940, merchant: 'Blinkit' }),
    ];
    expect(detectTransfers(rows)).toEqual([]);
  });

  it('pairs two separate transfers independently', () => {
    const rows: TransferSide[] = [
      side({ id: 1, amount: 5000, accountHint: '1111', rawText: 'IMPS to own account' }),
      side({
        id: 2,
        amount: 5000,
        direction: 'CREDIT',
        accountHint: '2222',
        occurredAt: minutesLater(AT, 1),
        rawText: 'IMPS self transfer credited',
      }),
      side({
        id: 3,
        amount: 3000,
        accountHint: '1111',
        occurredAt: minutesLater(AT, 300),
        rawText: 'IMPS to own account',
      }),
      side({
        id: 4,
        amount: 3000,
        direction: 'CREDIT',
        accountHint: '2222',
        occurredAt: minutesLater(AT, 302),
        rawText: 'IMPS self transfer credited',
      }),
    ];

    const pairs = detectTransfers(rows);
    expect(pairs).toHaveLength(2);
    expect(pairs.map((p) => p.debit.amount).sort((a, b) => a - b)).toEqual([3000, 5000]);
  });
});
