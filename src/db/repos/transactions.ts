import { getAdapter } from '../connection';
import {
  CaptureSource,
  CategorySource,
  Direction,
  TransactionKind,
  TransactionRow,
  TransactionStatus,
} from '../types';
import { sameMerchant } from '../../math/merchantClassifier';
import { sameKnownPerson } from './ious';

/**
 * occurred_at is stored in UTC, so its first ten characters are the UTC day.
 * In India that files everything between midnight and 5:30 AM under the day
 * before. Shifting by the phone's offset first gives the day the user lived.
 * The offset is taken now; India has no daylight saving, so it is fixed.
 */
function localOffset(): string {
  return `${-new Date().getTimezoneOffset()} minutes`;
}

export interface NewTransaction {
  amount: number;
  direction: Direction;
  kind: TransactionKind;
  merchant: string;
  category?: string | null;
  subcategory?: string | null;
  /** Where the category came from. Defaults to USER when a category is given. */
  categorySource?: CategorySource | null;
  occurredAt?: string;
  source?: CaptureSource;
  rawText?: string | null;
  externalRef?: string | null;
  dedupKey?: string | null;
  outingId?: number | null;
  note?: string | null;
  /** Defaults to COMPLETED — see TransactionStatus. */
  status?: TransactionStatus;
  /** A manual ledger correction, not a new kind — see TransactionRow.is_adjustment. */
  isAdjustment?: boolean;
}

/**
 * Inserts a transaction, returning the new row id — or the id of the existing
 * row when `dedupKey` has already been seen.
 *
 * Deduplication is enforced by a UNIQUE index rather than a read-then-write
 * check, because SMS and the notification listener frequently deliver the same
 * payment within milliseconds of each other and a check-then-insert races.
 */
export async function addTransaction(input: NewTransaction): Promise<number> {
  const db = getAdapter();
  const now = new Date().toISOString();
  const occurredAt = input.occurredAt ?? now;

  if (input.dedupKey) {
    const existing = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM Transactions WHERE dedup_key = ?;`,
      [input.dedupKey]
    );
    if (existing) return existing.id;
  }

  const result = await db.runAsync(
    `INSERT INTO Transactions
       (amount, direction, kind, merchant, category, subcategory, category_source, occurred_at, source,
        raw_text, external_ref, dedup_key, outing_id, note, status, is_adjustment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      Math.abs(input.amount),
      input.direction,
      input.kind,
      input.merchant.trim(),
      input.category ?? null,
      input.category ? (input.subcategory ?? null) : null,
      input.category ? (input.categorySource ?? 'USER') : null,
      occurredAt,
      input.source ?? 'MANUAL',
      input.rawText ?? null,
      input.externalRef ?? null,
      input.dedupKey ?? null,
      input.outingId ?? null,
      input.note ?? null,
      input.status ?? 'COMPLETED',
      input.isAdjustment ? 1 : 0,
      now,
    ]
  );
  return result.lastInsertRowId;
}

/**
 * Moves a transaction along its lifecycle without touching kind, direction
 * or amount. No row currently reaches anything but COMPLETED through the
 * app itself — this is the primitive Phase 7 writes into once ingestion can
 * recognise a pending or failed payment instead of discarding it.
 */
export async function setTransactionStatus(id: number, status: TransactionStatus): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`UPDATE Transactions SET status = ? WHERE id = ?;`, [status, id]);
}

export async function getTransactionById(id: number): Promise<TransactionRow | null> {
  const db = getAdapter();
  return db.getFirstAsync<TransactionRow>(`SELECT * FROM Transactions WHERE id = ?;`, [id]);
}

export async function getAllTransactions(): Promise<TransactionRow[]> {
  const db = getAdapter();
  return db.getAllAsync<TransactionRow>(`SELECT * FROM Transactions ORDER BY occurred_at DESC;`);
}

