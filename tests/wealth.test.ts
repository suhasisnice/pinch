import * as db from '../src/db/dbService';
import {
  acceptCapture,
  acceptCaptureAsInvestment,
  ingestMessage,
  postInvestment,
} from '../src/services/captureService';
import { getBudgetSnapshot } from '../src/services/budgetService';
import { getWealthSnapshot, startCushion } from '../src/services/wealthService';
import { computeBudget } from '../src/math/budget';
import {
  cushionTarget,
  holdingWorth,
  ladder,
  looksLikeInvestment,
  monthsBetween,
  projectValue,
  sipOccurrences,
  sipReserve,
} from '../src/math/wealth';
import { setMonthlyAllowance } from '../src/settings/settingsStore';
import { createSqlJsAdapter } from './utils/sqljsAdapter';
import { disableConfirmGate } from './utils/settings';

beforeEach(async () => {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
  await disableConfirmGate();
});

// ---------------------------------------------------------------------------
// Pure maths
// ---------------------------------------------------------------------------

describe('sipOccurrences', () => {
  const at = (y: number, m: number, d: number) => new Date(y, m, d).toISOString();

  it('counts the one due date inside a month-long window', () => {
    expect(sipOccurrences(5, at(2026, 8, 1), at(2026, 9, 1))).toBe(1);
  });

  it('counts none when the day falls just outside', () => {
    expect(sipOccurrences(5, at(2026, 8, 6), at(2026, 9, 5))).toBe(0);
  });

  it('includes the start day and excludes the end day', () => {
    expect(sipOccurrences(10, at(2026, 8, 10), at(2026, 8, 11))).toBe(1);
    expect(sipOccurrences(10, at(2026, 8, 9), at(2026, 8, 10))).toBe(0);
  });

  it('counts twice across a window longer than a month', () => {
    expect(sipOccurrences(15, at(2026, 0, 1), at(2026, 2, 1))).toBe(2);
  });

  it('crosses a year boundary', () => {
    expect(sipOccurrences(3, at(2026, 11, 20), at(2027, 0, 19))).toBe(1);
  });

  it('is zero for an empty or inverted window', () => {
    expect(sipOccurrences(3, at(2026, 1, 1), at(2026, 1, 1))).toBe(0);
    expect(sipOccurrences(3, at(2026, 2, 1), at(2026, 1, 1))).toBe(0);
  });
});

describe('sipReserve', () => {
  const start = new Date(2026, 8, 1).toISOString();
  const end = new Date(2026, 9, 1).toISOString();

  it('holds back the full amount before the contribution is logged', () => {
    expect(sipReserve([{ amount: 1000, day: 5, contributedInWindow: 0 }], start, end)).toBe(1000);
  });

  it('drops by exactly what was contributed, and never below zero', () => {
    expect(sipReserve([{ amount: 1000, day: 5, contributedInWindow: 400 }], start, end)).toBe(600);
    expect(sipReserve([{ amount: 1000, day: 5, contributedInWindow: 1500 }], start, end)).toBe(0);
  });

  it('sums several plans and ignores a zero plan', () => {
    expect(
      sipReserve(
        [
          { amount: 1000, day: 5, contributedInWindow: 0 },
          { amount: 500, day: 20, contributedInWindow: 0 },
          { amount: 0, day: 10, contributedInWindow: 0 },
        ],
        start,
        end
      )
    ).toBe(1500);
  });
});

describe('projectValue', () => {
  it('is simple addition at a zero rate', () => {
    expect(projectValue(1000, 500, 0, 1)).toBeCloseTo(7000, 6);
  });

  it('compounds a lump sum to the stated annual rate after a year', () => {
    expect(projectValue(1000, 0, 0.1, 1)).toBeCloseTo(1100, 6);
  });

  it('grows a monthly habit to more than the sum put in', () => {
    const tenYears = projectValue(0, 1000, 0.1, 10);
    expect(tenYears).toBeGreaterThan(120_000);
    // ~₹2.0L for ₹1.2L put in at an effective 10% a year.
    expect(tenYears).toBeGreaterThan(195_000);
    expect(tenYears).toBeLessThan(205_000);
  });

  it('returns today for zero years', () => {
    expect(projectValue(5000, 1000, 0.1, 0)).toBe(5000);
  });
});

