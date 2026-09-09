import {
  DEFAULT_NOTIFICATION_SETTINGS,
  DeliveryHistory,
  EMPTY_HISTORY,
  TransactionEventContext,
  canSend,
  isQuietHour,
  planForTransaction,
  planSettleReminder,
} from '../src/notifications/engine';
import { computeBudget, computeToday } from '../src/math/budget';

const budget = computeBudget({
  allowance: 9000,
  topUps: 0,
  grossSpend: 0,
  settledIn: 0,
  settledOut: 0,
  expectedRecovery: 0,
  openPayables: 0,
  goalReserve: 0,
  daysRemaining: 30,
});

// 14:00 — comfortably outside quiet hours.
const noon = new Date('2026-09-09T14:00:00');

function makeContext(overrides: Partial<TransactionEventContext> = {}): TransactionEventContext {
  return {
    now: noon,
    transactionId: 1,
    amount: 120,
    merchant: 'Chai Point',
    category: 'Food',
    alreadySplit: false,
    today: computeToday(300, 120),
    budget,
    streakDays: 0,
    goalsCrossed: [],
    avgDailyBurn: 250,
    history: EMPTY_HISTORY,
    settings: DEFAULT_NOTIFICATION_SETTINGS,
    random: () => 0,
    ...overrides,
  };
}

describe('quiet hours', () => {
  const settings = DEFAULT_NOTIFICATION_SETTINGS; // 23:00 -> 08:00

  it('is quiet late at night', () => {
    expect(isQuietHour(new Date('2026-09-09T23:30:00'), settings)).toBe(true);
  });

  it('is quiet early in the morning', () => {
    expect(isQuietHour(new Date('2026-09-09T06:00:00'), settings)).toBe(true);
  });

  it('is not quiet during the day', () => {
    expect(isQuietHour(new Date('2026-09-09T14:00:00'), settings)).toBe(false);
  });

  it('sends nothing at all during quiet hours', () => {
    const planned = planForTransaction(
      makeContext({ now: new Date('2026-09-09T03:00:00'), amount: 5000 })
    );
    expect(planned).toEqual([]);
  });
});

describe('rate limiting', () => {
  it('stops a type once its daily cap is hit', () => {
    const history: DeliveryHistory = { ...EMPTY_HISTORY, sentTodayByType: { TXN_PULSE: 8 } };
    expect(canSend('TXN_PULSE', noon, history, DEFAULT_NOTIFICATION_SETTINGS)).toBe(false);
  });

  it('respects the per-type cooldown', () => {
    const history: DeliveryHistory = {
      ...EMPTY_HISTORY,
      lastSentAt: { TXN_PULSE: new Date(noon.getTime() - 60 * 1000).toISOString() },
    };
    expect(canSend('TXN_PULSE', noon, history, DEFAULT_NOTIFICATION_SETTINGS)).toBe(false);
  });

  it('allows a send once the cooldown has passed', () => {
    const history: DeliveryHistory = {
      ...EMPTY_HISTORY,
      lastSentAt: { TXN_PULSE: new Date(noon.getTime() - 10 * 60 * 1000).toISOString() },
    };
    expect(canSend('TXN_PULSE', noon, history, DEFAULT_NOTIFICATION_SETTINGS)).toBe(true);
  });

  it('enforces the global ceiling regardless of type', () => {
    const history: DeliveryHistory = { ...EMPTY_HISTORY, totalSentToday: 12 };
    expect(canSend('OVERSPEND', noon, history, DEFAULT_NOTIFICATION_SETTINGS)).toBe(false);
  });

  // A spend that trips several rules at once must not produce a buzz storm.
  it('caps a single event that trips many rules', () => {
    const planned = planForTransaction(
      makeContext({
        amount: 2000,
        today: computeToday(300, 2000),
        streakDays: 7,
        goalsCrossed: [
          { name: 'Laptop', emoji: '💻', percent: 50, remaining: 22500 },
          { name: 'Goa', emoji: '🏖', percent: 75, remaining: 2500 },
        ],
        history: { ...EMPTY_HISTORY, totalSentToday: 11 },
      })
    );
    expect(planned).toHaveLength(1);
  });
});

describe('per-transaction pulse', () => {
  it('sends a pulse on an ordinary spend', () => {
    const planned = planForTransaction(makeContext());
    const pulse = planned.find((p) => p.type === 'TXN_PULSE');
    expect(pulse).toBeDefined();
    expect(pulse?.body).toContain('₹');
  });

  it('escalates tone as the day fills up', () => {
    const fresh = planForTransaction(makeContext({ today: computeToday(300, 30) }));
    const close = planForTransaction(makeContext({ today: computeToday(300, 260) }));

    expect(fresh.find((p) => p.type === 'TXN_PULSE')?.tier).toBe('FRESH');
    expect(close.find((p) => p.type === 'TXN_PULSE')?.tier).toBe('CLOSE');
  });

  it('always names the remaining amount, so the nudge carries data', () => {
    const planned = planForTransaction(makeContext({ today: computeToday(300, 100) }));
    expect(planned.find((p) => p.type === 'TXN_PULSE')?.body).toMatch(/₹\d/);
  });

  it('avoids repeating a line the user just saw', () => {
    const first = planForTransaction(makeContext({ random: () => 0 }));
    const firstBody = first.find((p) => p.type === 'TXN_PULSE')!.body;

    const second = planForTransaction(
      makeContext({
        random: () => 0,
        history: { ...EMPTY_HISTORY, recentBodies: { TXN_PULSE: [firstBody] } },
      })
    );
    expect(second.find((p) => p.type === 'TXN_PULSE')?.body).not.toBe(firstBody);
  });
});