export async function getTransactionsBetween(
  startIso: string,
  endIso: string
): Promise<TransactionRow[]> {
  const db = getAdapter();
  return db.getAllAsync<TransactionRow>(
    `SELECT * FROM Transactions
     WHERE excluded_at IS NULL AND occurred_at >= ? AND occurred_at < ?
     ORDER BY occurred_at DESC;`,
    [startIso, endIso]
  );
}

export async function setTransactionCategory(
  id: number,
  category: string | null,
  options: { subcategory?: string | null; source?: CategorySource } = {}
): Promise<void> {
  const db = getAdapter();
  await db.runAsync(
    `UPDATE Transactions SET category = ?, subcategory = ?, category_source = ? WHERE id = ?;`,
    [
      category,
      category ? (options.subcategory ?? null) : null,
      category ? (options.source ?? 'USER') : null,
      id,
    ]
  );
}

/**
 * A guessed category the user just agreed with. Nothing about the category
 * changes; it simply stops being shown as a guess.
 */
export async function confirmTransactionCategory(id: number): Promise<void> {
  const db = getAdapter();
  await db.runAsync(
    `UPDATE Transactions SET category_source = 'USER' WHERE id = ? AND category IS NOT NULL;`,
    [id]
  );
}

export async function setTransactionOuting(id: number, outingId: number | null): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`UPDATE Transactions SET outing_id = ? WHERE id = ?;`, [outingId, id]);
}

/**
 * Deletes a transaction outright.
 *
 * `transfer_pair_id` is a bare column with no foreign key, so a plain
 * `DELETE` used to leave the other leg of a linked transfer pointing at a
 * row that no longer existed — still excluded from spend, forever, for a
 * transfer that no longer exists. `unmarkTransfer` already does exactly the
 * symmetric-null this needs (it exists for the "undo a detected transfer"
 * flow); calling it first is a no-op when there is no pairing to clear.
 */
export async function deleteTransaction(id: number): Promise<void> {
  const db = getAdapter();
  await unmarkTransfer(id);
  await db.runAsync(`DELETE FROM Transactions WHERE id = ?;`, [id]);
}


/**
 * Edits a transaction the user is correcting by hand.
 *
 * A capture that read the merchant wrong is far more common than one that
 * should be thrown away entirely, and retyping the whole thing to fix a name
 * is busywork.
 */
export async function updateTransaction(
  id: number,
  fields: {
    amount?: number;
    merchant?: string;
    /** Set by hand, so it is stored as USER — see setTransactionCategory. */
    category?: string | null;
    subcategory?: string | null;
    occurredAt?: string;
    note?: string | null;
    direction?: Direction;
    kind?: TransactionKind;
    isAdjustment?: boolean;
  }
): Promise<void> {
  const db = getAdapter();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (fields.amount !== undefined) {
    sets.push('amount = ?');
    params.push(Math.abs(fields.amount));
  }
  if (fields.merchant !== undefined) {
    sets.push('merchant = ?');
    params.push(fields.merchant.trim());
  }
  if (fields.category !== undefined) {
    sets.push('category = ?', 'subcategory = ?', 'category_source = ?');
    params.push(
      fields.category,
      fields.category ? (fields.subcategory ?? null) : null,
      fields.category ? 'USER' : null
    );
  }
  if (fields.occurredAt !== undefined) {
    sets.push('occurred_at = ?');
    params.push(fields.occurredAt);
  }
  if (fields.note !== undefined) {
    sets.push('note = ?');
    params.push(fields.note);
  }
  if (fields.direction !== undefined) {
    sets.push('direction = ?');
    params.push(fields.direction);
  }
  if (fields.kind !== undefined) {
    sets.push('kind = ?');
    params.push(fields.kind);
  }
  if (fields.isAdjustment !== undefined) {
    sets.push('is_adjustment = ?');
    params.push(fields.isAdjustment ? 1 : 0);
  }
  if (sets.length === 0) return;

  params.push(id);
  await db.runAsync(`UPDATE Transactions SET ${sets.join(', ')} WHERE id = ?;`, params);
}

