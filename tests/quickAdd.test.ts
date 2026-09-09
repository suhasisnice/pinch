import { rankContactsBySplitHistory } from '../src/math/insights';

const NOW = new Date('2026-09-09T12:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe('ranking who to offer first when splitting', () => {
  it('puts someone recent above someone historically more frequent', () => {
    // The flatmate from last term should not permanently outrank the friend
    // you were out with yesterday — the row exists to guess who you are about
    // to pick, not to report an all-time tally.
    const history = [
      ...Array.from({ length: 20 }, () => ({ contactId: 1, at: daysAgo(150) })),
      { contactId: 2, at: daysAgo(1) },
      { contactId: 2, at: daysAgo(3) },
      { contactId: 2, at: daysAgo(6) },
    ];

    const ranked = rankContactsBySplitHistory(history, NOW);
    expect(ranked[0].contactId).toBe(2);
  });

  it('still rewards frequency when recency is equal', () => {
    const history = [
      { contactId: 1, at: daysAgo(2) },
      { contactId: 2, at: daysAgo(2) },
      { contactId: 2, at: daysAgo(2) },
    ];

    const ranked = rankContactsBySplitHistory(history, NOW);
    expect(ranked[0].contactId).toBe(2);
    expect(ranked[0].splits).toBe(2);
  });

  it('decays a single split to half its weight after the half-life', () => {
    const fresh = rankContactsBySplitHistory([{ contactId: 1, at: daysAgo(0) }], NOW);
    const aged = rankContactsBySplitHistory([{ contactId: 1, at: daysAgo(30) }], NOW);

    expect(aged[0].score).toBeCloseTo(fresh[0].score / 2, 5);
  });

  it('reports the most recent split for each person', () => {
    const ranked = rankContactsBySplitHistory(
      [
        { contactId: 1, at: daysAgo(9) },
        { contactId: 1, at: daysAgo(2) },
        { contactId: 1, at: daysAgo(40) },
      ],
      NOW
    );

    expect(ranked[0].lastAt).toBe(daysAgo(2));
    expect(ranked[0].splits).toBe(3);
  });

  it('has nothing to say about someone you have never split with', () => {
    expect(rankContactsBySplitHistory([], NOW)).toEqual([]);
  });
});
