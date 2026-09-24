import {
  afterPaydaySpend,
  findRiskWindows,
  nextWarningAt,
  windowName,
  windowOf,
} from '../src/math/riskWindows';

// Thursday 24 Sep 2026, 15:00 local.
const NOW = new Date(2026, 8, 24, 15, 0);

/** A spend `weeksAgo` weeks back on a given weekday/hour. */
function spendAt(weeksAgo: number, weekday: number, hour: number, amount: number) {
  const d = new Date(NOW);
  d.setDate(d.getDate() - weeksAgo * 7 - ((d.getDay() - weekday + 7) % 7));
  d.setHours(hour, 0, 0, 0);
  if (d > NOW) d.setDate(d.getDate() - 7);
  return { at: d, amount };
}

describe('windowOf', () => {
  it('puts small hours into the previous night', () => {
    const w = windowOf(new Date(2026, 8, 26, 1, 30)); // Saturday 01:30
    expect(w).toEqual({ weekday: 5, block: 'NIGHT' });
  });
  it('reads an evening', () => {
    expect(windowOf(new Date(2026, 8, 25, 19, 0))).toEqual({ weekday: 5, block: 'EVENING' });
  });
});

describe('findRiskWindows', () => {
  it('finds the Friday night habit among ordinary days', () => {
    const spends = [];
    for (let w = 0; w < 8; w++) {
      spends.push(spendAt(w, 5, 22, 900)); // Friday nights
      for (const day of [1, 2, 3]) spends.push(spendAt(w, day, 13, 120)); // lunches
    }
    const [top] = findRiskWindows(spends, NOW);
    expect(top.weekday).toBe(5);
    expect(top.block).toBe('NIGHT');
    expect(windowName(top)).toBe('Friday nights');
    expect(top.average).toBeCloseTo(900, 0);
  });

  it('ignores a single wild night', () => {
    const spends = [spendAt(1, 6, 22, 5000)];
    for (let w = 0; w < 8; w++) spends.push(spendAt(w, 2, 13, 150));
    expect(findRiskWindows(spends, NOW).find((r) => r.weekday === 6)).toBeUndefined();
  });

  it('ignores anything older than eight weeks', () => {
    const spends = [];
    for (let w = 9; w < 14; w++) spends.push(spendAt(w, 5, 22, 900));
    expect(findRiskWindows(spends, NOW)).toEqual([]);
  });
});

describe('nextWarningAt', () => {
  it('warns an hour before the next Friday night', () => {
    const at = nextWarningAt({ weekday: 5, block: 'NIGHT', average: 900 }, NOW);
    expect(at.getDay()).toBe(5);
    expect(at.getHours()).toBe(20);
    expect(at.getDate()).toBe(25);
  });

  it('rolls to next week when today’s warning time has passed', () => {
    const at = nextWarningAt({ weekday: 4, block: 'MORNING', average: 400 }, NOW);
    expect(at.getDate()).toBe(1); // 1 Oct
    expect(at.getHours()).toBe(5);
  });
});

describe('afterPaydaySpend', () => {
  it('averages the first three days after each payday', () => {
    const p1 = new Date(2026, 6, 1);
    const p2 = new Date(2026, 7, 1);
    const spends = [
      { at: new Date(2026, 6, 1, 20), amount: 2000 },
      { at: new Date(2026, 6, 3, 20), amount: 1000 },
      { at: new Date(2026, 6, 10, 20), amount: 9999 },
      { at: new Date(2026, 7, 2, 20), amount: 1000 },
    ];
    expect(afterPaydaySpend(spends, [p1, p2])).toBe(2000);
    expect(afterPaydaySpend(spends, [])).toBeNull();
  });
});