/**
 * Marks a transaction as not real spending, or restores it.
 *
 * Kept rather than deleted so its dedup key still blocks the same promotional
 * SMS from being re-imported by the next backfill - deleting it would let the
 * junk straight back in.
 */
export async function setTransactionExcluded(id: number, excluded: boolean): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`UPDATE Transactions SET excluded_at = ? WHERE id = ?;`, [
    excluded ? new Date().toISOString() : null,
    id,
  ]);
}

export async function getExcludedTransactions(): Promise<TransactionRow[]> {
  const db = getAdapter();
  return db.getAllAsync<TransactionRow>(
    `SELECT * FROM Transactions WHERE excluded_at IS NOT NULL ORDER BY occurred_at DESC;`
  );
}

/**
 * Spend totals per calendar month, newest first.
 *
 * The basis for any statement about "last month" - without it, insights can
 * only ever describe the period you happen to be in and can never notice a
 * trend across them.
 */
export async function getMonthlySpend(
  monthsBack = 6,
  now: Date = new Date()
): Promise<Array<{ month: string; total: number; count: number; days: number }>> {
  const db = getAdapter();
  const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);

  return db.getAllAsync<{ month: string; total: number; count: number; days: number }>(
    `SELECT substr(occurred_at, 1, 7) AS month,
            SUM(amount) AS total,
            COUNT(*) AS count,
            COUNT(DISTINCT substr(datetime(occurred_at, ?), 1, 10)) AS days
     FROM Transactions
     WHERE kind = 'SPEND' AND excluded_at IS NULL AND transfer_pair_id IS NULL AND non_spend_reason IS NULL AND occurred_at >= ?
     GROUP BY month
     ORDER BY month DESC;`,
    [localOffset(), start.toISOString()]
  );
}

/** Category totals per month, for spotting what actually changed. */
export async function getCategoryByMonth(
  monthsBack = 6,
  now: Date = new Date()
): Promise<Array<{ month: string; category: string; total: number }>> {
  const db = getAdapter();
  const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);

  return db.getAllAsync<{ month: string; category: string; total: number }>(
    `SELECT substr(occurred_at, 1, 7) AS month,
            COALESCE(category, 'Uncategorised') AS category,
            SUM(amount) AS total
     FROM Transactions
     WHERE kind = 'SPEND' AND excluded_at IS NULL AND transfer_pair_id IS NULL AND non_spend_reason IS NULL AND occurred_at >= ?
     GROUP BY month, category
     ORDER BY month DESC, total DESC;`,
    [start.toISOString()]
  );
}

/**
 * Merchants charged in more than one distinct month - the raw material for
 * spotting a subscription the user has forgotten about.
 */
export async function getRepeatMerchants(
  monthsBack = 6,
  now: Date = new Date()
): Promise<
  Array<{ merchant: string; months: number; charges: number; total: number; lastAt: string }>
> {
  const db = getAdapter();
  const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);

  return db.getAllAsync<{
    merchant: string;
    months: number;
    charges: number;
    total: number;
    lastAt: string;
  }>(
    `SELECT merchant,
            COUNT(DISTINCT substr(occurred_at, 1, 7)) AS months,
            COUNT(*) AS charges,
            SUM(amount) AS total,
            MAX(occurred_at) AS lastAt
     FROM Transactions
     WHERE kind = 'SPEND' AND excluded_at IS NULL AND transfer_pair_id IS NULL AND non_spend_reason IS NULL AND occurred_at >= ?
     GROUP BY lower(merchant)
     HAVING months >= 2
     ORDER BY total DESC;`,
    [start.toISOString()]
  );
}

// ---------------------------------------------------------------------------
// Blocklist: senders and merchants that are never a transaction.
// ---------------------------------------------------------------------------

export async function addToBlocklist(pattern: string, reason?: string | null): Promise<void> {
  const db = getAdapter();
  await db.runAsync(
    `INSERT OR IGNORE INTO CaptureBlocklist (pattern, reason, created_at) VALUES (?, ?, ?);`,
    [pattern.trim().toLowerCase(), reason ?? null, new Date().toISOString()]
  );
}

