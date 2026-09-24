import { goalPace } from '../src/math/budget';

describe('goalPace — the savings bar pace marker (0.9.21)', () => {
  const created = '2026-01-01T00:00:00.000Z';
  const deadline = '2026-11-01T00:00:00.000Z';
  const now = new Date('2026-06-01T00:00:00.000Z'); // about halfway

  it('marks where a steady saver would be today', () => {
    const pace = goalPace(28000, 60000, created, deadline, now);
    expect(pace!.expectedFraction).toBeCloseTo(151 / 304, 2);
  });

  it('says how far behind, and the monthly amount that still finishes on time', () => {
    const pace = goalPace(20000, 60000, created, deadline, now);
    expect(pace!.behindBy).toBeCloseTo(60000 * (151 / 304) - 20000, -1);
    // 40,000 left over five months.
    expect(pace!.perMonth).toBeCloseTo(40000 / (153 / 30.44), -1);
  });

  it('is zero behind when ahead', () => {
    expect(goalPace(50000, 60000, created, deadline, now)!.behindBy).toBe(0);
  });

  it('has no pace without a deadline, or once it has passed', () => {
    expect(goalPace(100, 1000, created, null, now)).toBeNull();
    expect(goalPace(100, 1000, created, '2026-05-01T00:00:00.000Z', now)).toBeNull();
  });
});