describe('ladder', () => {
  const base = {
    cushionSaved: 0,
    cushionTarget: 30_000,
    hasPlan: false,
    monthsContributed: 0,
    monthsInvested: null,
  };

  it('starts on the cushion', () => {
    expect(ladder(base).current).toBe(1);
  });

  it('moves to the habit once the cushion is full', () => {
    const l = ladder({ ...base, cushionSaved: 30_000 });
    expect(l.cushion.done).toBe(true);
    expect(l.current).toBe(2);
  });

  it('needs a plan AND three months of contributions for the habit', () => {
    expect(
      ladder({ ...base, cushionSaved: 30_000, hasPlan: true, monthsContributed: 2 }).current
    ).toBe(2);
    expect(
      ladder({ ...base, cushionSaved: 30_000, hasPlan: false, monthsContributed: 5 }).current
    ).toBe(2);
    expect(
      ladder({ ...base, cushionSaved: 30_000, hasPlan: true, monthsContributed: 3 }).current
    ).toBe(3);
  });

  it('finishes after twelve months invested', () => {
    const l = ladder({
      cushionSaved: 30_000,
      cushionTarget: 30_000,
      hasPlan: true,
      monthsContributed: 12,
      monthsInvested: 12,
    });
    expect(l.current).toBe(4);
  });

  it('never calls an empty target a finished cushion', () => {
    expect(ladder({ ...base, cushionTarget: 0 }).cushion.done).toBe(false);
  });

  it('sizes the cushion at three months of allowance', () => {
    expect(cushionTarget(8000)).toBe(24_000);
  });
});

describe('monthsBetween', () => {
  it('floors partial months', () => {
    expect(
      monthsBetween(new Date(2026, 0, 15).toISOString(), new Date(2026, 2, 14).toISOString())
    ).toBe(1);
    expect(
      monthsBetween(new Date(2026, 0, 15).toISOString(), new Date(2026, 2, 15).toISOString())
    ).toBe(2);
  });
});

describe('holdingWorth', () => {
  it('uses the typed value, else exactly what went in — never a guess', () => {
    expect(holdingWorth(10_000, 11_200)).toBe(11_200);
    expect(holdingWorth(10_000, null)).toBe(10_000);
  });
});

describe('looksLikeInvestment', () => {
  it.each([
    'Rs.1000 debited from A/c XX1234 to GROWW SIP on 05-09',
    'Your SIP of Rs 500 in Parag Parikh Flexi Cap has been processed',
    'Rs 2000 debited towards INDIAN CLEARING CORP via NACH',
    'ACH D- ICCL Zerodha Rs.1500',
    'Rs 5,000 credited: redemption of units',
    'Deposit of Rs 500 to your PPF account',
  ])('asks about: %s', (text) => {
    expect(looksLikeInvestment(text)).toBe(true);
  });

  it.each([
    'Rs.329.00 debited from A/c XX1234 to Rahul',
    'Paid Rs 120 to Swiggy',
    'Rs 300 spent at Coinbase Cafe', // "coin" is not a word on the list, and "Coinbase" never matches "kite"/"sip"
    'Rs 450 at MISSISSIPPI DINER', // "sip" only as a whole word
    'Rs 90 to BSEB exam fee', // not "BSE Ltd"
  ])('leaves alone: %s', (text) => {
    expect(looksLikeInvestment(text)).toBe(false);
  });

  it('can match on the merchant alone', () => {
    expect(looksLikeInvestment('Rs 500 paid', 'Groww')).toBe(true);
  });
});

describe('computeBudget with investing', () => {
  const base = {
    allowance: 10_000,
    topUps: 0,
    grossSpend: 0,
    settledIn: 0,
    settledOut: 0,
    expectedRecovery: 0,
    openPayables: 0,
    goalReserve: 0,
    daysRemaining: 10,
  };

  it('treats a plan as protected money and invested cash as gone, not spent', () => {
    const planned = computeBudget({ ...base, planReserve: 1000 });
    const paid = computeBudget({ ...base, planReserve: 0, investedNet: 1000 });
    // Paying the plan moves nothing: the decision was made when it was set.
    expect(paid.spendablePool).toBe(planned.spendablePool);
    expect(planned.protectedMoney).toBe(1000);
    expect(paid.protectedMoney).toBe(0);
    expect(paid.grossSpend).toBe(0);
  });

  it('a withdrawal returns cash to the pool', () => {
    expect(computeBudget({ ...base, investedNet: -2000 }).spendablePool).toBe(12_000);
  });
});