export async function removeFromBlocklist(pattern: string): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`DELETE FROM CaptureBlocklist WHERE pattern = ?;`, [
    pattern.trim().toLowerCase(),
  ]);
}

export async function getBlocklist(): Promise<Array<{ pattern: string; reason: string | null }>> {
  const db = getAdapter();
  return db.getAllAsync<{ pattern: string; reason: string | null }>(
    `SELECT pattern, reason FROM CaptureBlocklist ORDER BY created_at DESC;`
  );
}

/** True when any blocked pattern appears in the sender, merchant or body. */
export async function isBlocked(...candidates: Array<string | null | undefined>): Promise<boolean> {
  const patterns = await getBlocklist();
  if (patterns.length === 0) return false;

  const haystack = candidates.filter(Boolean).join(' ').toLowerCase();
  return patterns.some((entry) => haystack.includes(entry.pattern));
}

// ---------------------------------------------------------------------------
// Money queries.
//
// Every one of these filters on `kind`, never on `direction`. Summing DEBITs
// would sweep in SETTLE_OUT rows (paying a friend back) and double-count an
// expense that was already booked when the bill was paid. Summing CREDITs
// would treat a friend's repayment as fresh allowance.
// ---------------------------------------------------------------------------

/**
 * Gross spending in a window: SPEND minus REFUND. This is money that left the
 * account for goods and services — before accounting for anything friends owe
 * you back on those bills.
 */
export async function getGrossSpendBetween(startIso: string, endIso: string): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT
       COALESCE(SUM(CASE WHEN kind = 'SPEND' THEN amount ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN kind = 'REFUND' THEN amount ELSE 0 END), 0) AS total
     FROM Transactions
     WHERE kind IN ('SPEND', 'REFUND') AND status = 'COMPLETED' AND excluded_at IS NULL AND transfer_pair_id IS NULL AND non_spend_reason IS NULL
       AND occurred_at >= ? AND occurred_at < ?;`,
    [startIso, endIso]
  );
  return row?.total ?? 0;
}

/** Allowance and top-ups received in a window. Excludes friends repaying you. */
export async function getIncomeBetween(startIso: string, endIso: string): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM Transactions
     WHERE kind = 'INCOME' AND status = 'COMPLETED' AND excluded_at IS NULL AND transfer_pair_id IS NULL AND non_spend_reason IS NULL AND occurred_at >= ? AND occurred_at < ?;`,
    [startIso, endIso]
  );
  return row?.total ?? 0;
}

/**
 * Still-unrecovered money you fronted on bills paid within the window.
 *
 * Backed out of gross spending to get what you actually spent on yourself. It
 * uses each IOU's *open* balance (amount minus everything settled against it),
 * so a partial repayment moves this number by exactly what came back.
 */
