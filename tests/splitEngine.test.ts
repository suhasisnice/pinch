import { calculateSplit, SplitParticipant } from '../src/math/splitEngine';

function sumAmounts(shares: { amount: number }[]): number {
  return Math.round(shares.reduce((sum, s) => sum + s.amount, 0) * 100) / 100;
}

describe('splitEngine.calculateSplit', () => {
  test('even split across N participants sums exactly to the total', () => {
    const participants: SplitParticipant[] = [
      { contactId: 1, included: true },
      { contactId: 2, included: true },
      { contactId: 3, included: true },
    ];

    const shares = calculateSplit(100, participants);
    expect(shares).toHaveLength(3);
    expect(sumAmounts(shares)).toBe(100);
    // 100 / 3 = 33.33..., largest-remainder hands the extra cent to one person.
    expect(shares.map((s) => s.amount).sort()).toEqual([33.33, 33.33, 33.34]);
  });

  test('exclude toggle removes a participant from the split (amount 0, not counted)', () => {
    const participants: SplitParticipant[] = [
      { contactId: 1, included: true },
      { contactId: 2, included: false },
      { contactId: 3, included: true },
    ];

    const shares = calculateSplit(50, participants);
    const excluded = shares.find((s) => s.contactId === 2);
    expect(excluded?.amount).toBe(0);
    expect(sumAmounts(shares)).toBe(50);

    const included = shares.filter((s) => s.contactId !== 2);
    expect(included.every((s) => s.amount === 25)).toBe(true);
  });

  test('ratio multipliers weight shares proportionally', () => {
    const participants: SplitParticipant[] = [
      { contactId: 1, included: true, ratio: 1 },
      { contactId: 2, included: true, ratio: 2 },
    ];

    // Total ratio 3: contact 1 gets 1/3, contact 2 gets 2/3 of 90.
    const shares = calculateSplit(90, participants);
    expect(shares.find((s) => s.contactId === 1)?.amount).toBe(30);
    expect(shares.find((s) => s.contactId === 2)?.amount).toBe(60);
    expect(sumAmounts(shares)).toBe(90);
  });

  test('ratio multipliers combined with an exclude toggle', () => {
    const participants: SplitParticipant[] = [
      { contactId: 1, included: true, ratio: 3 },
      { contactId: 2, included: false, ratio: 5 },
      { contactId: 3, included: true, ratio: 1 },
    ];

    // Excluded participant's ratio must not affect the remaining split.
    const shares = calculateSplit(40, participants);
    expect(shares.find((s) => s.contactId === 2)?.amount).toBe(0);
    expect(shares.find((s) => s.contactId === 1)?.amount).toBe(30); // 3/4 of 40
    expect(shares.find((s) => s.contactId === 3)?.amount).toBe(10); // 1/4 of 40
    expect(sumAmounts(shares)).toBe(40);
  });

  test('all participants excluded yields zero for everyone', () => {
    const participants: SplitParticipant[] = [
      { contactId: 1, included: false },
      { contactId: 2, included: false },
    ];
    const shares = calculateSplit(100, participants);
    expect(shares.every((s) => s.amount === 0)).toBe(true);
  });

  test('rounding remainder never causes the sum to drift from the total (odd cents)', () => {
    const participants: SplitParticipant[] = [
      { contactId: 1, included: true },
      { contactId: 2, included: true },
      { contactId: 3, included: true },
      { contactId: 4, included: true },
      { contactId: 5, included: true },
      { contactId: 6, included: true },
      { contactId: 7, included: true },
    ];
    const shares = calculateSplit(19.99, participants);
    expect(sumAmounts(shares)).toBe(19.99);
  });

  test('throws when every included participant has ratio 0', () => {
    const participants: SplitParticipant[] = [
      { contactId: 1, included: true, ratio: 0 },
      { contactId: 2, included: true, ratio: 0 },
    ];
    expect(() => calculateSplit(50, participants)).toThrow();
  });
});
