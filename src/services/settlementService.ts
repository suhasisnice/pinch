import * as db from '../db/dbService';

export interface AutoSettleResult {
  /** How much of this payment closed an existing debt. */
  applied: number;
  /** Which open IOUs it closed, oldest first. */
  iouIds: number[];
}

/**
 * Checks whether an incoming payment is someone paying back a debt they
 * already owe, before it is left to sit as plain income.
 *
 * Today's version of "record it, then remember to mark it as a loan every
 * single time" only works if you never forget — and a debt with a name
 * spelled slightly differently by the capture that reported it would not
 * even have been found. This runs automatically, the moment a credit
 * lands: if the sender is a contact with anything still open, the payment
 * settles it — oldest debt first, exactly like paying off several bills
 * with one transfer — and the transaction's own kind flips from INCOME to
 * SETTLE_IN so the budget stops counting it as new money.
 *
 * Deliberately narrow. Only a plain, still-unclassified INCOME credit is
 * touched — anything already excluded, transferred, or otherwise decided
 * is left alone — and only when the sender is already a known contact.
 * A stranger sending money for the first time creates no contact and
 * settles nothing; there is no debt to find.
 */
export async function checkForSettlement(transactionId: number): Promise<AutoSettleResult | null> {
  const row = await db.getTransactionById(transactionId);
  if (!row || row.direction !== 'CREDIT' || row.kind !== 'INCOME') return null;
  if (row.excluded_at !== null || row.transfer_pair_id !== null) return null;

  const contactId = await db.findContactIdByName(row.merchant);
  if (contactId === null) return null;

  const open = await db.getOpenIOUsForContact(contactId);
  if (open.length === 0) return null;

  const result = await db.settleContactBalance(contactId, row.amount, transactionId);
  if (result.applied <= 0) return null;

  await db.updateTransaction(transactionId, { kind: 'SETTLE_IN' });
  return result;
}

export interface SettlementBackfillResult {
  /** Transactions whose kind changed from INCOME to SETTLE_IN. */
  settled: number;
  /** Total amount moved from "income" into "debt repaid". */
  amount: number;
}

/**
 * Runs checkForSettlement over every plain-income credit already on the
 * books, for the same reason categorisation gets backfilled: this only
 * ever ran going forward from the moment it shipped, so a credit that
 * closed a debt before then is still sitting there counted as fresh
 * income until someone reruns it.
 */
export async function backfillSettlements(): Promise<SettlementBackfillResult> {
  const all = await db.getAllTransactions();
  const candidates = all.filter(
    (row) =>
      row.direction === 'CREDIT' &&
      row.kind === 'INCOME' &&
      row.excluded_at === null &&
      row.transfer_pair_id === null
  );

  const result: SettlementBackfillResult = { settled: 0, amount: 0 };
  for (const row of candidates) {
    const applied = await checkForSettlement(row.id);
    if (applied) {
      result.settled += 1;
      result.amount += applied.applied;
    }
  }
  return result;
}
