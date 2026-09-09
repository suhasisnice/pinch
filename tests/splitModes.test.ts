import {
  PAYER_ID,
  SplitParticipant,
  computeSplit,
  suggestExactAmounts,
} from '../src/math/splitEngine';

const sum = (shares: { amount: number }[]): number =>
  Math.round(shares.reduce((total, s) => total + s.amount, 0) * 100) / 100;

/** You plus `n` friends, all in, all weighted 1. */
function table(n: number): SplitParticipant[] {
  return [
    { contactId: PAYER_ID, included: true },
    ...Array.from({ length: n }, (_, i) => ({ contactId: i + 1, included: true })),
  ];
}

describe('EQUAL', () => {
  it('counts the payer as one of the party', () => {
    // 1,200 across you and two friends is 400 each - not 600 each, which
    // would have you recovering the entire bill you were part of.
    const result = computeSplit(1200, table(2), 'EQUAL');

    expect(result.yourShare).toBe(400);
    expect(result.assigned).toBe(800);
    expect(sum(result.shares)).toBe(1200);
  });

  it('ignores ratios entirely', () => {
    const withRatios: SplitParticipant[] = [
      { contactId: PAYER_ID, included: true, ratio: 5 },
      { contactId: 1, included: true, ratio: 3 },
    ];

    const result = computeSplit(100, withRatios, 'EQUAL');
    expect(result.shares.map((s) => s.amount)).toEqual([50, 50]);
  });

  it('never drifts from the total on an awkward division', () => {
    const result = computeSplit(100, table(2), 'EQUAL');
    expect(sum(result.shares)).toBe(100);
    expect(result.shares.map((s) => s.amount).sort()).toEqual([33.33, 33.33, 33.34]);
  });
});

describe('SHARES', () => {
  it('weights a double share against a single one', () => {
    const participants: SplitParticipant[] = [
      { contactId: PAYER_ID, included: true, ratio: 1 },
      { contactId: 1, included: true, ratio: 2 },
      { contactId: 2, included: true, ratio: 1 },
    ];

    const result = computeSplit(400, participants, 'SHARES');
    expect(result.shares.find((s) => s.contactId === 1)?.amount).toBe(200);
    expect(result.shares.find((s) => s.contactId === 2)?.amount).toBe(100);
    expect(result.yourShare).toBe(100);
    expect(sum(result.shares)).toBe(400);
  });

  it('is identical to EQUAL when no ratio has been touched', () => {
    const equal = computeSplit(750, table(4), 'EQUAL');
    const shares = computeSplit(750, table(4), 'SHARES');
    expect(shares.shares).toEqual(equal.shares);
  });
});

describe('EXACT', () => {
  it('takes typed amounts as given and leaves the rest to the payer', () => {
    const participants: SplitParticipant[] = [
      { contactId: 1, included: true, exactAmount: 250 },
      { contactId: 2, included: true, exactAmount: 125.5 },
    ];

    const result = computeSplit(600, participants, 'EXACT');
    expect(result.assigned).toBe(375.5);
    expect(result.yourShare).toBe(224.5);
    expect(result.overAssigned).toBe(false);
  });

  it('flags amounts that add up to more than the bill rather than rescaling', () => {
    const participants: SplitParticipant[] = [
      { contactId: 1, included: true, exactAmount: 400 },
      { contactId: 2, included: true, exactAmount: 400 },
    ];

    const result = computeSplit(600, participants, 'EXACT');
    // The typed numbers survive untouched; the UI is told they do not fit.
    expect(result.shares.map((s) => s.amount)).toEqual([400, 400]);
    expect(result.overAssigned).toBe(true);
    expect(result.yourShare).toBe(-200);
  });

  it('treats a missing amount as zero and an excluded person as out', () => {
    const participants: SplitParticipant[] = [
      { contactId: 1, included: true },
      { contactId: 2, included: false, exactAmount: 999 },
    ];

    const result = computeSplit(500, participants, 'EXACT');
    expect(result.assigned).toBe(0);
    expect(result.shares.find((s) => s.contactId === 2)?.amount).toBe(0);
  });

  it('seeds from the equal split so most bills need one nudge, not five', () => {
    const suggested = suggestExactAmounts(900, table(2));
    expect(suggested.get(1)).toBe(300);
    expect(suggested.get(2)).toBe(300);
    expect(suggested.get(PAYER_ID)).toBe(300);
  });
});
