import { parsePaydayDateOrDays, budgetPreview } from '../budgetService';

describe('budgetPreview', () => {
  it('budgetPreview(21000, 28) returns correct daily value and preview string', () => {
    const result = budgetPreview(21000, 28);
    expect(result).not.toBeNull();
    expect(result?.daily).toBe(750);
    expect(result?.days).toBe(28);
    expect(result?.paydayIso).toBeNull();
    expect(result?.previewString).toContain('₹750 / day');
    expect(result?.previewString).toContain('over the next 28 days');
  });

  it('handles single day with singular "day"', () => {
    const result = budgetPreview(1000, 1);
    expect(result?.previewString).toContain('next 1 day');
    expect(result?.previewString).not.toContain('next 1 days');
  });

  it('returns null for zero days', () => {
    expect(budgetPreview(5000, 0)).toBeNull();
  });

  it('returns null for negative days', () => {
    expect(budgetPreview(5000, -5)).toBeNull();
  });

  it('budgetPreview(5000, "32/13") returns null for invalid day/month', () => {
    expect(budgetPreview(5000, '32/13')).toBeNull();
  });

  it('budgetPreview with DD/MM string returns structured preview', () => {
    const now = new Date(2025, 10, 20);
    const result = budgetPreview(35000, '25/12', now);
    expect(result).not.toBeNull();
    expect(result?.paydayIso).not.toBeNull();
    expect(result?.previewString).toContain('from today until');
  });
});

describe('parsePaydayDateOrDays', () => {
  it('parsePaydayDateOrDays("28") on Jan 1 returns days=28, payday=Jan 29', () => {
    const jan1 = new Date(2025, 0, 1);
    const result = parsePaydayDateOrDays('28', jan1);
    expect(result).not.toBeNull();
    expect(result?.days).toBe(28);
    const payday = new Date(result!.paydayDateIso!);
    expect(payday.getFullYear()).toBe(2025);
    expect(payday.getMonth()).toBe(0);
    expect(payday.getDate()).toBe(29);
  });

  it('parsePaydayDateOrDays("25/12") on Nov 20 2025 returns Dec 25 2025, ~35 days', () => {
    const nov20 = new Date(2025, 10, 20);
    const result = parsePaydayDateOrDays('25/12', nov20);
    expect(result).not.toBeNull();
    const payday = new Date(result!.paydayDateIso!);
    expect(payday.getFullYear()).toBe(2025);
    expect(payday.getMonth()).toBe(11);
    expect(payday.getDate()).toBe(25);
    expect(result?.days).toBeGreaterThanOrEqual(34);
    expect(result?.days).toBeLessThanOrEqual(36);
  });

  it('parsePaydayDateOrDays("05/01") on Dec 31 2025 rolls over to Jan 5 2026', () => {
    const dec31 = new Date(2025, 11, 31);
    const result = parsePaydayDateOrDays('05/01', dec31);
    expect(result).not.toBeNull();
    const payday = new Date(result!.paydayDateIso!);
    expect(payday.getFullYear()).toBe(2026);
    expect(payday.getMonth()).toBe(0);
    expect(payday.getDate()).toBe(5);
    expect(result?.days).toBe(5);
  });

  it('parsePaydayDateOrDays("nonsense") returns null', () => {
    expect(parsePaydayDateOrDays('nonsense')).toBeNull();
  });

  it('returns null for invalid day range (32/01)', () => {
    expect(parsePaydayDateOrDays('32/01')).toBeNull();
  });

  it('returns null for invalid month range (01/13)', () => {
    expect(parsePaydayDateOrDays('01/13')).toBeNull();
  });

  it('returns null for invalid calendar date like Feb 30', () => {
    expect(parsePaydayDateOrDays('30/02')).toBeNull();
  });

  it('handles single digit day and month formats like "5/3"', () => {
    const now = new Date(2025, 2, 1);
    const result = parsePaydayDateOrDays('5/3', now);
    expect(result).not.toBeNull();
    const payday = new Date(result!.paydayDateIso!);
    expect(payday.getMonth()).toBe(2);
    expect(payday.getDate()).toBe(5);
  });

  it('returns null for empty string', () => {
    expect(parsePaydayDateOrDays('')).toBeNull();
  });
});
