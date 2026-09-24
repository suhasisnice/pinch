import * as db from '../src/db/dbService';
import { postInvestment } from '../src/services/captureService';
import { getBudgetSnapshot } from '../src/services/budgetService';
import {
  getWealthSnapshot,
  payCushion,
  payGoals,
  savePayPlan,
  startCushion,
} from '../src/services/wealthService';
import { goalReserve } from '../src/math/budget';
import { DEFAULT_PAY_PLAN, clampPlan, payday, splitAcrossGoals } from '../src/math/payday';
import {
  HABIT_RATE,
  habitInsight,
  habitLine,
  habitStreak,
  keptRate,
  netWorth,
  nextMilestone,
  reachedMilestones,
} from '../src/math/progress';
import { setMonthlyAllowance } from '../src/settings/settingsStore';
import { createSqlJsAdapter } from './utils/sqljsAdapter';
import { disableConfirmGate } from './utils/settings';

const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
  await disableConfirmGate();
});

// ---------------------------------------------------------------------------
// The per-period goal reserve (the double-count fix)
// ---------------------------------------------------------------------------

describe('goalReserve holds back only this period’s savings', () => {
  it('does not charge this period for money saved in an earlier one', () => {
    // ₹10,000 already in a no-deadline goal from past months, nothing this month.
    const reserve = goalReserve({
      targetAmount: 30_000,
      savedAmount: 10_000,
      savedThisPeriod: 0,
      daysUntilDeadline: null,
      daysRemainingInPeriod: 30,
    });
    // Only the forward pacing share of what is still needed, not the ₹10,000 again.
    expect(reserve).toBeCloseTo((20_000 * 30) / 90, 5);
  });

  it('still holds what was set aside this period', () => {
    expect(
      goalReserve({
        targetAmount: 30_000,
        savedAmount: 10_000,
        savedThisPeriod: 2000,
        daysUntilDeadline: null,
        daysRemainingInPeriod: 30,
      })
    ).toBeCloseTo(2000 + (20_000 * 30) / 90, 5);
  });

  it('releases money taken back out of old savings this period', () => {
    expect(
      goalReserve({
        targetAmount: 30_000,
        savedAmount: 8000,
        savedThisPeriod: -2000,
        daysUntilDeadline: null,
        daysRemainingInPeriod: 30,
        paced: false,
      })
    ).toBe(-2000);
  });

  it('with a plan in force, holds only what was actually set aside', () => {
    expect(
      goalReserve({
        targetAmount: 3000,
        savedAmount: 0,
        savedThisPeriod: 0,
        daysUntilDeadline: 10,
        daysRemainingInPeriod: 30,
        paced: false,
      })
    ).toBe(0);
  });

  it('against real SQL: last period’s savings leave this period’s daily limit alone', async () => {
    const goal = await db.createGoal({ name: 'Laptop', targetAmount: 9000 });
    const before = await getBudgetSnapshot(15_000);
    // Saved 40 days ago — an earlier period's money.
    await db.contributeToGoal(
      goal,
      3000,
      'MANUAL',
      null,
      new Date(Date.now() - 40 * DAY).toISOString()
    );
    const after = await getBudgetSnapshot(15_000);
    // Under the cap: only the pace share of the ₹6,000 still needed, not the ₹3,000 again.
    expect(after.budget.goalReserve).toBeCloseTo(before.budget.goalReserve * (6000 / 9000), 5);
    expect(after.budget.spendablePool).toBeGreaterThan(before.budget.spendablePool);
  });
});

// ---------------------------------------------------------------------------
// Payday maths
// ---------------------------------------------------------------------------

