import { addDays, missionProgress, planMission, shouldReplan } from '../src/math/recovery';

describe('planMission', () => {
  it('picks the shortest mission that stays livable', () => {
    // ₹300 over on a ₹500 day: 2 days at 350 = 70% of normal.
    const m = planMission({ day: '2026-09-10', overBy: 300, normalLimit: 500, daysAfter: 20 })!;
    expect(m.startsOn).toBe('2026-09-11');
    expect(m.daysNeeded).toBe(2);
    expect(m.target).toBe(350);
    expect(m.slots).toBe(3);
  });

  it('stretches to more days for a bigger overspend', () => {
    // ₹800 over on ₹500: 2 days → 100/day (20%), 4 days → 300 (60%).
    const m = planMission({ day: '2026-09-10', overBy: 800, normalLimit: 500, daysAfter: 20 })!;
    expect(m.daysNeeded).toBe(4);
    expect(m.target).toBe(300);
  });

  it('caps at five days even when that is tight', () => {
    const m = planMission({ day: '2026-09-10', overBy: 2000, normalLimit: 500, daysAfter: 20 })!;
    expect(m.daysNeeded).toBe(5);
    expect(m.target).toBe(100);
  });

  it('never goes past payday', () => {
    const m = planMission({ day: '2026-09-28', overBy: 300, normalLimit: 500, daysAfter: 1 })!;
    expect(m.daysNeeded).toBe(1);
    expect(m.slots).toBe(1);
    expect(m.target).toBe(200);
  });

  it('asks for a no-spend day rather than a negative number', () => {
    const m = planMission({ day: '2026-09-28', overBy: 900, normalLimit: 500, daysAfter: 1 })!;
    expect(m.target).toBe(0);
  });

  it('has nothing to do for no overspend, or no days left', () => {
    expect(
      planMission({ day: '2026-09-10', overBy: 0, normalLimit: 500, daysAfter: 5 })
    ).toBeNull();
    expect(
      planMission({ day: '2026-09-30', overBy: 300, normalLimit: 500, daysAfter: 0 })
    ).toBeNull();
  });
});

describe('missionProgress', () => {
  const mission = planMission({
    day: '2026-09-10',
    overBy: 300,
    normalLimit: 500,
    daysAfter: 20,
  })!; // 2 days at 350, 3 slots
  const spends = (map: Record<string, number>) => (day: string) => map[day] ?? 0;

  it('is pending on the day of the overspend', () => {
    expect(missionProgress(mission, '2026-09-10', spends({})).status).toBe('PENDING');
  });

  it('is on day one the morning after', () => {
    const p = missionProgress(mission, '2026-09-11', spends({}));
    expect(p.status).toBe('ACTIVE');
    expect(p.dayNumber).toBe(1);
    expect(p.lastResult).toBeNull();
  });

  it('counts a held day and moves on', () => {
    const p = missionProgress(mission, '2026-09-12', spends({ '2026-09-11': 300 }));
    expect(p.results).toEqual(['HELD']);
    expect(p.dayNumber).toBe(2);
  });

  it('finishes when enough days are held', () => {
    const p = missionProgress(
      mission,
      '2026-09-13',
      spends({ '2026-09-11': 300, '2026-09-12': 350 })
    );
    expect(p.status).toBe('DONE');
  });

  it('survives one slip using the spare day', () => {
    const p = missionProgress(
      mission,
      '2026-09-13',
      spends({ '2026-09-11': 600, '2026-09-12': 200 })
    );
    expect(p.status).toBe('ACTIVE');
    expect(p.results).toEqual(['SLIPPED', 'HELD']);
    expect(p.lastResult).toBe('HELD');
  });

  it('fails once there are not enough days left to hold', () => {
    const p = missionProgress(
      mission,
      '2026-09-13',
      spends({ '2026-09-11': 600, '2026-09-12': 700 })
    );
    expect(p.status).toBe('FAILED');
  });

  it('re-plans only when today gets meaningfully worse', () => {
    expect(shouldReplan(mission, 300)).toBe(false);
    expect(shouldReplan(mission, 450)).toBe(true);
  });

  it('adds calendar days across a month end', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
  });
});
