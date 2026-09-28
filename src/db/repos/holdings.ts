import { getAdapter } from '../connection';

/**
 * Holdings (v16): where long-term money lives.
 *
 * Money in and out is never stored here. It is the ordinary Transaction rows
 * tagged INVESTMENT (Phase 9), pointed at a holding by `holding_id`, so what
 * went in is always summed from the ledger and cannot drift from it.
 */

export interface HoldingRow {
  id: number;
  name: string;
  kind: string;
  sip_amount: number | null;
  sip_day: number | null;
  current_value: number | null;
  value_updated_at: string | null;
  created_at: string;
  archived_at: string | null;
}

export interface HoldingSummary {
  id: number;
  name: string;
  kind: string;
  sipAmount: number | null;
  sipDay: number | null;
  /** Typed in by the user; null until they do. */
  currentValue: number | null;
  valueUpdatedAt: string | null;
  /** Contributions minus withdrawals linked to this holding. */
  putIn: number;
  firstContributionAt: string | null;
  createdAt: string;
}

/** The row filter every investment total shares, so none of them can disagree. */
const INVESTMENT_ROWS = `non_spend_reason = 'INVESTMENT' AND status = 'COMPLETED' AND excluded_at IS NULL`;
/** The same filter, for a query that aliases Transactions as `t`. */
const INVESTMENT_ROWS_T = `t.non_spend_reason = 'INVESTMENT' AND t.status = 'COMPLETED' AND t.excluded_at IS NULL`;

export async function createHolding(input: {
  name: string;
  kind?: string;
  sipAmount?: number | null;
  sipDay?: number | null;
}): Promise<number> {
  const db = getAdapter();
  const result = await db.runAsync(
    `INSERT INTO Holdings (name, kind, sip_amount, sip_day, created_at) VALUES (?, ?, ?, ?, ?);`,
    [
      input.name.trim(),
      input.kind ?? 'OTHER',
      input.sipAmount && input.sipAmount > 0 ? input.sipAmount : null,
      input.sipAmount && input.sipAmount > 0 ? clampDay(input.sipDay ?? 1) : null,
      new Date().toISOString(),
    ]
  );
  return result.lastInsertRowId;
}

function clampDay(day: number): number {
  return Math.min(28, Math.max(1, Math.round(day)));
}

/** Sets (or, with a zero/empty amount, stops) the monthly plan. */
export async function setHoldingPlan(
  id: number,
  amount: number | null,
  day: number | null
): Promise<void> {
  const db = getAdapter();
  const on = amount !== null && amount > 0;
  await db.runAsync(`UPDATE Holdings SET sip_amount = ?, sip_day = ? WHERE id = ?;`, [
    on ? amount : null,
    on ? clampDay(day ?? 1) : null,
    id,
  ]);
}

/** Records what the user says it is worth today. Null forgets it. */
export async function setHoldingValue(
  id: number,
  value: number | null,
  at?: string
): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`UPDATE Holdings SET current_value = ?, value_updated_at = ? WHERE id = ?;`, [
    value,
    value === null ? null : (at ?? new Date().toISOString()),
    id,
  ]);
}

/**
 * Hides a holding. Its transactions keep their link — they happened, and the
 * total put in must not change because a row left the list.
 */
export async function archiveHolding(id: number): Promise<void> {
  const db = getAdapter();
  await db.runAsync(
    `UPDATE Holdings SET archived_at = ?, sip_amount = NULL, sip_day = NULL WHERE id = ?;`,
    [new Date().toISOString(), id]
  );
}

export async function getHoldings(): Promise<HoldingSummary[]> {
  const db = getAdapter();
  const rows = await db.getAllAsync<
    HoldingRow & { put_in: number | null; first_at: string | null }
  >(
    `SELECT h.*,
            (SELECT COALESCE(SUM(CASE WHEN t.direction = 'DEBIT' THEN t.amount ELSE -t.amount END), 0)
               FROM Transactions t WHERE t.holding_id = h.id AND ${INVESTMENT_ROWS_T}) AS put_in,
            (SELECT MIN(t.occurred_at) FROM Transactions t
               WHERE t.holding_id = h.id AND t.direction = 'DEBIT' AND ${INVESTMENT_ROWS_T}) AS first_at
     FROM Holdings h
     WHERE h.archived_at IS NULL
     ORDER BY h.created_at ASC;`
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    sipAmount: row.sip_amount,
    sipDay: row.sip_day,
    currentValue: row.current_value,
    valueUpdatedAt: row.value_updated_at,
    putIn: row.put_in ?? 0,
    firstContributionAt: row.first_at,
    createdAt: row.created_at,
  }));
}

/** Points an investment transaction at a holding (or at none). */
export async function setTransactionHolding(
  transactionId: number,
  holdingId: number | null
): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`UPDATE Transactions SET holding_id = ? WHERE id = ?;`, [
    holdingId,
    transactionId,
  ]);
}

/** Put in but never assigned to a holding — every Phase 9 entry, for a start. */
export async function getUnassignedInvested(): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END), 0) AS total
     FROM Transactions WHERE holding_id IS NULL AND ${INVESTMENT_ROWS};`
  );
  return row?.total ?? 0;
}

/**
 * Net money that left for investments in a window (contributions minus
 * withdrawals). Cash that really moved — the budget subtracts it, the way it
 * subtracts repaying a friend, without calling it spending.
 */
export async function getInvestedNetBetween(startIso: string, endIso: string): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END), 0) AS total
     FROM Transactions WHERE ${INVESTMENT_ROWS} AND occurred_at >= ? AND occurred_at < ?;`,
    [startIso, endIso]
  );
  return row?.total ?? 0;
}

/** Contributions (not withdrawals) into each holding within a window. */
export async function getContributionsByHoldingBetween(
  startIso: string,
  endIso: string
): Promise<Map<number, number>> {
  const db = getAdapter();
  const rows = await db.getAllAsync<{ holding_id: number; total: number }>(
    `SELECT holding_id, SUM(amount) AS total FROM Transactions
     WHERE holding_id IS NOT NULL AND direction = 'DEBIT' AND ${INVESTMENT_ROWS}
       AND occurred_at >= ? AND occurred_at < ?
     GROUP BY holding_id;`,
    [startIso, endIso]
  );
  return new Map(rows.map((r) => [r.holding_id, r.total]));
}

/** For the ladder: when it started, and in how many distinct months money went in. */
export async function getInvestingHistory(): Promise<{ firstAt: string | null; months: number }> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ first_at: string | null; months: number }>(
    `SELECT MIN(occurred_at) AS first_at, COUNT(DISTINCT substr(occurred_at, 1, 7)) AS months
     FROM Transactions WHERE direction = 'DEBIT' AND ${INVESTMENT_ROWS};`
  );
  return { firstAt: row?.first_at ?? null, months: row?.months ?? 0 };
}

/** Money put into investments within a window — contributions only, withdrawals ignored. */
export async function getContributedBetween(startIso: string, endIso: string): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM Transactions
     WHERE direction = 'DEBIT' AND ${INVESTMENT_ROWS} AND occurred_at >= ? AND occurred_at < ?;`,
    [startIso, endIso]
  );
  return row?.total ?? 0;
}