export async function getOpenReceivablesOnSpendBetween(
  startIso: string,
  endIso: string
): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(open_amount), 0) AS total FROM (
       SELECT IOUs.amount - COALESCE(
         (SELECT SUM(s.amount) FROM Settlements s WHERE s.iou_id = IOUs.id), 0
       ) AS open_amount
       FROM IOUs
       JOIN Transactions ON Transactions.id = IOUs.transaction_id
       WHERE IOUs.direction = 'THEY_OWE_ME'
         AND Transactions.kind = 'SPEND'
         AND Transactions.excluded_at IS NULL
         AND Transactions.occurred_at >= ? AND Transactions.occurred_at < ?
     ) WHERE open_amount > 0;`,
    [startIso, endIso]
  );
  return row?.total ?? 0;
}

/** Spending grouped by category for a window, largest first. */
export async function getSpendByCategory(
  startIso: string,
  endIso: string
): Promise<Array<{ category: string; total: number; count: number }>> {
  const db = getAdapter();
  return db.getAllAsync<{ category: string; total: number; count: number }>(
    `SELECT COALESCE(category, 'Uncategorised') AS category,
            SUM(amount) AS total,
            COUNT(*) AS count
     FROM Transactions
     WHERE kind = 'SPEND' AND excluded_at IS NULL AND transfer_pair_id IS NULL AND non_spend_reason IS NULL
       AND occurred_at >= ? AND occurred_at < ?
     GROUP BY COALESCE(category, 'Uncategorised')
     ORDER BY total DESC;`,
    [startIso, endIso]
  );
}

/** Daily spend totals by the phone's local day, oldest first. Gaps are omitted, not zero-filled. */
export async function getDailySpend(
  startIso: string,
  endIso: string
): Promise<Array<{ day: string; total: number }>> {
  const db = getAdapter();
  return db.getAllAsync<{ day: string; total: number }>(
    `SELECT substr(datetime(occurred_at, ?), 1, 10) AS day, SUM(amount) AS total
     FROM Transactions
     WHERE kind = 'SPEND' AND excluded_at IS NULL AND transfer_pair_id IS NULL AND non_spend_reason IS NULL
       AND occurred_at >= ? AND occurred_at < ?
     GROUP BY day
     ORDER BY day ASC;`,
    [localOffset(), startIso, endIso]
  );
}

/**
 * Finds a recent transaction that looks like the same payment arriving from a
 * second source. The UNIQUE dedup_key catches anything carrying a bank
 * reference number; this is the fuzzy backstop for messages that carry none,
 * where SMS and the notification listener word the merchant differently.
 *
 * Direction matters as much as amount: sending someone ₹200 and having them
 * send ₹200 straight back is two real, opposite-facing payments, not one
 * message reported twice. Matching on amount alone read the second leg of
 * that as a duplicate of the first and silently dropped it.
 *
 * The window is wide (6 minutes) because a bank's own SMS for a UPI payment
 * routinely lags the paying app's push notification by minutes, not seconds
 * — the two reports of the same payment are rarely close enough to catch at
 * a tighter window.
 *
 * `signals.reference`, when given, is checked first and independently of the
 * time window: a reference number is close to a certain identifier, and a
 * bank's own confirmation SMS for a UPI payment has arrived hours after the
 * paying app's push in the wild, well outside any window that wouldn't also
 * false-match unrelated payments.
 *
 * `signals.merchant`, when given, guards against the opposite false
 * positive: two *different* people paying the exact same amount within the
 * window — a common coincidence at ₹100/₹200/₹500 round numbers — collapsing
 * into "one payment reported twice" purely because nothing else was
 * compared. A same-amount/same-direction row is only treated as the same
 * payment if its merchant also plausibly matches (`sameMerchant`). Omitting
 * `merchant` keeps the original amount+direction+window-only behaviour.
 *
 * What this deliberately does *not* do is guess when the merchant does not
 * match. See `findUnconfirmedDuplicate` below for that case, which is
 * common enough to matter and never safe to decide automatically.
 */
export async function findProbableDuplicate(
  amount: number,
  direction: Direction,
  occurredAtIso: string,
  windowSeconds = 360,
  signals: { merchant?: string | null; reference?: string | null } = {}
): Promise<TransactionRow | null> {
  const db = getAdapter();

  if (signals.reference) {
    const byRef = await db.getFirstAsync<TransactionRow>(
      `SELECT * FROM Transactions WHERE UPPER(external_ref) = UPPER(?) ORDER BY occurred_at DESC LIMIT 1;`,
      [signals.reference]
    );
    if (byRef) return byRef;
  }

  const at = new Date(occurredAtIso).getTime();
  const from = new Date(at - windowSeconds * 1000).toISOString();
  const to = new Date(at + windowSeconds * 1000).toISOString();

  if (!signals.merchant) {
    return db.getFirstAsync<TransactionRow>(
      `SELECT * FROM Transactions
       WHERE abs(amount - ?) < 0.01 AND direction = ? AND occurred_at >= ? AND occurred_at <= ?
       ORDER BY occurred_at DESC LIMIT 1;`,
      [amount, direction, from, to]
    );
  }

  const candidates = await db.getAllAsync<TransactionRow>(
    `SELECT * FROM Transactions
     WHERE abs(amount - ?) < 0.01 AND direction = ? AND occurred_at >= ? AND occurred_at <= ?
     ORDER BY occurred_at DESC;`,
    [amount, direction, from, to]
  );

  const byName = candidates.find((row) => sameMerchant(row.merchant, signals.merchant!));
  if (byName) return byName;

  // Nothing in the two strings connects them — but Review may already have
  // been told they are the same person, in which case this is settled and
  // there is no reason to ask a second time.
  for (const row of candidates) {
    if (await sameKnownPerson(row.merchant, signals.merchant)) return row;
  }
  return null;
}

/** How close two reports have to land before "the same payment twice" is even worth asking about. */
export const NEAR_SIMULTANEOUS_SECONDS = 90;

/**
 * A transaction this message might be a second report of, where nothing can
 * confirm it either way — the case the review inbox exists to ask about.
 *
 * The same payment is frequently named *differently* by its two sources: a
 * UPI app labels the sender with whatever the phone's contacts call them
 * ("Ravi Anna"), while the bank's SMS uses the name registered against the
 * handle ("Rajesh Kumar M"). Those are one person and share no characters,
 * so `findProbableDuplicate`'s merchant check can never connect them and
 * the payment gets counted twice.
 *
 * Amount and timing alone would connect them — but they would also connect
 * two people paying an identical amount seconds apart, which is exactly
 * what happens when a group settles a shared bill at once. Merging those
 * silently loses somebody's money.
 *
 * Neither answer is safe to assume, so this returns the candidate and the
 * caller files it as a question rather than a decision. Requiring a
 * *different* source narrows it to the shape that is actually ambiguous:
 * one real-world event produces at most one message per channel, so two
 * reports arriving on the same channel are two payments however alike they
 * read.
 */
export async function findUnconfirmedDuplicate(
  amount: number,
  direction: Direction,
  occurredAtIso: string,
  source: CaptureSource
): Promise<TransactionRow | null> {
  const db = getAdapter();
  const at = new Date(occurredAtIso).getTime();
  const from = new Date(at - NEAR_SIMULTANEOUS_SECONDS * 1000).toISOString();
  const to = new Date(at + NEAR_SIMULTANEOUS_SECONDS * 1000).toISOString();

  return db.getFirstAsync<TransactionRow>(
    `SELECT * FROM Transactions
     WHERE abs(amount - ?) < 0.01 AND direction = ? AND source <> ?
       AND excluded_at IS NULL
       AND occurred_at >= ? AND occurred_at <= ?
     ORDER BY occurred_at DESC LIMIT 1;`,
    [amount, direction, source, from, to]
  );
}

// ---------------------------------------------------------------------------
// Self-transfers: money that moved between the user's own accounts.
// ---------------------------------------------------------------------------

/**
 * Links two transactions as the legs of one movement of money.
 *
 * Both rows point at each other, so either one can be found from the other
 * and unlinking from either side is symmetric.
 */
export async function markTransferPair(debitId: number, creditId: number): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`UPDATE Transactions SET transfer_pair_id = ? WHERE id = ?;`, [
    creditId,
    debitId,
  ]);
  await db.runAsync(`UPDATE Transactions SET transfer_pair_id = ? WHERE id = ?;`, [
    debitId,
    creditId,
  ]);
}

/** Undoes the classification for both legs, putting the money back in the totals. */
export async function unmarkTransfer(transactionId: number): Promise<void> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ transfer_pair_id: number | null }>(
    `SELECT transfer_pair_id FROM Transactions WHERE id = ?;`,
    [transactionId]
  );

  await db.runAsync(`UPDATE Transactions SET transfer_pair_id = NULL WHERE id = ?;`, [
    transactionId,
  ]);
  if (row?.transfer_pair_id) {
    await db.runAsync(`UPDATE Transactions SET transfer_pair_id = NULL WHERE id = ?;`, [
      row.transfer_pair_id,
    ]);
  }
}

export async function getTransfers(): Promise<TransactionRow[]> {
  const db = getAdapter();
  return db.getAllAsync<TransactionRow>(
    `SELECT * FROM Transactions
     WHERE transfer_pair_id IS NOT NULL
     ORDER BY occurred_at DESC;`
  );
}

/**
 * What a window of spending actually cost you, after what other people owe on
 * those same bills.
 *
 * Three different numbers, because they answer three different questions:
 * what left the account, what has come back so far, and what is genuinely
 * yours once everyone settles up. Reporting only the first — which is what
 * every total in the app did until now — overstates the cost of every night
 * out that got split.
 */
export async function getBorneBetween(
  startIso: string,
  endIso: string
): Promise<{ paid: number; splitAway: number; recovered: number; stillOwed: number; borne: number }> {
  const db = getAdapter();

  const row = await db.getFirstAsync<{
    paid: number | null;
    splitAway: number | null;
    recovered: number | null;
  }>(
    `SELECT
       (SELECT COALESCE(SUM(amount), 0) FROM Transactions
         WHERE kind = 'SPEND' AND excluded_at IS NULL AND transfer_pair_id IS NULL AND non_spend_reason IS NULL
           AND occurred_at >= ?1 AND occurred_at < ?2) AS paid,

       (SELECT COALESCE(SUM(i.amount), 0) FROM IOUs i
          JOIN Transactions t ON t.id = i.transaction_id
         WHERE i.direction = 'THEY_OWE_ME'
           AND t.kind = 'SPEND' AND t.excluded_at IS NULL AND t.transfer_pair_id IS NULL
           AND t.occurred_at >= ?1 AND t.occurred_at < ?2) AS splitAway,

       (SELECT COALESCE(SUM(s.amount), 0) FROM Settlements s
          JOIN IOUs i ON i.id = s.iou_id
          JOIN Transactions t ON t.id = i.transaction_id
         WHERE i.direction = 'THEY_OWE_ME'
           AND t.kind = 'SPEND' AND t.excluded_at IS NULL AND t.transfer_pair_id IS NULL
           AND t.occurred_at >= ?1 AND t.occurred_at < ?2) AS recovered;`,
    [startIso, endIso]
  );

  const paid = row?.paid ?? 0;
  const splitAway = row?.splitAway ?? 0;
  const recovered = row?.recovered ?? 0;

  return {
    paid,
    splitAway,
    recovered,
    stillOwed: Math.max(0, splitAway - recovered),
    // Your genuine share: the whole bill minus everything charged to someone
    // else, whether or not they have actually paid yet.
    borne: paid - splitAway,
  };
}

/**
 * `getBorneBetween`, broken down by category: what left the account for each
 * one, and how much of that was other people's share.
 *
 * A category ranked by what was paid puts the night you fronted for six
 * people at the top of "where your money goes", when most of it was never
 * yours. Ranked by `yours`, the list answers the question the user asked.
 * Same filters as `getSpendByCategory`, so the paid figures agree with it.
 */
export async function getCategoryCost(
  startIso: string,
  endIso: string
): Promise<Array<{ category: string; paid: number; splitAway: number; yours: number; count: number }>> {
  const db = getAdapter();
  const rows = await db.getAllAsync<{ category: string; paid: number; splitAway: number; count: number }>(
    `SELECT COALESCE(t.category, 'Uncategorised') AS category,
            SUM(t.amount) AS paid,
            SUM(COALESCE(
              (SELECT SUM(i.amount) FROM IOUs i
                WHERE i.transaction_id = t.id AND i.direction = 'THEY_OWE_ME'), 0
            )) AS splitAway,
            COUNT(*) AS count
     FROM Transactions t
     WHERE t.kind = 'SPEND' AND t.excluded_at IS NULL AND t.transfer_pair_id IS NULL
       AND t.non_spend_reason IS NULL
       AND t.occurred_at >= ? AND t.occurred_at < ?
     GROUP BY COALESCE(t.category, 'Uncategorised');`,
    [startIso, endIso]
  );

  return rows
    .map((row) => {
      // An IOU larger than its bill is a data-entry mistake, not negative spending.
      const splitAway = Math.min(row.splitAway ?? 0, row.paid);
      return { ...row, splitAway, yours: row.paid - splitAway };
    })
    .sort((a, b) => b.yours - a.yours || b.paid - a.paid);
}

/**
 * Each spend in a window with other people's share of it, for anything that
 * needs to slice spending more than one way at once (the weekly recap cuts
 * the same rows by day, category and merchant). Same filters as
 * `getCategoryCost`, so the totals agree with it.
 */
export async function getSpendsWithShare(
  startIso: string,
  endIso: string
): Promise<
  Array<{ id: number; amount: number; splitAway: number; merchant: string; category: string | null; occurredAt: string }>
> {
  const db = getAdapter();
  const rows = await db.getAllAsync<{
    id: number;
    amount: number;
    splitAway: number | null;
    merchant: string;
    category: string | null;
    occurredAt: string;
  }>(
    `SELECT t.id, t.amount, t.merchant, t.category, t.occurred_at AS occurredAt,
            (SELECT SUM(i.amount) FROM IOUs i
              WHERE i.transaction_id = t.id AND i.direction = 'THEY_OWE_ME') AS splitAway
     FROM Transactions t
     WHERE t.kind = 'SPEND' AND t.excluded_at IS NULL AND t.transfer_pair_id IS NULL
       AND t.non_spend_reason IS NULL
       AND t.occurred_at >= ? AND t.occurred_at < ?
     ORDER BY t.occurred_at ASC;`,
    [startIso, endIso]
  );
  return rows.map((row) => ({ ...row, splitAway: Math.min(row.splitAway ?? 0, row.amount) }));
}

/** Records that a payment moved money rather than spending it. */
export async function setNonSpendReason(id: number, reason: string | null): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`UPDATE Transactions SET non_spend_reason = ? WHERE id = ?;`, [reason, id]);
}

/** True when any card purchase has been captured, not just the bill. */
/**
 * Net money currently sitting in investments — contributions minus
 * withdrawals, both tagged `non_spend_reason = 'INVESTMENT'` regardless of
 * direction (see `math/classification.ts`). Not a valuation: the app has no
 * market data and V1 is offline-first, so this is "how much you've put in
 * and not taken back," not "what it's worth today."
 */
export async function getTotalInvested(): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END), 0) AS total
     FROM Transactions
     WHERE non_spend_reason = 'INVESTMENT' AND excluded_at IS NULL;`
  );
  return row?.total ?? 0;
}

