import { FindingsInput, buildFindings } from '../src/math/insightsSummary';

const base: FindingsInput = {
  spendablePool: 6000,
  allowance: 12000,
  dailyLimit: 400,
  daysRemaining: 15,
  periodDays: 30,
  grossSpend: 6000,
  typicalDay: 380,
  meanDay: 400,
  brokeIn: null,
  categories: [],
  shifts: [],
  recurring: [],
  thisWeek: 2500,
  lastWeek: 2500,
  uncategorisedFraction: 0,
};

const ids = (input: Partial<FindingsInput>) =>
  buildFindings({ ...base, ...input }).map((f) => f.id);

describe('buildFindings', () => {
  it('says nothing when everything is unremarkable', () => {
    expect(buildFindings(base)).toEqual([]);
  });

  it('leads with being underwater, above everything else', () => {
    const found = buildFindings({
      ...base,
      spendablePool: -2000,
      categories: [{ category: 'Food', total: 5000, count: 20, fraction: 0.8 }],
    });
    expect(found[0].id).toBe('underwater');
    expect(found[0].tone).toBe('CRITICAL');
  });

  it('warns when the pace runs the money out before the period ends', () => {
    const found = buildFindings({ ...base, brokeIn: 9, meanDay: 650 });
    const early = found.find((f) => f.id === 'runs-out-early');
    expect(early?.tone).toBe('CRITICAL');
    // Says what to do, not just that something is wrong.
    expect(early?.detail).toContain('₹400 a day');
  });

  it('does not cry wolf when the pace lasts the period out', () => {
    expect(ids({ brokeIn: 20 })).not.toContain('runs-out-early');
  });

  it('compares spending against how far through the period it is', () => {
    expect(ids({ grossSpend: 9000 })).toContain('ahead-of-pace');
    expect(ids({ grossSpend: 2000 })).toContain('behind-pace');
  });

  it('stays quiet about pace at the very start of a period', () => {
    // One day in, a percentage is noise from a single expensive morning.
    const early = ids({ daysRemaining: 29, grossSpend: 3000 });
    expect(early).not.toContain('ahead-of-pace');
    expect(early).not.toContain('behind-pace');
  });

  it('states the top category as a daily rate against the limit', () => {
    const found = buildFindings({
      ...base,
      categories: [{ category: 'Food', total: 4500, count: 30, fraction: 0.75 }],
    });
    const top = found.find((f) => f.id === 'top-category');
    // 4500 over the 15 elapsed days is 300/day against a 400 limit.
    expect(top?.headline).toContain('₹300 a day');
    expect(top?.detail).toContain('75%');
    expect(top?.tone).toBe('WARNING');
  });

  it('ignores a top category that is not actually dominant', () => {
    expect(
      ids({ categories: [{ category: 'Food', total: 1000, count: 5, fraction: 0.2 }] })
    ).not.toContain('top-category');
  });

  it('reports what is committed before any choice gets made', () => {
    const found = buildFindings({
      ...base,
      recurring: [
        { merchant: 'Netflix', typicalAmount: 199, months: 3, total: 597, lastAt: '', annualised: 2388 },
        { merchant: 'Gym', typicalAmount: 3200, months: 3, total: 9600, lastAt: '', annualised: 38400 },
      ],
    });
    const committed = found.find((f) => f.id === 'committed');
    expect(committed?.headline).toContain('₹3,399');
    // 3399 of 12000 is 28%, past the point where it is worth flagging.
    expect(committed?.tone).toBe('WARNING');
  });

  it('picks the largest category move as the story', () => {
    const found = buildFindings({
      ...base,
      shifts: [
        { category: 'Food', currentTotal: 3000, typicalTotal: 2800, change: 0.07 },
        { category: 'Outing', currentTotal: 2000, typicalTotal: 800, change: 1.5 },
      ],
    });
    const mover = found.find((f) => f.id === 'biggest-mover');
    expect(mover?.headline).toContain('Outing');
    expect(mover?.headline).toContain('150% up');
  });

  it('flags when the average is being pulled by a few big days', () => {
    const found = buildFindings({ ...base, typicalDay: 300, meanDay: 500 });
    expect(found.find((f) => f.id === 'skewed')?.headline).toContain('₹300');
  });

  it('only mentions the week when it actually moved', () => {
    expect(ids({ thisWeek: 2600, lastWeek: 2500 })).not.toContain('week-change');
    expect(ids({ thisWeek: 4000, lastWeek: 2500 })).toContain('week-change');
  });

  it('admits when the breakdown is built on half a ledger', () => {
    const found = buildFindings({ ...base, uncategorisedFraction: 0.6 });
    const gap = found.find((f) => f.id === 'uncategorised');
    expect(gap?.headline).toContain('60%');
    // Ranks high: every category reading below it is only as good as this.
    expect(found[0].id).toBe('uncategorised');
  });

  it('returns findings strongest first', () => {
    const found = buildFindings({
      ...base,
      spendablePool: -500,
      thisWeek: 5000,
      lastWeek: 2000,
      typicalDay: 200,
      meanDay: 400,
    });
    const weights = found.map((f) => f.weight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
  });
});
