import { TransferSide, detectRoundTrips, sameCounterparty } from '../src/math/transfers';

const AT = '2026-09-09T10:00:00.000Z';

function side(o: Partial<TransferSide> & { id: number }): TransferSide {
  return {
    amount: 20,
    direction: 'DEBIT',
    kind: 'SPEND',
    merchant: 'Rahul Kumar',
    occurredAt: AT,
    rawText: null,
    accountHint: '1234',
    linkedToPerson: false,
    ...o,
  };
}

const later = (minutes: number) => new Date(Date.parse(AT) + minutes * 60000).toISOString();

describe('sameCounterparty', () => {
  it('matches a full name against a first name', () => {
    expect(sameCounterparty('RAHUL KUMAR', 'Rahul')).toBe(true);
  });

  it('matches a VPA against a display name', () => {
    expect(sameCounterparty('rahul.kumar@okhdfc', 'Rahul Kumar')).toBe(true);
  });

  it('does not match two different people', () => {
    expect(sameCounterparty('Rahul Kumar', 'Priya Sharma')).toBe(false);
  });

  it('does not match a person against a restaurant', () => {
    expect(sameCounterparty('Toit Brewpub', 'Rahul Kumar')).toBe(false);
  });
});

describe('detectRoundTrips', () => {
  it('cancels money sent to a friend and sent straight back', () => {
    const pairs = detectRoundTrips([
      side({ id: 1 }),
      side({ id: 2, direction: 'CREDIT', kind: 'INCOME', occurredAt: later(1) }),
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].reasons[0]).toContain('same person both ways');
  });

  it('matches even when the two messages name the person differently', () => {
    const pairs = detectRoundTrips([
      side({ id: 1, merchant: 'RAHUL KUMAR' }),
      side({
        id: 2,
        direction: 'CREDIT',
        kind: 'INCOME',
        merchant: 'rahul@okaxis',
        occurredAt: later(2),
      }),
    ]);
    expect(pairs).toHaveLength(1);
  });

  it('leaves a real bill split completely alone', () => {
    // The case the whole design protects: you paid a restaurant, a friend
    // paid you. Different counterparties, so this is not a round trip.
    const pairs = detectRoundTrips([
      side({ id: 1, amount: 900, merchant: 'Toit Brewpub' }),
      side({
        id: 2,
        amount: 900,
        direction: 'CREDIT',
        kind: 'INCOME',
        merchant: 'Rahul Kumar',
        occurredAt: later(30),
      }),
    ]);
    expect(pairs).toEqual([]);
  });

  it('will not cancel a leg that already settled a debt', () => {
    const pairs = detectRoundTrips([
      side({ id: 1, linkedToPerson: true }),
      side({ id: 2, direction: 'CREDIT', kind: 'SETTLE_IN', occurredAt: later(1) }),
    ]);
    expect(pairs).toEqual([]);
  });

  it('ignores a return that comes back much later', () => {
    const pairs = detectRoundTrips([
      side({ id: 1 }),
      side({ id: 2, direction: 'CREDIT', kind: 'INCOME', occurredAt: later(180) }),
    ]);
    expect(pairs).toEqual([]);
  });

  it('will not pair a credit that arrived before the debit', () => {
    const pairs = detectRoundTrips([
      side({ id: 1 }),
      side({ id: 2, direction: 'CREDIT', kind: 'INCOME', occurredAt: later(-5) }),
    ]);
    expect(pairs).toEqual([]);
  });

  it('gives each transaction to only one pair', () => {
    const pairs = detectRoundTrips([
      side({ id: 1 }),
      side({ id: 2 }),
      side({ id: 3, direction: 'CREDIT', kind: 'INCOME', occurredAt: later(1) }),
    ]);
    expect(pairs).toHaveLength(1);
  });
});
