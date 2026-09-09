import * as db from '../src/db/dbService';
import { classifyNewTransaction } from '../src/services/classificationService';
import { checkForTransferMatch } from '../src/services/transferService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';

beforeEach(async () => {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
});

/**
 * Exercises classifyNewTransaction and checkForTransferMatch directly —
 * these are the functions postTransaction calls the instant a transaction
 * is posted (see captureService.ts) so that a wallet top-up or a transfer
 * to savings is correct within the same session instead of sitting wrong
 * until a Settings button is pressed or the next app update ships a rule
 * bump. postTransaction's own wiring is one try/catch around two calls and
 * is covered by the app's typecheck; what actually needs proving is what
 * these two do, which is exactly what is tested here.
 */
describe('classifyNewTransaction', () => {
  it('recognises a wallet top-up the moment it is called, no sweep needed', async () => {
    const id = await db.addTransaction({
      amount: 500,
      direction: 'DEBIT',
      kind: 'SPEND',
      merchant: 'Paytm',
      rawText: 'Added Rs 500 to your Paytm wallet',
      occurredAt: new Date().toISOString(),
    });

    const applied = await classifyNewTransaction(id);
    expect(applied?.reason).toBe('WALLET_TOPUP');
    expect((await db.getTransactionById(id))?.non_spend_reason).toBe('WALLET_TOPUP');
  });

  it('recognises a cash withdrawal and gives it an honest category', async () => {
    const id = await db.addTransaction({
      amount: 2000,
      direction: 'DEBIT',
      kind: 'SPEND',
      merchant: 'ATM Withdrawal',
      rawText: 'Cash withdrawn at ATM Rs 2000',
      occurredAt: new Date().toISOString(),
    });

    await classifyNewTransaction(id);
    const row = await db.getTransactionById(id);
    expect(row?.non_spend_reason).toBeNull();
    expect(row?.category).toBe('Cash');
  });

  it('leaves an ordinary purchase alone', async () => {
    const id = await db.addTransaction({
      amount: 300,
      direction: 'DEBIT',
      kind: 'SPEND',
      merchant: 'Olive Cafe',
      rawText: 'Rs 300 spent at Olive Cafe',
      occurredAt: new Date().toISOString(),
    });

    await classifyNewTransaction(id);
    expect((await db.getTransactionById(id))?.non_spend_reason).toBeNull();
  });

  it('returns null for a transaction id that does not exist', async () => {
    await expect(classifyNewTransaction(999999)).resolves.toBeNull();
  });
});

describe('checkForTransferMatch', () => {
  it('pairs a debit and its matching credit once both exist', async () => {
    const now = new Date();

    const debitId = await db.addTransaction({
      amount: 5000,
      direction: 'DEBIT',
      kind: 'SPEND',
      merchant: 'Self Transfer',
      rawText: 'Rs 5000 debited via self transfer to your own account XX9999',
      occurredAt: now.toISOString(),
    });

    // Nothing to pair with yet.
    expect(await checkForTransferMatch(debitId)).toBeNull();

    const creditId = await db.addTransaction({
      amount: 5000,
      direction: 'CREDIT',
      kind: 'INCOME',
      merchant: 'Self Transfer',
      rawText: 'Rs 5000 credited via self transfer from your own account XX1234',
      occurredAt: new Date(now.getTime() + 2 * 60 * 1000).toISOString(),
    });

    const match = await checkForTransferMatch(creditId);
    expect(match).not.toBeNull();

    const debitRow = await db.getTransactionById(debitId);
    const creditRow = await db.getTransactionById(creditId);
    expect(debitRow?.transfer_pair_id).toBe(creditId);
    expect(creditRow?.transfer_pair_id).toBe(debitId);
  });

  it('does not pair legs more than a day apart', async () => {
    const now = new Date();

    const debitId = await db.addTransaction({
      amount: 5000,
      direction: 'DEBIT',
      kind: 'SPEND',
      merchant: 'Self Transfer',
      rawText: 'Rs 5000 debited via self transfer to your own account XX9999',
      occurredAt: now.toISOString(),
    });

    const creditId = await db.addTransaction({
      amount: 5000,
      direction: 'CREDIT',
      kind: 'INCOME',
      merchant: 'Self Transfer',
      rawText: 'Rs 5000 credited via self transfer from your own account XX1234',
      occurredAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });

    expect(await checkForTransferMatch(creditId)).toBeNull();
    expect((await db.getTransactionById(debitId))?.transfer_pair_id).toBeNull();
  });

  it('does not re-match a leg that is already paired', async () => {
    const now = new Date();
    const debitId = await db.addTransaction({
      amount: 100,
      direction: 'DEBIT',
      kind: 'SPEND',
      merchant: 'Self Transfer',
      rawText: 'Rs 100 debited via self transfer to your own account XX9999',
      occurredAt: now.toISOString(),
    });
    const creditId = await db.addTransaction({
      amount: 100,
      direction: 'CREDIT',
      kind: 'INCOME',
      merchant: 'Self Transfer',
      rawText: 'Rs 100 credited via self transfer from your own account XX1234',
      occurredAt: new Date(now.getTime() + 60 * 1000).toISOString(),
    });
    await checkForTransferMatch(creditId);

    // Calling it again on an already-paired leg is a no-op, not an error.
    expect(await checkForTransferMatch(debitId)).toBeNull();
  });

  it('returns null for a transaction id that does not exist', async () => {
    await expect(checkForTransferMatch(999999)).resolves.toBeNull();
  });
});
