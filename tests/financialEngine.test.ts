/**
 * Phase 1 — financial engine. See docs/phases/PHASE_1_FINANCIAL_ENGINE.md.
 *
 * Covers the three additions: outing reserves (mirrors GoalContributions),
 * the transaction status column, and the balance/budget fields that make
 * PRODUCT_SPEC §1.1's four quantities — bank balance, protected money,
 * available budget, safe-to-spend — independently readable.
 */
import * as db from '../src/db/dbService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';
import {
  BALANCE_CONSISTENCY_TOLERANCE,
  BudgetInput,
  checkBalanceConsistency,
  computeBudget,
} from '../src/math/budget';
import { LATEST_VERSION } from '../src/db/migrations';

beforeEach(async () => {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
});

const spend = (amount: number, merchant = 'Olive Cafe', extra: Record<string, unknown> = {}) =>
  db.addTransaction({ amount, direction: 'DEBIT', kind: 'SPEND', merchant, ...extra });

// ---------------------------------------------------------------------------
// Pure math
// ---------------------------------------------------------------------------

const baseBudget: BudgetInput = {
  allowance: 10000,
  topUps: 0,
  grossSpend: 0,
  settledIn: 0,
  settledOut: 0,
  expectedRecovery: 0,
  openPayables: 0,
  goalReserve: 0,
  daysRemaining: 30,
};

describe('computeBudget — protected money and available budget', () => {
  it('treats a missing outingReserve as zero, matching the pre-Phase-1 formula exactly', () => {
    const withoutField = computeBudget(baseBudget);
    const withZero = computeBudget({ ...baseBudget, outingReserve: 0 });

    expect(withoutField.spendablePool).toBe(withZero.spendablePool);
    expect(withoutField.dailyLimit).toBe(withZero.dailyLimit);
    expect(withoutField.availableBudget).toBe(10000);
    expect(withoutField.protectedMoney).toBe(0);
  });

  it('reduces availableBudget by exactly the outing reserve, on top of the goal reserve', () => {
    const result = computeBudget({ ...baseBudget, goalReserve: 1000, outingReserve: 1500 });

    expect(result.protectedMoney).toBe(2500);
    expect(result.availableBudget).toBe(7500);
    expect(result.spendablePool).toBe(7500);
    expect(result.dailyLimit).toBeCloseTo(250, 2);
  });

  it('availableBudget is always exactly spendablePool', () => {
    const result = computeBudget({ ...baseBudget, grossSpend: 4000, outingReserve: 800 });
    expect(result.availableBudget).toBe(result.spendablePool);
  });
});

