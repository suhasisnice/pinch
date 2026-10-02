import { getAdapter } from '../connection';
import { TransactionRow } from '../types';
import {
  ReimbursableSpend,
  ReimbursementLink,
  ReimbursementPlan,
  planReimbursement,
} from '../../math/reimbursement';
import { createIOU, findContactIdByNameOrAlias, findOrCreateContactByName, settleIOU } from './ious';
import { getTransactionById, updateTransaction } from './transactions';

/**
 * Linking an incoming payment to the spends it paid back.
 *
 * See math/reimbursement.ts for the model. Nothing here deletes a
 * transaction: the ledger shows a linked set as one net line, but both
 * movements stay on record, so the bank-balance check still adds up and
 * the link can be undone.
 */

/** Every settlement that joins an incoming payment to a spend, summed per pair. */
export async function getReimbursementLinks(): Promise<ReimbursementLink[]> {
  const db = getAdapter();
  return db.getAllAsync<ReimbursementLink>(
    `SELECT s.transaction_id AS creditId, i.transaction_id AS spendId, SUM(s.amount) AS amount
     FROM Settlements s
     JOIN IOUs i ON i.id = s.iou_id
     WHERE s.transaction_id IS NOT NULL
       AND i.transaction_id IS NOT NULL
       AND i.direction = 'THEY_OWE_ME'
     GROUP BY s.transaction_id, i.transaction_id;`
  );
}

/** Only a real incoming payment, still counted and not part of a transfer, can pay something back. */
export function canBeReimbursement(tx: TransactionRow): boolean {
  return (
    tx.direction === 'CREDIT' &&
    (tx.kind === 'INCOME' || tx.kind === 'SETTLE_IN') &&
    tx.excluded_at === null &&
    tx.transfer_pair_id === null
  );
}

export interface ReimbursementCandidate extends ReimbursableSpend {
  merchant: string;
  category: string | null;
  /** Already linked to this payment. */
  linked: boolean;
  /** The payer already owes something on this one, or its amount matches the payment. */
  suggested: boolean;
}

/** How far back a payment can reach. A friend settling a trip weeks later is ordinary. */
const LOOKBACK_DAYS = 60;

/**
 * The spends an incoming payment could plausibly be paying back: your own
 * spending, still counted, from before the money arrived.
 *
 * Suggestions rise to the top rather than being pre-ticked. A debt this
 * person already owes on a bill, or a bill whose amount matches the
 * payment exactly, is a strong hint — but it is still the user's tap that
 * makes the link. The app only proposes.
 */