describe('payday', () => {
  const base = {
    allowance: 15_000,
    plan: { ...DEFAULT_PAY_PLAN, enabled: true },
    cushionRemaining: 45_000,
    openGoals: 2,
    sipDue: 0,
    cushionDone: 0,
    goalsDone: 0,
    investedDone: 0,
  };

  it('splits the allowance first and gives spending the rest', () => {
    const p = payday(base);
    expect(p.items.map((i) => [i.key, i.amount])).toEqual([
      ['CUSHION', 1500],
      ['GOALS', 750],
    ]);
    expect(p.total).toBe(2250);
    expect(p.forSpending).toBe(12_750);
    expect(p.reserve).toBe(2250);
    expect(p.allDone).toBe(false);
  });

  it('ticking an item moves its money from reserve to done — the total is unchanged', () => {
    const p = payday({ ...base, cushionDone: 1500 });
    expect(p.total).toBe(2250);
    expect(p.reserve).toBe(750);
    expect(p.items[0].complete).toBe(true);
  });

  it('never asks the cushion for more than it needed at payday', () => {
    // ₹400 still needed now, ₹300 already put in today: it needed ₹700 at payday.
    const p = payday({ ...base, cushionRemaining: 400, cushionDone: 300 });
    expect(p.items[0].amount).toBe(700);
  });

  it('flags an idle cushion share once the cushion is full', () => {
    const p = payday({ ...base, cushionRemaining: 0 });
    expect(p.items.find((i) => i.key === 'CUSHION')).toBeUndefined();
    expect(p.cushionShareIdle).toBe(true);
  });

  it('drops the goals line when there are no open goals', () => {
    expect(payday({ ...base, openGoals: 0 }).items.map((i) => i.key)).toEqual(['CUSHION']);
  });

  it('invests at least what the SIPs falling due ask for', () => {
    const p = payday({ ...base, plan: { ...base.plan, investPct: 0.02 }, sipDue: 1000 });
    expect(p.items.find((i) => i.key === 'INVEST')?.amount).toBe(1000);
  });

  it('caps the whole plan at half the allowance', () => {
    const c = clampPlan({ enabled: true, cushionPct: 0.4, goalsPct: 0.3, investPct: 0.3 });
    expect(c.cushionPct + c.goalsPct + c.investPct).toBeCloseTo(0.5, 9);
  });

  it('splits a goals amount by what each goal still needs, to the rupee', () => {
    const shares = splitAcrossGoals(750, [
      { id: 1, remaining: 40_000 },
      { id: 2, remaining: 6000 },
      { id: 3, remaining: 0 },
    ]);
    expect(shares.reduce((s, x) => s + x.amount, 0)).toBe(750);
    expect(shares.find((s) => s.id === 1)!.amount).toBeGreaterThan(
      shares.find((s) => s.id === 2)!.amount
    );
    expect(shares.find((s) => s.id === 3)).toBeUndefined();
  });

  it('never overfills a nearly finished goal', () => {
    expect(splitAcrossGoals(750, [{ id: 1, remaining: 200 }])).toEqual([{ id: 1, amount: 200 }]);
  });
});

describe('pay yourself first, against real SQL', () => {
  beforeEach(async () => {
    await setMonthlyAllowance(15_000);
  });

  it('holds the plan back from day one, and ticking it off leaves Today unchanged', async () => {
    await db.createGoal({ name: 'Goa', targetAmount: 8000 });
    const off = await getBudgetSnapshot(15_000);

    await savePayPlan({ ...DEFAULT_PAY_PLAN, enabled: true });
    const planned = await getBudgetSnapshot(15_000);
    expect(planned.payday?.total).toBe(2250);
    expect(planned.budget.planReserve).toBe(2250);

    await payCushion(1500);
    await payGoals(750);
    const ticked = await getBudgetSnapshot(15_000);
    expect(ticked.payday?.allDone).toBe(true);
    expect(ticked.budget.planReserve).toBe(0);
    expect(ticked.budget.spendablePool).toBeCloseTo(planned.budget.spendablePool, 6);
    // Spending really does get 85% of the allowance, not the old paced figure.
    expect(ticked.budget.spendablePool).toBeCloseTo(12_750, 6);
    expect(off.payday).toBeNull();
  });

  it('counts an investment as the invest line being done', async () => {
    await savePayPlan({ enabled: true, cushionPct: 0, goalsPct: 0, investPct: 0.05 });
    const fund = await db.createHolding({ name: 'Index' });
    await postInvestment({
      amount: 750,
      direction: 'CONTRIBUTION',
      label: 'Groww',
      holdingId: fund,
    });
    const snap = await getBudgetSnapshot(15_000);
    expect(snap.payday?.items).toEqual([{ key: 'INVEST', amount: 750, done: 750, complete: true }]);
    expect(snap.budget.spendablePool).toBeCloseTo(14_250, 6);
  });

  it('switching the plan on creates the cushion', async () => {
    await savePayPlan({ ...DEFAULT_PAY_PLAN, enabled: true });
    const snap = await getWealthSnapshot();
    expect(snap.cushion?.name).toBe('Emergency fund');
    expect(snap.cushion?.targetAmount).toBe(45_000);
  });
});

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

