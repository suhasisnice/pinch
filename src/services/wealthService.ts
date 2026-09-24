import * as db from '../db/dbService';
import { HoldingSummary } from '../db/repos/holdings';
import { GoalProgress } from '../db/repos/goals';
import {
  CAUTIOUS_RETURN_RATE,
  DEFAULT_RETURN_RATE,
  Ladder,
  cushionTarget,
  holdingWorth,
  ladder,
  monthsBetween,
} from '../math/wealth';
import {
  getCushionGoalId,
  getMonthlyAllowance,
  getReturnRate,
  setCushionGoalId,
} from '../settings/settingsStore';

export interface WealthSnapshot {
  holdings: HoldingSummary[];
  /** Invested but never pointed at a holding (e.g. every Phase 9 entry). */
  unassigned: number;
  /** Everything put in, net of withdrawals. */
  putIn: number;
  /** What it is worth as far as the user has said; put-in where they haven't. */
  worth: number;
  /** Sum of every monthly plan. */
  monthly: number;
  cushion: GoalProgress | null;
  ladder: Ladder;
  returnRate: number;
  cautiousRate: number;
}

const CUSHION_NAME = 'Emergency fund';

export async function getWealthSnapshot(now: Date = new Date()): Promise<WealthSnapshot> {
  const [holdings, unassigned, history, goals, cushionId, allowance, returnRate] =
    await Promise.all([
      db.getHoldings(),
      db.getUnassignedInvested(),
      db.getInvestingHistory(),
      db.getActiveGoals(),
      getCushionGoalId(),
      getMonthlyAllowance(),
      getReturnRate(DEFAULT_RETURN_RATE),
    ]);

  // A cushion goal the user has since deleted or archived is simply gone —
  // rung one reads as not started, and "Start the cushion" makes a new one.
  const cushion = cushionId === null ? null : (goals.find((g) => g.id === cushionId) ?? null);

  const putIn = holdings.reduce((sum, h) => sum + h.putIn, 0) + unassigned;
  const worth =
    holdings.reduce((sum, h) => sum + holdingWorth(h.putIn, h.currentValue), 0) + unassigned;
  const monthly = holdings.reduce((sum, h) => sum + (h.sipAmount ?? 0), 0);

  return {
    holdings,
    unassigned,
    putIn,
    worth,
    monthly,
    cushion,
    ladder: ladder({
      cushionSaved: cushion?.savedAmount ?? 0,
      cushionTarget: cushion?.targetAmount ?? cushionTarget(allowance),
      hasPlan: monthly > 0,
      monthsContributed: history.months,
      monthsInvested: history.firstAt ? monthsBetween(history.firstAt, now.toISOString()) : null,
    }),
    returnRate,
    cautiousRate: Math.min(CAUTIOUS_RETURN_RATE, returnRate),
  };
}

/**
 * Rung one: an ordinary goal named "Emergency fund", sized at three months
 * of allowance, remembered as the cushion. Being an ordinary goal is the
 * point — it reserves from the budget, takes contributions and round-ups,
 * and can be retargeted from Plans exactly like any other.
 */
export async function startCushion(): Promise<number> {
  const existing = await getCushionGoalId();
  if (existing !== null) {
    const goal = await db.getGoalById(existing);
    if (goal) return goal.id;
  }
  const allowance = await getMonthlyAllowance();
  const id = await db.createGoal({
    name: CUSHION_NAME,
    targetAmount: Math.max(1, Math.round(cushionTarget(allowance))),
    emoji: 'savings',
  });
  await setCushionGoalId(id);
  return id;
}
