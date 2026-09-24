import { allLines, roast } from '../src/notifications/roasts';

const ctx = {
  amount: 350,
  merchant: 'Swiggy',
  label: 'Swiggy',
  count: 4,
  total: 1280,
  usual: 600,
  cap: 1000,
  overBy: 420,
  target: 380,
  days: 3,
  dayNumber: 2,
  window: 'Friday nights',
  average: 900,
  leftToday: 300,
  goalName: 'Goa trip',
};

describe('roasts', () => {
  it('always carries a number', () => {
    for (const line of allLines(ctx)) {
      // RECOVERY_FAILED's second line is the one deliberate exception.
      if (line.startsWith('the recovery mission did not survive')) continue;
      expect(line).toMatch(/₹|\d/);
    }
  });

  it('roasts the spending, never the person', () => {
    const banned =
      /\b(stupid|dumb|idiot|loser|fat|ugly|broke ass|pathetic|worthless|your (mom|dad|parents))\b/i;
    for (const line of allLines(ctx)) expect(line).not.toMatch(banned);
  });

  it('never renders a hole', () => {
    for (const line of allLines(ctx)) expect(line).not.toMatch(/undefined|NaN|null/);
  });

  it('says double when it is double', () => {
    const line = roast('CALLOUT', 'SAVAGE', ctx, [], () => 0);
    expect(line).toContain('4th Swiggy this week');
    expect(line).toContain('double');
  });

  it('has a firm twin for every kind', () => {
    expect(roast('CAP_BROKEN', 'FIRM', ctx)).toContain('past its');
  });
});
