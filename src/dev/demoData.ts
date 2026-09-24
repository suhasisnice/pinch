import * as db from '../db/dbService';
import {
  setCushionGoalId,
  setMonthlyAllowance,
  setOnboarded,
  setPayPlan,
} from '../settings/settingsStore';
import { postInvestment } from '../services/captureService';

/**
 * A believable month for a college student, for the web design preview.
 *
 * Every name and number here is invented. It exists so each screen has
 * something realistic to lay out — long merchant names, a split dinner, a
 * partly-repaid loan, a goal half way, an outing in progress, items waiting in
 * Review — rather than being designed against an empty state.
 */
export async function seedDemoData(now: Date = new Date()): Promise<void> {
  const DAY = 24 * 60 * 60 * 1000;
  const at = (daysAgo: number, hour: number, minute = 0) => {
    const d = new Date(now.getTime() - daysAgo * DAY);
    d.setHours(hour, minute, 0, 0);
    // Never in the future: today's entries land earlier today instead.
    if (d > now) return new Date(now.getTime() - (24 - hour) * 12 * 60 * 1000).toISOString();
    return d.toISOString();
  };

  await setOnboarded(true);
  await setMonthlyAllowance(15000);
  // Period started 16 days ago, 30 days long.
  await db.startBudgetPeriod({
    allowance: 15000,
    days: 30,
    now: new Date(now.getTime() - 16 * DAY),
  });

  const spend = (
    daysAgo: number,
    hour: number,
    amount: number,
    merchant: string,
    category: string | null,
    source: 'MANUAL' | 'SMS' | 'NOTIFICATION' = 'NOTIFICATION'
  ) =>
    db.addTransaction({
      amount,
      direction: 'DEBIT',
      kind: 'SPEND',
      merchant,
      category,
      occurredAt: at(daysAgo, hour),
      source,
      rawText: source === 'MANUAL' ? null : `Paid Rs.${amount} to ${merchant}`,
    });

  // A month of ordinary spending.
  const routine: Array<[number, number, number, string, string | null]> = [
    [0, 9, 40, 'Campus Canteen', 'Food'],
    [0, 13, 185, 'Swiggy', 'Food'],
    [0, 18, 60, 'Rapido', 'Transport'],
    [1, 10, 40, 'Campus Canteen', 'Food'],
    [1, 20, 349, 'Zomato', 'Food'],
    [2, 9, 40, 'Campus Canteen', 'Food'],
    [2, 16, 120, 'Chai Point', 'Food'],
    [3, 11, 899, 'Amazon', 'Shopping'],
    [3, 19, 85, 'Namma Yatri', 'Transport'],
    [4, 9, 40, 'Campus Canteen', 'Food'],
    [4, 23, 240, 'Swiggy Instamart', 'Food'],
    [5, 12, 1450, 'Sapna Book House', 'Academics'],
    [6, 21, 2400, 'Toit Brewpub', 'Outing'],
    [7, 9, 40, 'Campus Canteen', 'Food'],
    [7, 14, 199, 'Spotify', 'Subscriptions'],
    [8, 18, 150, 'Rapido', 'Transport'],
    [9, 13, 260, 'Swiggy', 'Food'],
    [10, 10, 40, 'Campus Canteen', 'Food'],
    [10, 17, 650, 'PVR Cinemas', 'Outing'],
    [11, 9, 40, 'Campus Canteen', 'Food'],
    [12, 20, 420, 'Zomato', 'Food'],
    [13, 15, 310, 'Apollo Pharmacy', 'Health'],
    [14, 11, 1299, 'Myntra', 'Shopping'],
    [15, 9, 40, 'Campus Canteen', 'Food'],
    [15, 19, 90, 'Namma Yatri', 'Transport'],
    [16, 12, 499, 'Airtel Recharge', 'Bills'],
    [2, 22, 75, 'VPA 9876xxxx@ybl', null],
    [9, 22, 130, 'PAYU*MERCHANT', null],
  ];
  const ids: number[] = [];
  for (const [d, h, amount, merchant, category] of routine) {
    ids.push(await spend(d, h, amount, merchant, category));
  }
  // Earlier months, so trends and recurring charges have history.
  for (let m = 1; m <= 4; m++) {
    await spend(30 * m + 7, 14, 199, 'Spotify', 'Subscriptions');
    await spend(30 * m + 3, 13, 2600 + m * 300, 'Swiggy', 'Food');
    await spend(30 * m + 10, 18, 900 + m * 120, 'Rapido', 'Transport');
    await spend(30 * m + 12, 20, 1500 + m * 200, 'Toit Brewpub', 'Outing');
    await spend(30 * m + 16, 12, 499, 'Airtel Recharge', 'Bills');
  }

  // The dinner at Toit was for four; three friends owe their share.
  const toit = ids[routine.findIndex((r) => r[3] === 'Toit Brewpub')];
  const aarav = await db.addContact('Aarav Mehta');
  const diya = await db.addContact('Diya Sharma');
  const kabir = await db.addContact('Kabir Rao');
  for (const friend of [aarav, diya, kabir]) {
    await db.createIOU({
      contactId: friend,
      amount: 600,
      direction: 'THEY_OWE_ME',
      transactionId: toit,
    });
  }
  // Diya paid back.
  const diyaBack = await db.addTransaction({
    amount: 600,
    direction: 'CREDIT',
    kind: 'SETTLE_IN',
    merchant: 'Diya Sharma',
    occurredAt: at(4, 12),
    source: 'NOTIFICATION',
    rawText: 'Diya Sharma sent you Rs.600',
  });
  for (const iou of await db.getOpenIOUsForContact(diya)) await db.settleIOU(iou.id, 600, diyaBack);

  // Money you owe: Kabir covered your movie ticket.
  await db.createIOU({
    contactId: kabir,
    amount: 250,
    direction: 'I_OWE_THEM',
    reason: 'PVR tickets',
  });

  // Income.
  await db.addTransaction({
    amount: 12000,
    direction: 'CREDIT',
    kind: 'INCOME',
    merchant: 'Allowance from Dad',
    occurredAt: at(16, 8),
    source: 'SMS',
    rawText: 'Rs 12000 credited',
  });

  // Four earlier budget periods, so the habit bars have a history to show.
  const currentStart = new Date(now.getTime() - 16 * DAY);
  currentStart.setHours(0, 0, 0, 0);
  for (let k = 4; k >= 1; k -= 1) {
    const startsOn = new Date(currentStart.getTime() - k * 30 * DAY).toISOString();
    const endsOn = new Date(currentStart.getTime() - (k - 1) * 30 * DAY).toISOString();
    await db.createBudgetPeriod({ startsOn, endsOn, allowance: 15000 });
  }
  const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();

  // Savings, built up over the months rather than all today — a goal only
  // holds back what was set aside in the current period.
  const laptop = await db.createGoal({ name: 'New laptop', targetAmount: 45000, emoji: 'laptop' });
  for (const [amount, days] of [
    [1000, 100],
    [1000, 70],
    [1000, 40],
    [500, 25],
  ]) {
    await db.contributeToGoal(laptop, amount, 'MANUAL', null, ago(days));
  }
  const goa = await db.createGoal({
    name: 'Goa trip',
    targetAmount: 8000,
    emoji: 'beach',
    deadline: new Date(now.getTime() + 60 * DAY).toISOString(),
  });
  await db.contributeToGoal(goa, 600, 'MANUAL', null, ago(40));
  await db.contributeToGoal(goa, 600, 'MANUAL', null, ago(22));

  // Wealth: pay-yourself-first switched on, the cushion filling a little
  // more each month (this month's slice already set aside), a monthly index
  // fund seven months in, a little gold, and one SIP message to confirm.
  const cushion = await db.createGoal({
    name: 'Emergency fund',
    targetAmount: 45000,
    emoji: 'savings',
  });
  for (const [amount, days] of [
    [800, 110],
    [1200, 80],
    [1500, 50],
    [1500, 20],
    [1500, 8],
  ]) {
    await db.contributeToGoal(cushion, amount, 'MANUAL', null, ago(days));
  }
  await setCushionGoalId(cushion);
  await setPayPlan({ enabled: true, cushionPct: 0.1, goalsPct: 0.05, investPct: 0 });
  const index = await db.createHolding({
    name: 'Nifty 50 index fund',
    kind: 'MUTUAL_FUND',
    sipAmount: 1000,
    sipDay: 5,
  });
  for (let monthsAgo = 7; monthsAgo >= 1; monthsAgo -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 5, 9, 30);
    await postInvestment({
      amount: 1000,
      direction: 'CONTRIBUTION',
      label: 'Groww',
      holdingId: index,
      occurredAt: d.toISOString(),
    });
  }
  // Net worth as it was written down in earlier months, and the first
  // milestones on the dates they were reached.
  const history = [18200, 21400, 23900, 26100, 28700];
  for (let i = 0; i < history.length; i += 1) {
    await db.recordNetWorth(
      history[i],
      new Date(now.getFullYear(), now.getMonth() - (history.length - i), 20)
    );
  }
  await db.markMilestone('FIRST_INVEST', new Date(now.getFullYear(), now.getMonth() - 7, 5));
  await db.markMilestone('FIRST_1K', new Date(now.getTime() - 100 * DAY));
  await db.setHoldingValue(index, 7640, new Date(now.getTime() - 9 * DAY).toISOString());
  const gold = await db.createHolding({ name: 'Digital gold', kind: 'GOLD' });
  await postInvestment({
    amount: 1500,
    direction: 'CONTRIBUTION',
    label: 'Gold',
    holdingId: gold,
    occurredAt: at(70, 12),
  });

  // An outing in progress.
  await db.createOuting({
    name: 'Friday at Church Street',
    startsAt: at(0, 17),
    budgetAmount: 1500,
  });

  // Two finished ones, with their bills attached.
  const toitNight = await db.createOuting({
    name: 'Toit with the gang',
    emoji: 'party',
    startsAt: at(6, 20),
    endsAt: at(6, 23),
    budgetAmount: 3000,
  });
  await db.setTransactionOuting(toit, toitNight);
  await db.closeOuting(toitNight);
  const movie = await db.createOuting({
    name: 'Movie night',
    emoji: 'movie',
    startsAt: at(10, 16),
  });
  await db.setTransactionOuting(ids[routine.findIndex((r) => r[3] === 'PVR Cinemas')], movie);
  await db.closeOuting(movie);

  // Bank balance, entered a few days ago.
  await db.recordBalance(24850, new Date(now.getTime() - 3 * DAY));

  // Two messages waiting in Review.
  await db.recordCapture({
    rawText: 'Rs.349.00 debited from A/c XX0000 to BLINKIT on 24-09. Not you? Call 1800',
    source: 'SMS',
    sender: 'AX-DEMOBK',
    receivedAt: at(0, 11),
    parsedAmount: 349,
    parsedMerchant: 'Blinkit',
    parsedDirection: 'DEBIT',
    confidence: 0.62,
  });
  await db.recordCapture({
    rawText: 'You received Rs 1,200 from ROHAN K',
    source: 'NOTIFICATION',
    sender: 'com.google.android.apps.nbu.paisa.user',
    receivedAt: at(1, 21),
    parsedAmount: 1200,
    parsedMerchant: 'Rohan K',
    parsedDirection: 'CREDIT',
    confidence: 0.55,
  });
  await db.recordCapture({
    rawText: 'Rs.1000.00 debited from A/c XX0000 towards GROWW SIP via NACH on 05-10.',
    source: 'SMS',
    sender: 'AX-DEMOBK',
    receivedAt: at(0, 9),
    parsedAmount: 1000,
    parsedMerchant: 'Groww',
    parsedDirection: 'DEBIT',
    confidence: 0.9,
    suggestedReason: 'INVESTMENT',
  });
}