export async function getReimbursementCandidates(
  creditId: number
): Promise<ReimbursementCandidate[]> {
  const db = getAdapter();
  const credit = await getTransactionById(creditId);
  if (!credit) return [];

  const payerId = await findContactIdByNameOrAlias(credit.merchant);
  const arrived = new Date(credit.occurred_at);
  // Either order: a friend can send their share before the bill is paid.
  const upTo = new Date(arrived.getTime() + LOOKBACK_DAYS * 86_400_000).toISOString();
  const from = new Date(arrived.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();

  const rows = await db.getAllAsync<{
    id: number;
    amount: number;
    occurredAt: string;
    merchant: string;
    category: string | null;
    splitAway: number;
    openFromPayer: number;
    linked: number;
  }>(
    `SELECT
       t.id AS id,
       t.amount AS amount,
       t.occurred_at AS occurredAt,
       t.merchant AS merchant,
       t.category AS category,
       -- Both figures are read as if this payment's own link were undone,
       -- so reopening the sheet to edit a link previews exactly what saving
       -- will do: the IOUs it invented do not count, and what it settled is
       -- open again.
       COALESCE((SELECT SUM(i.amount) FROM IOUs i
                  WHERE i.transaction_id = t.id AND i.direction = 'THEY_OWE_ME'
                    AND (i.origin_transaction_id IS NULL OR i.origin_transaction_id != ?4)), 0) AS splitAway,
       COALESCE((SELECT SUM(i.amount - COALESCE((SELECT SUM(s.amount) FROM Settlements s
                                                  WHERE s.iou_id = i.id
                                                    AND (s.transaction_id IS NULL OR s.transaction_id != ?4)), 0))
                  FROM IOUs i
                  WHERE i.transaction_id = t.id AND i.direction = 'THEY_OWE_ME' AND i.contact_id = ?3
                    AND (i.origin_transaction_id IS NULL OR i.origin_transaction_id != ?4)), 0) AS openFromPayer,
       EXISTS (SELECT 1 FROM Settlements s JOIN IOUs i ON i.id = s.iou_id
                WHERE i.transaction_id = t.id AND s.transaction_id = ?4) AS linked
     FROM Transactions t
     WHERE t.direction = 'DEBIT' AND t.kind = 'SPEND'
       AND t.excluded_at IS NULL AND t.transfer_pair_id IS NULL AND t.non_spend_reason IS NULL
       AND t.status = 'COMPLETED'
       AND t.occurred_at >= ?1 AND t.occurred_at <= ?2
     ORDER BY t.occurred_at DESC
     LIMIT 80;`,
    [from, upTo, payerId ?? -1, creditId]
  );

  const candidates = rows.map((row) => ({
    id: row.id,
    amount: row.amount,
    occurredAt: row.occurredAt,
    merchant: row.merchant,
    category: row.category,
    splitAway: row.splitAway,
    openFromPayer: Math.max(0, row.openFromPayer),
    linked: row.linked === 1,
    suggested: row.openFromPayer > 0.009 || Math.abs(row.amount - credit.amount) < 0.01,
  }));

  // Already linked first, then suggestions, then everything else — each newest first.
  const rank = (c: ReimbursementCandidate) => (c.linked ? 0 : c.suggested ? 1 : 2);
  return candidates.sort((a, b) => rank(a) - rank(b) || b.occurredAt.localeCompare(a.occurredAt));
}

/**
 * Records that `creditId` paid back `spendIds`.
 *
 * Replaces any link this payment already had, so the sheet can be reopened
 * and edited rather than only ever added to. Refuses a payment larger than
 * what the ticked spends can absorb — silently treating the excess as
 * repaid would invent a debt nobody had; leaving it is the user's call.
 */
export async function linkReimbursement(
  creditId: number,
  spendIds: number[]
): Promise<ReimbursementPlan> {
  const credit = await getTransactionById(creditId);
  if (!credit || !canBeReimbursement(credit)) {
    throw new Error(`Transaction ${creditId} cannot be a reimbursement`);
  }
  if (spendIds.length === 0) throw new Error('Pick at least one payment it covers');

  const candidates = await getReimbursementCandidates(creditId);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const spends = spendIds.map((id) => {
    const spend = byId.get(id);
    if (!spend) throw new Error(`Transaction ${id} is not a spend this payment can cover`);
    return spend;
  });

  // Candidates are already read as if this payment's link were undone, so
  // the whole payment is available and the plan is decided before anything
  // is written — a refused save leaves the existing link untouched.
  const plan = planReimbursement(credit.amount, spends);
  if (plan.excess > 0) {
    throw new Error(`Those cover ${plan.applied}, not the full ${credit.amount}`);
  }

  // Start from a clean slate for this payment, so editing a link is the
  // same operation as making one.
  await unlinkReimbursement(creditId);

  // Only now, once the link is certain to be written: a refused save should
  // not leave a new contact behind.
  const payerId =
    (await findContactIdByNameOrAlias(credit.merchant)) ??
    (await findOrCreateContactByName(credit.merchant));

  const db = getAdapter();
  for (const allocation of plan.allocations) {
    let fromExisting = allocation.fromExisting;
    if (fromExisting > 0) {
      // The payer's own open debts on this bill, oldest first.
      const open = await db.getAllAsync<{ id: number }>(
        `SELECT i.id AS id FROM IOUs i
         WHERE i.transaction_id = ? AND i.contact_id = ? AND i.direction = 'THEY_OWE_ME'
           AND i.amount - COALESCE((SELECT SUM(s.amount) FROM Settlements s WHERE s.iou_id = i.id), 0) > 0.009
         ORDER BY i.created_at ASC;`,
        [allocation.spendId, payerId]
      );
      for (const iou of open) {
        if (fromExisting <= 0.009) break;
        fromExisting -= await settleIOU(iou.id, fromExisting, creditId);
      }
    }

    if (allocation.fromNew > 0) {
      const spend = byId.get(allocation.spendId)!;
      const iouId = await createIOU({
        contactId: payerId,
        amount: allocation.fromNew,
        direction: 'THEY_OWE_ME',
        transactionId: allocation.spendId,
        reason: spend.merchant,
        originTransactionId: creditId,
      });
      await settleIOU(iouId, allocation.fromNew, creditId);
    }
  }

  // Last, so a failure part-way leaves the payment still reading as income
  // rather than as a repayment of nothing.
  await updateTransaction(creditId, { kind: 'SETTLE_IN' });
  return plan;
}

/**
 * Undoes a link: the payment's settlements go, the IOUs the link invented
 * go with them, and the payment reads as income again. IOUs the user made
 * by splitting a bill are left exactly as they were — reopened, since
 * nothing has paid them now.
 */
export async function unlinkReimbursement(creditId: number): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`DELETE FROM Settlements WHERE transaction_id = ?;`, [creditId]);
  await db.runAsync(`DELETE FROM IOUs WHERE origin_transaction_id = ?;`, [creditId]);

  const credit = await getTransactionById(creditId);
  if (credit && credit.kind === 'SETTLE_IN') {
    await updateTransaction(creditId, { kind: 'INCOME' });
  }
}

