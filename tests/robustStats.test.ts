import {
  median,
  medianDailySpend,
  splitOutliers,
  typicalDay,
} from '../src/math/insights';

describe('median', () => {
  it('takes the middle of an odd-length set', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('averages the two middles of an even-length set', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('is zero for nothing', () => {
    expect(median([])).toBe(0);
  });
});

describe('typicalDay', () => {
  it('is not moved by a single huge day, unlike the mean', () => {
    // Six ordinary days and one tuition payment. The mean says the user
    // spends ~1,500 a day, which describes none of the seven days.
    const daily = [
      { day: '2026-09-01', total: 200 },
      { day: '2026-09-02', total: 250 },
      { day: '2026-09-03', total: 180 },
      { day: '2026-09-04', total: 300 },
      { day: '2026-09-05', total: 220 },
      { day: '2026-09-06', total: 240 },
      { day: '2026-09-07', total: 9000 },
    ];

    const result = typicalDay(daily);
    expect(result.typical).toBe(240);
    expect(result.mean).toBeCloseTo(1484.29, 1);
    expect(result.skewed).toBe(true);
  });

  it('reports no skew when spending is even', () => {
    const daily = [
      { day: '2026-09-01', total: 200 },
      { day: '2026-09-02', total: 210 },
      { day: '2026-09-03', total: 190 },
      { day: '2026-09-04', total: 205 },
    ];
    expect(typicalDay(daily).skewed).toBe(false);
  });

  it('handles an empty history', () => {
    expect(medianDailySpend([])).toBe(0);
  });
});

describe('splitOutliers', () => {
  const amount = (n: number) => n;

  it('pulls a genuine one-off out of routine spending', () => {
    const items = [120, 150, 90, 200, 130, 12000];
    const { routine, oneOffs } = splitOutliers(items, amount);

    expect(oneOffs).toEqual([12000]);
    expect(routine).toEqual([120, 150, 90, 200, 130]);
  });

  it('scales the cutoff to the person, not a fixed rupee figure', () => {
    // Someone whose normal day is 2,000 should not have every purchase
    // flagged just because it is large in absolute terms.
    const bigSpender = [1800, 2200, 2000, 2400, 1900];
    expect(splitOutliers(bigSpender, amount).oneOffs).toEqual([]);
  });

  it('does not brand an ordinary purchase unusual when spending is very regular', () => {
    // Zero deviation would otherwise make the threshold equal the median and
    // flag anything a rupee above it.
    const flat = [100, 100, 100, 100, 130];
    expect(splitOutliers(flat, amount).oneOffs).toEqual([]);
  });

  it('says nothing with too little data to judge', () => {
    const { routine, oneOffs, threshold } = splitOutliers([100, 9000], amount);
    expect(oneOffs).toEqual([]);
    expect(routine).toEqual([100, 9000]);
    expect(threshold).toBe(Infinity);
  });
});