export async function hasCardTransactions(): Promise<boolean> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM Transactions
     WHERE kind = 'SPEND'
       AND excluded_at IS NULL
       AND non_spend_reason IS NULL
       AND raw_text IS NOT NULL
       AND (lower(raw_text) LIKE '%credit card%' OR lower(raw_text) LIKE '%card x%'
            OR lower(raw_text) LIKE '%card ending%' OR lower(raw_text) LIKE '%card no%');`
  );
  return (row?.n ?? 0) > 0;
}

/**
 * Top-N distinct merchants by how often they appear, for quick-add suggestions.
 *
 * Grouped case-insensitively so "Swiggy" and "swiggy" are one chip, and the
 * excluded/transfer rows are left out — a merchant you only ever saw in a
 * self-transfer is not somewhere you spend.
 */
export async function getRecentMerchants(limit = 5): Promise<string[]> {
  const db = getAdapter();
  const rows = await db.getAllAsync<{ merchant: string }>(
    `SELECT merchant FROM Transactions
     WHERE merchant IS NOT NULL AND merchant != '' AND merchant != 'Unknown'
       AND excluded_at IS NULL AND transfer_pair_id IS NULL
     GROUP BY lower(merchant)
     ORDER BY COUNT(*) DESC
     LIMIT ?;`,
    [limit]
  );
  return rows.map((r) => r.merchant);
}