// ---------------------------------------------------------------------------
// Against real SQL
// ---------------------------------------------------------------------------

describe('holdings', () => {
  it('sums what went in per holding, keeps unassigned money separate', async () => {
    const fund = await db.createHolding({ name: 'Index fund', kind: 'MUTUAL_FUND' });
    await postInvestment({
      amount: 1000,
      direction: 'CONTRIBUTION',
      label: 'Groww',
      holdingId: fund,
    });
    await postInvestment({
      amount: 1000,
      direction: 'CONTRIBUTION',
      label: 'Groww',
      holdingId: fund,
    });
    await postInvestment({ amount: 300, direction: 'WITHDRAWAL', label: 'Groww', holdingId: fund });
    await postInvestment({ amount: 700, direction: 'CONTRIBUTION', label: 'Old Phase 9 entry' });

    const [holding] = await db.getHoldings();
    expect(holding.putIn).toBe(1700);
    expect(await db.getUnassignedInvested()).toBe(700);
    // Phase 9's single total still agrees with the sum of the parts.
    expect(await db.getTotalInvested()).toBe(2400);
  });

  it('ignores an ordinary spend at a merchant that shares a name', async () => {
    const fund = await db.createHolding({ name: 'Groww' });
    await db.addTransaction({ amount: 99, direction: 'DEBIT', kind: 'SPEND', merchant: 'Groww' });
    expect((await db.getHoldings()).find((h) => h.id === fund)?.putIn).toBe(0);
  });

  it('keeps an archived holding out of the list but its money in the total', async () => {
    const fund = await db.createHolding({ name: 'Gold' });
    await postInvestment({
      amount: 500,
      direction: 'CONTRIBUTION',
      label: 'Gold',
      holdingId: fund,
    });
    await db.archiveHolding(fund);
    expect(await db.getHoldings()).toHaveLength(0);
    expect(await db.getTotalInvested()).toBe(500);
  });

  it('stores a typed value and its date, and can forget it', async () => {
    const fund = await db.createHolding({ name: 'FD' });
    await db.setHoldingValue(fund, 10_450);
    let [h] = await db.getHoldings();
    expect(h.currentValue).toBe(10_450);
    expect(h.valueUpdatedAt).not.toBeNull();
    await db.setHoldingValue(fund, null);
    [h] = await db.getHoldings();
    expect(h.currentValue).toBeNull();
    expect(h.valueUpdatedAt).toBeNull();
  });

  it('clamps a plan day into 1–28 and clears the day when the plan stops', async () => {
    const fund = await db.createHolding({ name: 'Index', sipAmount: 500, sipDay: 31 });
    expect((await db.getHoldings())[0].sipDay).toBe(28);
    await db.setHoldingPlan(fund, 0, 10);
    const [h] = await db.getHoldings();
    expect(h.sipAmount).toBeNull();
    expect(h.sipDay).toBeNull();
  });
});

describe('the budget with a monthly plan', () => {
  it('holds the plan back, then paying it leaves the daily limit unchanged', async () => {
    const before = await getBudgetSnapshot(10_000);
    const day = new Date(before.periodStart).getDate();
    const due = Math.min(28, Math.max(1, day));
    const fund = await db.createHolding({ name: 'Index', sipAmount: 1000, sipDay: due });

    const planned = await getBudgetSnapshot(10_000);
    const occurrences = sipOccurrences(due, planned.periodStart, planned.periodEnd);
    expect(planned.budget.planReserve).toBe(1000 * occurrences);
    expect(planned.budget.spendablePool).toBeCloseTo(
      before.budget.spendablePool - 1000 * occurrences,
      6
    );

    await postInvestment({
      amount: 1000,
      direction: 'CONTRIBUTION',
      label: 'Groww',
      holdingId: fund,
    });
    const paid = await getBudgetSnapshot(10_000);
    expect(paid.budget.investedNet).toBe(1000);
    expect(paid.budget.spendablePool).toBeCloseTo(planned.budget.spendablePool, 6);
    // Investing is never spending.
    expect(paid.budget.grossSpend).toBe(0);
  });

  it('an unplanned investment still leaves the pool, because the cash left', async () => {
    const before = await getBudgetSnapshot(10_000);
    await postInvestment({ amount: 2500, direction: 'CONTRIBUTION', label: 'Zerodha' });
    const after = await getBudgetSnapshot(10_000);
    expect(after.budget.spendablePool).toBeCloseTo(before.budget.spendablePool - 2500, 6);
    expect(after.budget.grossSpend).toBe(0);
  });
});

