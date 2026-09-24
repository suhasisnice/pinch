import { HeroInput, dailyPace, insightHero } from '../src/math/insightsSummary';

// Ten days in, ₹300 a day spent every day, 20 days left.
const tenDays = Array.from({ length: 10 }, (_, i) => ({
  day: `2026-09-${String(i + 1).padStart(2, '0')}`,
  total: 300,
}));

const base: HeroInput = {
  spendablePool: 8000,
  dailyLimit: 400,
  daysRemaining: 20,
  endLabel: '30 Sep',
  daily: tenDays,
  today: '2026-09-10',
};

describe('dailyPace', () => {
  it('divides by calendar days, not days with spending', () => {
    // Two ₹500 days in a week is ~₹143 a day, not ₹500.
    const pace = dailyPace(
      [
        { day: '2026-09-01', total: 500 },
        { day: '2026-09-04', total: 500 },
        { day: '2026-09-07', total: 0.01 },
      ],
      '2026-09-07'
    );
    expect(pace).toBeCloseTo(1000.01 / 7, 2);
  });

  it('counts from the first recorded day, not the period start', () => {
    // Installed mid-period: days the app never saw are not quiet days.
    expect(dailyPace(tenDays.slice(5), '2026-09-10')).toBe(300);
  });

  it('refuses to extrapolate from too little', () => {
    expect(dailyPace(tenDays.slice(0, 2), '2026-09-02')).toBeNull();
  });
});

describe('insightHero', () => {
  it('projects what is left over when the pace holds', () => {
    const hero = insightHero(base);
    // 8000 - 300 × 20
    expect(hero.amount).toBe(2000);
    expect(hero.tone).toBe('GOOD');
    expect(hero.label).toContain('30 Sep');
  });

  it('projects the shortfall and the run-out date when it does not', () => {
    const hero = insightHero({ ...base, spendablePool: 4500 });
    // Needs 6000, has 4500.
    expect(hero.amount).toBe(1500);
    expect(hero.label).toContain('short');
    // 4500 / 300 = 15 days from the 10th.
    expect(hero.detail).toContain('25 Sep');
    // Says what would fix it.
    expect(hero.detail).toContain('₹400 a day');
    expect(hero.tone).toBe('WARNING');
  });

  it('is critical when the money goes in the first half of what is left', () => {
    expect(insightHero({ ...base, spendablePool: 2000 }).tone).toBe('CRITICAL');
  });

  it('leads with being over when the pool is already negative', () => {
    const hero = insightHero({ ...base, spendablePool: -700 });
    expect(hero.tone).toBe('CRITICAL');
    expect(hero.amount).toBe(700);
  });

  it('shows what is left, not a guess, before there is a pace', () => {
    const hero = insightHero({ ...base, daily: tenDays.slice(0, 1), today: '2026-09-01' });
    expect(hero.tone).toBe('NEUTRAL');
    expect(hero.amount).toBe(8000);
    expect(hero.pace).toBeNull();
    expect(hero.label).toBe('to last 20 days');
  });

  it('does not project past the end of the period', () => {
    const hero = insightHero({ ...base, daysRemaining: 0 });
    expect(hero.amount).toBe(8000);
    expect(hero.label).toBe('left this period');
  });
});