describe('netWorth', () => {
  it('adds investments and what friends owe, subtracts what you owe', () => {
    expect(netWorth({ bank: 20_000, investments: 8000, owedToYou: 1200, youOwe: 500 })).toBe(
      28_700
    );
  });

  it('is unknown without a bank balance — never guessed', () => {
    expect(netWorth({ bank: null, investments: 8000, owedToYou: 0, youOwe: 0 })).toBeNull();
  });
});

describe('the saving habit', () => {
  it('rates kept money against what came in', () => {
    expect(keptRate(1500, 15_000)).toBeCloseTo(0.1, 9);
    expect(keptRate(100, 0)).toBe(0);
  });

  it('counts a streak of periods at or above 10%, newest first', () => {
    expect(habitStreak([0.12, HABIT_RATE, 0.15, 0.02, 0.3])).toBe(3);
    expect(habitStreak([0.05, 0.2])).toBe(0);
  });

  it('says something kind in every direction', () => {
    expect(habitLine([])).toMatch(/first month/i);
    expect(habitLine([{ rate: 0.09 }, { rate: 0.18 }])).toMatch(/up from 9%/);
    expect(habitLine([{ rate: 0.18 }, { rate: 0.05 }])).toMatch(/Plenty of month left/);
  });
});

describe('milestones', () => {
  const state = {
    totalKept: 0,
    cushionFraction: null,
    paydayDoneEver: false,
    habitStreak: 0,
    putIn: 0,
    netWorth: null,
  };

  it('starts with the first ₹1,000 and says how far off it is', () => {
    expect(nextMilestone({ ...state, totalKept: 300 }, new Set())).toEqual({
      title: 'First ₹1,000 kept',
      toGo: 700,
    });
  });

  it('reaches several at once and moves the next one along', () => {
    const s = { ...state, totalKept: 5000, paydayDoneEver: true, cushionFraction: 0.6 };
    expect(reachedMilestones(s)).toEqual(['FIRST_1K', 'FIRST_PAYDAY', 'CUSHION_HALF']);
    expect(nextMilestone(s, new Set(reachedMilestones(s)))?.title).toBe('Cushion full');
  });

  it('keeps the first date a milestone was reached', async () => {
    expect(await db.markMilestone('FIRST_1K', new Date(2026, 0, 1))).toBe(true);
    expect(await db.markMilestone('FIRST_1K', new Date(2026, 5, 1))).toBe(false);
    expect(new Date((await db.getMilestones()).get('FIRST_1K')!).getMonth()).toBe(0);
  });
});

describe('habitInsight', () => {
  it('turns a quarter of the biggest discretionary habit into a ten-year figure', () => {
    const insight = habitInsight(
      [
        { category: 'Academics', total: 5000 },
        { category: 'Food', total: 1900 },
        { category: 'Shopping', total: 900 },
      ],
      15,
      0.1
    );
    expect(insight?.category).toBe('Food'); // fees are never the thing to trim
    expect(insight?.monthly).toBeCloseTo(3800, 5);
    expect(insight?.trimmed).toBe(950);
    expect(insight?.tenYears).toBeGreaterThan(950 * 120);
  });

  it('stays quiet early in the month or when nothing is big', () => {
    expect(habitInsight([{ category: 'Food', total: 1900 }], 3, 0.1)).toBeNull();
    expect(habitInsight([{ category: 'Food', total: 100 }], 20, 0.1)).toBeNull();
  });
});

describe('net worth history', () => {
  it('keeps one figure per month, the latest of that month', async () => {
    await db.recordNetWorth(10_000, new Date(2026, 7, 3));
    await db.recordNetWorth(12_000, new Date(2026, 7, 20));
    await db.recordNetWorth(15_000, new Date(2026, 8, 2));
    expect(await db.getNetWorthHistory()).toEqual([
      { month: '2026-08', value: 12_000 },
      { month: '2026-09', value: 15_000 },
    ]);
  });

  it('is recorded by the wealth snapshot once there is a bank balance', async () => {
    expect((await getWealthSnapshot()).netWorth).toBeNull();
    await db.recordBalance(20_000);
    const snap = await getWealthSnapshot();
    expect(snap.netWorth).toBe(20_000);
    expect(snap.netWorthHistory).toHaveLength(1);
  });
});

describe('cushion checklist actions', () => {
  it('payCushion creates the cushion if needed and fills it', async () => {
    await setMonthlyAllowance(10_000);
    await payCushion(1000);
    const id = await startCushion();
    expect((await db.getGoalById(id))?.savedAmount).toBe(1000);
  });
});
