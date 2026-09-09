import {
  MonthTotal,
  categoryShifts,
  compareMonths,
  detectRecurring,
  weekdayPattern,
} from '../src/math/insights';

const month = (m: string, total: number, days: number, count = days): MonthTotal => ({
  month: m,
  total,
  count,
  days,
});

describe('compareMonths', () => {
  it('says nothing when there is no history to compare against', () => {
    const result = compareMonths([month('2026-09', 4000, 10)]);

    expect(result.typical).toBeNull();
    expect(result.changeVsTypical).toBeNull();
    expect(result.direction).toBe('FLAT');
  });

  it('compares per active day, not raw totals', () => {
    // 2,000 over 5 days is the same daily pace as 8,000 over 20 — a part-way
    // month must not read as a huge improvement just for being incomplete.
    const result = compareMonths([month('2026-09', 2000, 5), month('2026-08', 8000, 20)]);

    expect(result.changeVsTypical).toBe(0);
    expect(result.direction).toBe('FLAT');
  });

  it('flags a month running hotter than usual', () => {
    const result = compareMonths([month('2026-09', 3000, 5), month('2026-08', 6000, 20)]);

    // 600/day against a typical 300/day.
    expect(result.changeVsTypical).toBeCloseTo(1);
    expect(result.direction).toBe('UP');
  });

  it('projects the month end from the current pace', () => {
    const result = compareMonths([month('2026-09', 3000, 10), month('2026-08', 6000, 30)], 30);
    expect(result.projectedTotal).toBe(9000);
  });

  it('averages every prior month for the typical figure', () => {
    const result = compareMonths([
      month('2026-09', 1000, 5),
      month('2026-08', 6000, 30),
      month('2026-07', 4000, 30),
    ]);
    expect(result.typical).toBe(5000);
  });
});

describe('categoryShifts', () => {
  const rows = [
    { month: '2026-09', category: 'Food', total: 4000 },
    { month: '2026-08', category: 'Food', total: 2000 },
    { month: '2026-07', category: 'Food', total: 2000 },
    { month: '2026-09', category: 'Transport', total: 300 },
    { month: '2026-08', category: 'Transport', total: 1200 },
    { month: '2026-07', category: 'Transport', total: 1200 },
  ];

  it('ranks by rupees moved rather than percentage', () => {
    const shifts = categoryShifts(rows, '2026-09');
    expect(shifts[0].category).toBe('Food');
    expect(shifts[0].change).toBe(1);
    expect(shifts[1].category).toBe('Transport');
  });

  it('ignores a category with no history to compare against', () => {
    const shifts = categoryShifts([{ month: '2026-09', category: 'Health', total: 900 }], '2026-09');
    expect(shifts).toEqual([]);
  });

  it('skips movements too small to be worth mentioning', () => {
    const noisy = [
      { month: '2026-09', category: 'Food', total: 1040 },
      { month: '2026-08', category: 'Food', total: 1000 },
    ];
    expect(categoryShifts(noisy, '2026-09')).toEqual([]);
  });
});

describe('detectRecurring', () => {
  it('picks up a charge seen across three or more months', () => {
    const found = detectRecurring([
      { merchant: 'Spotify', months: 4, charges: 4, total: 476, lastAt: '2026-09-01' },
      { merchant: 'Chai Point', months: 2, charges: 9, total: 900, lastAt: '2026-09-08' },
    ]);

    expect(found).toHaveLength(1);
    expect(found[0].merchant).toBe('Spotify');
    expect(found[0].typicalAmount).toBe(119);
    expect(found[0].annualised).toBe(1428);
  });

  it('ranks by what it costs over a year', () => {
    const found = detectRecurring([
      { merchant: 'Spotify', months: 4, charges: 4, total: 476, lastAt: '2026-09-01' },
      { merchant: 'Gym', months: 5, charges: 5, total: 7500, lastAt: '2026-09-02' },
    ]);

    expect(found.map((f) => f.merchant)).toEqual(['Gym', 'Spotify']);
  });

  it('does not call two visits to the same cafe a subscription', () => {
    expect(
      detectRecurring([
        { merchant: 'Third Wave', months: 2, charges: 2, total: 500, lastAt: '2026-09-01' },
      ])
    ).toEqual([]);
  });
});

describe('weekdayPattern', () => {
  it('averages per weekday so a five-Saturday month does not win by counting', () => {
    const daily = [
      // Saturdays: 500 and 700 -> average 600.
      { day: '2026-09-05', total: 500 },
      { day: '2026-09-12', total: 700 },
      // Mondays: 100, 100, 100 -> average 100, but three of them.
      { day: '2026-09-07', total: 100 },
      { day: '2026-09-14', total: 100 },
      { day: '2026-09-21', total: 100 },
    ];

    const pattern = weekdayPattern(daily);
    expect(pattern[0].label).toBe('Saturday');
    expect(pattern[0].average).toBe(600);
    expect(pattern[0].days).toBe(2);

    const monday = pattern.find((p) => p.label === 'Monday');
    expect(monday?.average).toBe(100);
    expect(monday?.days).toBe(3);
  });

  it('returns nothing for no data', () => {
    expect(weekdayPattern([])).toEqual([]);
  });
});