// ---------------------------------------------------------------------------
// The same link, made from the spend's side: "net this out".
// ---------------------------------------------------------------------------

/** Your own spending, still counted: the same rows a payment is offered to cover. */
export function canBeNettedOut(tx: TransactionRow): boolean {
  return (
    tx.direction === 'DEBIT' &&
    tx.kind === 'SPEND' &&
    tx.excluded_at === null &&
    tx.transfer_pair_id === null &&
    tx.non_spend_reason === null &&
    tx.status === 'COMPLETED'
  );
}

export interface NetOutCandidate {
  id: number;
  amount: number;
  occurredAt: string;
  merchant: string;
  /** How much of it already pays this spend back. Zero when not linked. */
  applied: number;
}

/**
 * Money that came in after a spend and could be paying it back, soonest
 * first. A payment already explained by something else is left out: a link
 * accounts for the whole payment, so it has nothing left to give.
 */
export async function getNetOutCandidates(spendId: number): Promise<NetOutCandidate[]> {
  const spend = await getTransactionById(spendId);
  if (!spend) return [];

  const paid = new Date(spend.occurred_at);
  // Either order: a friend can send their share before the bill is paid.
  const from = new Date(paid.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const upTo = new Date(paid.getTime() + LOOKBACK_DAYS * 86_400_000).toISOString();

  return getAdapter().getAllAsync<NetOutCandidate>(
    `SELECT * FROM (
       SELECT
         t.id AS id,
         t.amount AS amount,
         t.occurred_at AS occurredAt,
         t.merchant AS merchant,
         COALESCE((SELECT SUM(s.amount) FROM Settlements s JOIN IOUs i ON i.id = s.iou_id
                    WHERE s.transaction_id = t.id AND i.transaction_id = ?3), 0) AS applied,
         EXISTS (SELECT 1 FROM Settlements s WHERE s.transaction_id = t.id) AS used
       FROM Transactions t
       WHERE t.direction = 'CREDIT' AND t.kind IN ('INCOME', 'SETTLE_IN')
         AND t.excluded_at IS NULL AND t.transfer_pair_id IS NULL
         AND t.occurred_at >= ?1 AND t.occurred_at <= ?2
     )
     WHERE applied > 0 OR used = 0
     ORDER BY applied > 0 DESC, ABS(julianday(occurredAt) - julianday(?4)) ASC
     LIMIT 80;`,
    [from, upTo, spendId, spend.occurred_at]
  );
}

/**
 * Sets which incoming payments pay `spendId` back, replacing whatever was
 * linked to it before. Each payment keeps the other spends it already
 * covers. All or nothing: one payment that does not fit undoes the lot.
 */
export async function netOut(spendId: number, creditIds: number[]): Promise<void> {
  const links = await getReimbursementLinks();
  const spendsOf = (creditId: number) =>
    links.filter((link) => link.creditId === creditId).map((link) => link.spendId);
  const dropped = links
    .filter((link) => link.spendId === spendId && !creditIds.includes(link.creditId))
    .map((link) => link.creditId);

  const db = getAdapter();
  await db.execAsync(`BEGIN;`);
  try {
    for (const creditId of dropped) {
      const others = spendsOf(creditId).filter((id) => id !== spendId);
      if (others.length > 0) await linkReimbursement(creditId, others);
      else await unlinkReimbursement(creditId);
    }
    for (const creditId of creditIds) {
      await linkReimbursement(creditId, [...new Set([...spendsOf(creditId), spendId])]);
    }
    await db.execAsync(`COMMIT;`);
  } catch (error) {
    await db.execAsync(`ROLLBACK;`);
    throw error;
  }
}