describe('overspend', () => {
  it('replaces the pulse rather than doubling up on it', () => {
    const planned = planForTransaction(makeContext({ today: computeToday(300, 340) }));
    expect(planned.some((p) => p.type === 'OVERSPEND')).toBe(true);
    expect(planned.some((p) => p.type === 'TXN_PULSE')).toBe(false);
  });

  it('escalates severity with how far over you are', () => {
    const mild = planForTransaction(makeContext({ today: computeToday(300, 310) }));
    const dire = planForTransaction(makeContext({ today: computeToday(300, 600) }));

    expect(mild.find((p) => p.type === 'OVERSPEND')?.tier).toBe('MILD');
    expect(dire.find((p) => p.type === 'OVERSPEND')?.tier).toBe('DIRE');
  });

  it('stays silent when the user has turned it off', () => {
    const planned = planForTransaction(
      makeContext({
        today: computeToday(300, 400),
        settings: { ...DEFAULT_NOTIFICATION_SETTINGS, overspendEnabled: false, pulseEnabled: false },
      })
    );
    expect(planned.some((p) => p.type === 'OVERSPEND')).toBe(false);
  });
});

describe('split prompts', () => {
  it('offers a split on a big social spend', () => {
    const planned = planForTransaction(
      makeContext({ amount: 1240, merchant: 'Toit', category: 'Outing' })
    );
    const prompt = planned.find((p) => p.type === 'SPLIT_PROMPT');
    expect(prompt).toBeDefined();
    expect(prompt?.body).toContain('Toit');
  });

  it('stays quiet on a small spend', () => {
    const planned = planForTransaction(makeContext({ amount: 90, category: 'Food' }));
    expect(planned.some((p) => p.type === 'SPLIT_PROMPT')).toBe(false);
  });

  it('does not ask about something already split', () => {
    const planned = planForTransaction(
      makeContext({ amount: 1240, category: 'Outing', alreadySplit: true })
    );
    expect(planned.some((p) => p.type === 'SPLIT_PROMPT')).toBe(false);
  });

  it('does not ask about a solo category like a metro fare', () => {
    const planned = planForTransaction(
      makeContext({ amount: 800, merchant: 'Metro', category: 'Transport' })
    );
    expect(planned.some((p) => p.type === 'SPLIT_PROMPT')).toBe(false);
  });

  it('still asks when the category is unknown', () => {
    const planned = planForTransaction(makeContext({ amount: 900, category: null }));
    expect(planned.some((p) => p.type === 'SPLIT_PROMPT')).toBe(true);
  });
});

describe('goals and streaks', () => {
  it('celebrates a milestone crossed by this spend', () => {
    const planned = planForTransaction(
      makeContext({ goalsCrossed: [{ name: 'Laptop', emoji: '💻', percent: 50, remaining: 22500 }] })
    );
    const goal = planned.find((p) => p.type === 'GOAL_MILESTONE');
    expect(goal?.body).toContain('Laptop');
    expect(goal?.tier).toBe('MILESTONE');
  });

  it('marks a finished goal as complete', () => {
    const planned = planForTransaction(
      makeContext({ goalsCrossed: [{ name: 'Goa', emoji: '🏖', percent: 100, remaining: 0 }] })
    );
    expect(planned.find((p) => p.type === 'GOAL_MILESTONE')?.tier).toBe('COMPLETE');
  });

  it('only celebrates streaks on milestone days', () => {
    expect(planForTransaction(makeContext({ streakDays: 7 })).some((p) => p.type === 'STREAK')).toBe(
      true
    );
    expect(planForTransaction(makeContext({ streakDays: 5 })).some((p) => p.type === 'STREAK')).toBe(
      false
    );
  });
});

describe('settle reminders', () => {
  const base = {
    now: noon,
    contactName: 'Rahul',
    amount: 450,
    history: EMPTY_HISTORY,
    settings: DEFAULT_NOTIFICATION_SETTINGS,
    random: () => 0,
  };

  it('nudges about a debt that has aged', () => {
    const planned = planSettleReminder({ ...base, daysOutstanding: 9 });
    expect(planned?.body).toContain('Rahul');
    expect(planned?.body).toContain('450');
  });

  it('leaves a fresh debt alone', () => {
    expect(planSettleReminder({ ...base, daysOutstanding: 2 })).toBeNull();
  });

  it('sends at most one a day', () => {
    const planned = planSettleReminder({
      ...base,
      daysOutstanding: 20,
      history: { ...EMPTY_HISTORY, sentTodayByType: { SETTLE_REMINDER: 1 } },
    });
    expect(planned).toBeNull();
  });
});
