import { RecapSpend, buildWeeklyRecap, lastCompletedWeek } from '../src/math/weeklyRecap';

// Monday 14 Sep 2026, local midnight.
const MONDAY = new Date(2026, 8, 14);

/** A spend on day `d` (0 = Monday) of the test week, at 1pm local. */
function spend(
  d: number,
  amount: number,
  merchant: string,
  category: string | null = 'Food',
  splitAway = 0
): RecapSpend {
  return {
    amount,
    splitAway,
    merchant,
    category,
    occurredAt: new Date(2026, 8, 14 + d, 13).toISOString(),
  };
}

const ids = (spends: RecapSpend[], extra: Partial<Parameters<typeof buildWeeklyRecap>[0]> = {}) =>
  buildWeeklyRecap({
    weekStart: MONDAY,
    spends,
    previousWeekYours: null,
    dailyLimit: 400,
    ...extra,
  })!.slides.map((s) => s.id);

describe('lastCompletedWeek', () => {
  it('is the Monday-to-Monday before the current week', () => {
    // Thursday 24 Sep → the week of 14–20 Sep.
    const { start, end } = lastCompletedWeek(new Date(2026, 8, 24, 18));
    expect(start).toEqual(new Date(2026, 8, 14));
    expect(end).toEqual(new Date(2026, 8, 21));
  });

  it('on a Monday, is the week that just ended', () => {
    const { start } = lastCompletedWeek(new Date(2026, 8, 21, 9));
    expect(start).toEqual(new Date(2026, 8, 14));
  });

  it('on a Sunday, is still the week before', () => {
    const { start } = lastCompletedWeek(new Date(2026, 8, 27, 22));
    expect(start).toEqual(new Date(2026, 8, 14));
  });
});

describe('buildWeeklyRecap', () => {
  it('has nothing to say about a week with no spending', () => {
    expect(
      buildWeeklyRecap({ weekStart: MONDAY, spends: [], previousWeekYours: 900, dailyLimit: 400 })
    ).toBeNull();
  });

  it('ignores spending outside the week', () => {
    const recap = buildWeeklyRecap({
      weekStart: MONDAY,
      spends: [spend(0, 200, 'Chai'), spend(7, 5000, 'Next week'), spend(-1, 5000, 'Last week')],
      previousWeekYours: null,
      dailyLimit: 400,
    })!;
    expect(recap.slides[0].amount).toBe(200);
  });

  it('counts what was yours, and says how much was other people’s', () => {
    // A ₹2,400 dinner for four, of which ₹1,800 was theirs.
    const recap = buildWeeklyRecap({
      weekStart: MONDAY,
      spends: [spend(4, 2400, 'Toit', 'Food', 1800), spend(1, 300, 'Uber', 'Transport')],
      previousWeekYours: null,
      dailyLimit: 400,
    })!;
    expect(recap.slides[0].amount).toBe(900);
    expect(recap.slides[0].line).toContain('₹1,800 more was other people');
  });

  it('compares with the week before', () => {
    const recap = buildWeeklyRecap({
      weekStart: MONDAY,
      spends: [spend(0, 800, 'Chai')],
      previousWeekYours: 1000,
      dailyLimit: 0,
    })!;
    expect(recap.slides[0].line).toContain('20% less than the ₹1,000 before');
    expect(recap.slides[0].good).toBe(true);
  });

  it('names the biggest day and what drove it', () => {
    const recap = buildWeeklyRecap({
      weekStart: MONDAY,
      spends: [spend(0, 100, 'Chai'), spend(5, 900, 'Toit'), spend(5, 100, 'Chai')],
      previousWeekYours: null,
      dailyLimit: 400,
    })!;
    const day = recap.slides.find((s) => s.id === 'biggest-day')!;
    expect(day.figure).toBe('Saturday');
    expect(day.line).toContain('₹1,000, mostly Toit');
    expect(day.line).toContain('91%');
  });

  it('skips the biggest-day slide when everything happened on one day', () => {
    expect(ids([spend(2, 300, 'Chai'), spend(2, 200, 'Uber')])).not.toContain('biggest-day');
  });

  it('only calls someone a regular after three visits', () => {
    expect(ids([spend(0, 50, 'Chai'), spend(1, 50, 'Chai'), spend(2, 50, 'Uber')])).not.toContain(
      'regular'
    );
    const recap = buildWeeklyRecap({
      weekStart: MONDAY,
      spends: [spend(0, 50, 'Chai'), spend(1, 60, 'Chai'), spend(3, 40, 'Chai')],
      previousWeekYours: null,
      dailyLimit: 400,
    })!;
    const regular = recap.slides.find((s) => s.id === 'regular')!;
    expect(regular.figure).toBe('Chai');
    expect(regular.line).toBe('3 times, ₹150 in all.');
  });

  it('does not crown a category from uncategorised spending, or when there is only one', () => {
    expect(ids([spend(0, 500, 'X', null), spend(1, 100, 'Y', 'Food')])).not.toContain('category');
    expect(ids([spend(0, 500, 'X', 'Food'), spend(1, 100, 'Y', 'Transport')])).toContain(
      'category'
    );
  });

  it('counts days over the limit and names them', () => {
    const recap = buildWeeklyRecap({
      weekStart: MONDAY,
      spends: [spend(4, 600, 'Toit'), spend(5, 500, 'Pub'), spend(0, 100, 'Chai')],
      previousWeekYours: null,
      dailyLimit: 400,
    })!;
    const limit = recap.slides.find((s) => s.id === 'limit')!;
    expect(limit.figure).toBe('5 of 7 days');
    expect(limit.line).toBe('Over on Fri and Sat.');
  });

  it('lists the days with no spending', () => {
    const quiet = buildWeeklyRecap({
      weekStart: MONDAY,
      spends: [0, 2, 4, 5, 6].map((d) => spend(d, 100, 'Chai')),
      previousWeekYours: null,
      dailyLimit: 400,
    })!.slides.find((s) => s.id === 'quiet')!;
    expect(quiet.figure).toBe('2 days');
    expect(quiet.line).toBe('Tue and Thu.');
  });

  it('leaves out limit slides when no budget is set', () => {
    const got = ids([spend(0, 100, 'Chai'), spend(1, 100, 'Chai')], { dailyLimit: 0 });
    expect(got).not.toContain('limit');
    expect(got).not.toContain('next');
  });
});