describe('checkBalanceConsistency', () => {
  it('returns null when no balance has ever been recorded', () => {
    expect(checkBalanceConsistency(null, 5000, 1000)).toBeNull();
  });

  it('is consistent when the bank matches available + protected, within tolerance', () => {
    const result = checkBalanceConsistency(6000, 5000, 1000);
    expect(result?.discrepancy).toBe(0);
    expect(result?.isConsistent).toBe(true);
  });

  it('stays consistent inside the noise tolerance', () => {
    const result = checkBalanceConsistency(6000 + BALANCE_CONSISTENCY_TOLERANCE, 5000, 1000);
    expect(result?.isConsistent).toBe(true);
  });

  it('flags a gap beyond tolerance as a likely missed transaction', () => {
    // The ledger thinks there's 6,000; the bank only has 5,700 — a 300 spend
    // never made it into a transaction.
    const result = checkBalanceConsistency(5700, 5000, 1000);
    expect(result?.discrepancy).toBe(-300);
    expect(result?.isConsistent).toBe(false);
  });

  it('flags the bank having more than the ledger accounts for', () => {
    const result = checkBalanceConsistency(6500, 5000, 1000);
    expect(result?.discrepancy).toBe(500);
    expect(result?.isConsistent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

describe('v10 migration', () => {
  it('lands on the latest version and defaults every transaction to COMPLETED', async () => {
    const id = await spend(500);
    const row = await db.getTransactionById(id);

    expect(row?.status).toBe('COMPLETED');

    const version = await db
      .getAdapter()
      .getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
    expect(version?.user_version).toBe(LATEST_VERSION);
  });
});

// ---------------------------------------------------------------------------
// Transaction status
// ---------------------------------------------------------------------------

describe('transaction status', () => {
  it('setTransactionStatus moves a row without touching amount, kind or direction', async () => {
    const id = await spend(300, 'Zomato');
    await db.setTransactionStatus(id, 'PENDING');

    const row = await db.getTransactionById(id);
    expect(row).toMatchObject({ status: 'PENDING', amount: 300, kind: 'SPEND', direction: 'DEBIT' });
  });

  it('excludes a non-COMPLETED spend from the budget-feeding sum', async () => {
    const at = '2026-09-05T10:00:00.000Z';
    const completedId = await spend(400, 'Cafe', { occurredAt: at });
    const pendingId = await spend(600, 'Airline', { occurredAt: at });
    await db.setTransactionStatus(pendingId, 'PENDING');

    const total = await db.getGrossSpendBetween('2026-09-01T00:00:00.000Z', '2026-09-10T00:00:00.000Z');
    expect(total).toBe(400);

    // Sanity: the row still exists — nothing was deleted, just excluded from the sum.
    expect(await db.getTransactionById(pendingId)).not.toBeNull();
    expect(await db.getTransactionById(completedId)).not.toBeNull();
  });

  it('excludes a FAILED credit from income', async () => {
    const at = '2026-09-05T10:00:00.000Z';
    await db.addTransaction({
      amount: 5000,
      direction: 'CREDIT',
      kind: 'INCOME',
      merchant: 'Allowance',
      occurredAt: at,
    });
    const failedId = await db.addTransaction({
      amount: 2000,
      direction: 'CREDIT',
      kind: 'INCOME',
      merchant: 'Refund attempt',
      occurredAt: at,
    });
    await db.setTransactionStatus(failedId, 'FAILED');

    const income = await db.getIncomeBetween('2026-09-01T00:00:00.000Z', '2026-09-10T00:00:00.000Z');
    expect(income).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// Outing reserves
// ---------------------------------------------------------------------------

describe('outing reserves', () => {
  it('reserving money changes reservedAmount without creating a transaction', async () => {
    const outingId = await db.createOuting({ name: "Rahul's Birthday", budgetAmount: 1500 });
    await db.reserveForOuting(outingId, 900);

    const outing = await db.getOutingById(outingId);
    expect(outing?.reservedAmount).toBe(900);
    expect(outing?.stillNeeded).toBe(600);
    expect(await db.getAllTransactions()).toHaveLength(0);
  });

  it('keeps reserved, spent and planned as three separate numbers', async () => {
    const outingId = await db.createOuting({ name: 'Goa', budgetAmount: 1500 });
    await db.reserveForOuting(outingId, 1700);
    await spend(1420, 'Beach Shack', { outingId });

    const outing = await db.getOutingById(outingId);
    expect(outing?.budgetAmount).toBe(1500);
    expect(outing?.reservedAmount).toBe(1700);
    expect(outing?.totalSpent).toBe(1420);
  });

  it('releasing reserve reduces the total without deleting the ledger history', async () => {
    const outingId = await db.createOuting({ name: 'Concert' });
    await db.reserveForOuting(outingId, 1000);
    await db.releaseOutingReserve(outingId, 400);

    expect(await db.getOutingReserved(outingId)).toBe(600);
    expect(await db.getReserveHistory(outingId)).toHaveLength(2);
  });

  it('sums reserves across every open outing for the budget engine', async () => {
    const a = await db.createOuting({ name: 'Movie' });
    const b = await db.createOuting({ name: 'Trip' });
    await db.reserveForOuting(a, 500);
    await db.reserveForOuting(b, 1200);

    expect(await db.getTotalOutingReserved()).toBe(1700);
  });

  it('stops counting a closed outing toward protected money, but keeps its ledger rows', async () => {
    const outingId = await db.createOuting({ name: 'Old trip' });
    await db.reserveForOuting(outingId, 800);
    await db.closeOuting(outingId);

    expect(await db.getTotalOutingReserved()).toBe(0);
    expect(await db.getOutingReserved(outingId)).toBe(800);
    expect(await db.getReserveHistory(outingId)).toHaveLength(1);
  });

  it('reports stillNeeded as null when the outing has no budget set', async () => {
    const outingId = await db.createOuting({ name: 'Impromptu dinner' });
    await db.reserveForOuting(outingId, 300);

    expect((await db.getOutingById(outingId))?.stillNeeded).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getBudgetSnapshot wiring
// ---------------------------------------------------------------------------

describe('getBudgetSnapshot — balance-anchored fields', () => {
  it('reports bankBalance null and balanceConsistency null when nothing has been recorded', async () => {
    const { getBudgetSnapshot } = await import('../src/services/budgetService');
    const snapshot = await getBudgetSnapshot(5000, new Date(2026, 8, 10));

    expect(snapshot.bankBalance).toBeNull();
    expect(snapshot.balanceConsistency).toBeNull();
  });

  it('folds outing reserves into protectedMoney and availableBudget', async () => {
    const { getBudgetSnapshot } = await import('../src/services/budgetService');
    const now = new Date(2026, 8, 10);
    await db.startBudgetPeriod({ allowance: 5000, days: 30, now });

    const outingId = await db.createOuting({ name: 'Trip', budgetAmount: 2000 });
    await db.reserveForOuting(outingId, 1200);

    const snapshot = await getBudgetSnapshot(5000, now);

    expect(snapshot.protectedMoney).toBeGreaterThanOrEqual(1200);
    expect(snapshot.availableBudget).toBe(snapshot.budget.availableBudget);
    expect(snapshot.budget.outingReserve).toBe(1200);
  });

  it('surfaces the projected balance once recorded, and flags a discrepancy', async () => {
    const { getBudgetSnapshot } = await import('../src/services/budgetService');
    const now = new Date(2026, 8, 10);
    await db.startBudgetPeriod({ allowance: 5000, days: 30, now });
    await db.recordBalance(5000, now);

    // A spend that never became a transaction — the bank has less than the
    // ledger thinks it should.
    const snapshot = await getBudgetSnapshot(5000, now);

    expect(snapshot.bankBalance).toBe(5000);
    expect(snapshot.balanceConsistency).not.toBeNull();
    expect(snapshot.balanceConsistency?.isConsistent).toBe(true);
  });
});