describe('capture: investments are asked about, never decided', () => {
  const sip = {
    source: 'SMS' as const,
    sender: 'VM-HDFCBK',
    body: 'Rs.1000.00 debited from A/c XX1234 on 05-09-25 to GROWW SIP. Avl Bal Rs.4,500.00 -HDFC Bank',
    receivedAt: Date.now(),
  };

  it('files a confident SIP debit in Review with the suggestion, not in the ledger', async () => {
    expect(await ingestMessage(sip)).toBe('QUEUED');
    expect(await db.getAllTransactions()).toHaveLength(0);
    const [capture] = await db.getPendingCaptures();
    expect(capture.suggested_reason).toBe('INVESTMENT');
  });

  it('also asks during a silent backfill', async () => {
    expect(await ingestMessage(sip, { silent: true })).toBe('QUEUED');
  });

  it('"Yes, invested" books it as an investment into the chosen holding, keeping the evidence', async () => {
    const fund = await db.createHolding({ name: 'Index' });
    await ingestMessage(sip);
    const [capture] = await db.getPendingCaptures();

    const id = await acceptCaptureAsInvestment(capture.id, fund);
    const tx = await db.getTransactionById(id!);
    expect(tx?.non_spend_reason).toBe('INVESTMENT');
    expect(tx?.raw_text).toContain('GROWW SIP');
    expect((await db.getHoldings())[0].putIn).toBe(1000);
    expect(await db.getPendingCaptures()).toHaveLength(0);
  });

  it('"No, a normal spend" books it as ordinary spending', async () => {
    await ingestMessage(sip);
    const [capture] = await db.getPendingCaptures();
    const id = await acceptCapture(capture.id);
    const tx = await db.getTransactionById(id!);
    expect(tx?.non_spend_reason).toBeNull();
    expect(tx?.kind).toBe('SPEND');
  });

  it('does not flag an ordinary payment', async () => {
    const result = await ingestMessage({
      ...sip,
      body: 'Rs.329.00 debited from A/c XX1234 on 08-09-25 to Rahul. Avl Bal Rs.4,500.00 -HDFC Bank',
    });
    expect(result).toBe('POSTED');
  });
});

describe('wealth snapshot', () => {
  it('sizes a new cushion from the allowance and reads rung one from it', async () => {
    await setMonthlyAllowance(8000);
    const id = await startCushion();
    expect(await startCushion()).toBe(id); // idempotent

    const snap = await getWealthSnapshot();
    expect(snap.cushion?.targetAmount).toBe(24_000);
    expect(snap.ladder.current).toBe(1);

    await db.contributeToGoal(id, 24_000);
    expect((await getWealthSnapshot()).ladder.current).toBe(2);
  });

  it('adds typed values and put-in into one worth, and plans into one monthly', async () => {
    const a = await db.createHolding({ name: 'A', sipAmount: 1000, sipDay: 5 });
    const b = await db.createHolding({ name: 'B', sipAmount: 500, sipDay: 20 });
    await postInvestment({ amount: 10_000, direction: 'CONTRIBUTION', label: 'A', holdingId: a });
    await postInvestment({ amount: 4000, direction: 'CONTRIBUTION', label: 'B', holdingId: b });
    await db.setHoldingValue(a, 11_000);

    const snap = await getWealthSnapshot();
    expect(snap.putIn).toBe(14_000);
    expect(snap.worth).toBe(15_000);
    expect(snap.monthly).toBe(1500);
  });
});
