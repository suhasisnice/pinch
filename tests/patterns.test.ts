import {
  SpendCap,
  capCrossing,
  capLevel,
  capMatches,
  findCallouts,
  suggestedCap,
} from '../src/math/patterns';

const s = (merchant: string, amount: number, category: string | null = 'Food') => ({
  merchant,
  amount,
  category,
});

describe('findCallouts', () => {
  it('names a merchant hit often and well above its usual', () => {
    const week = [s('Swiggy', 320), s('Swiggy', 310), s('swiggy', 350), s('Swiggy', 300)];
    // 4 weeks before: ₹2,400 total → ₹600 a week usual.
    const before = Array.from({ length: 8 }, () => s('Swiggy', 300));
    const [c] = findCallouts(week, before);
    expect(c.scope).toBe('MERCHANT');
    expect(c.count).toBe(4);
    expect(c.total).toBe(1280);
    expect(c.usualWeekly).toBe(600);
  });

  it('stays quiet when this week is ordinary for that place', () => {
    const week = [s('Swiggy', 200), s('Swiggy', 200), s('Swiggy', 200)];
    const before = Array.from({ length: 12 }, () => s('Swiggy', 200)); // 600/week usual
    expect(findCallouts(week, before)).toEqual([]);
  });

  it('stays quiet for small change, however often', () => {
    const week = [s('Chai', 20), s('Chai', 20), s('Chai', 20), s('Chai', 20)];
    expect(findCallouts(week, [])).toEqual([]);
  });

  it('needs three visits, not one big one', () => {
    expect(findCallouts([s('Croma', 5000, 'Shopping')], [])).toEqual([]);
  });

  it('falls back to the category when no one merchant explains it', () => {
    const week = [s('Zomato', 200), s('Swiggy', 200), s('Dominos', 250)];
    const [c] = findCallouts(week, []);
    expect(c.scope).toBe('CATEGORY');
    expect(c.label).toBe('Food');
  });

  it('does not repeat a merchant callout as its category', () => {
    const week = [s('Swiggy', 400), s('Swiggy', 400), s('Swiggy', 400)];
    const callouts = findCallouts(week, []);
    expect(callouts.map((c) => c.scope)).toEqual(['MERCHANT']);
  });
});

describe('caps', () => {
  const cap: SpendCap = {
    id: 1,
    scope: 'MERCHANT',
    key: 'swiggy',
    label: 'Swiggy',
    weeklyAmount: 600,
  };

  it('reads OK, near and broken', () => {
    expect(capLevel(cap, 400)).toBe('OK');
    expect(capLevel(cap, 480)).toBe('NEAR');
    expect(capLevel(cap, 600)).toBe('NEAR');
    expect(capLevel(cap, 601)).toBe('BROKEN');
  });

  it('speaks on crossing into near, once', () => {
    expect(capCrossing(cap, 400, 500)).toBe('NEAR');
    expect(capCrossing(cap, 500, 550)).toBeNull();
  });

  it('speaks on every payment past the line', () => {
    expect(capCrossing(cap, 550, 700)).toBe('BROKEN');
    expect(capCrossing(cap, 700, 800)).toBe('BROKEN');
  });

  it('matches merchant caps by name, category caps by category', () => {
    expect(capMatches(cap, { merchant: ' SWIGGY ', category: 'Food' })).toBe(true);
    const food: SpendCap = { ...cap, scope: 'CATEGORY', key: 'food', label: 'Food' };
    expect(capMatches(food, { merchant: 'Zomato', category: 'Food' })).toBe(true);
    expect(capMatches(food, { merchant: 'Zomato', category: null })).toBe(false);
  });

  it('suggests the usual week, rounded', () => {
    expect(
      suggestedCap({
        scope: 'MERCHANT',
        label: 'Swiggy',
        key: 'swiggy',
        count: 4,
        total: 1280,
        usualWeekly: 610,
      })
    ).toBe(600);
    expect(
      suggestedCap({
        scope: 'MERCHANT',
        label: 'Swiggy',
        key: 'swiggy',
        count: 4,
        total: 1000,
        usualWeekly: 0,
      })
    ).toBe(600);
  });
});
