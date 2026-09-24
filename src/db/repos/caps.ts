import { getAdapter } from '../connection';
import { CapScope, SpendCap, keyFor } from '../../math/patterns';

interface CapRow {
  id: number;
  scope: CapScope;
  key: string;
  label: string;
  weekly_amount: number;
}

const toCap = (r: CapRow): SpendCap => ({
  id: r.id,
  scope: r.scope,
  key: r.key,
  label: r.label,
  weeklyAmount: r.weekly_amount,
});

export async function getSpendCaps(): Promise<SpendCap[]> {
  const rows = await getAdapter().getAllAsync<CapRow>(
    `SELECT id, scope, key, label, weekly_amount FROM SpendCaps ORDER BY label;`
  );
  return rows.map(toCap);
}

/** One cap per merchant or category: setting it again changes the amount. */
export async function setSpendCap(
  scope: CapScope,
  label: string,
  weeklyAmount: number,
  now: Date = new Date()
): Promise<void> {
  await getAdapter().runAsync(
    `INSERT INTO SpendCaps (scope, key, label, weekly_amount, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(scope, key) DO UPDATE SET weekly_amount = excluded.weekly_amount, label = excluded.label;`,
    [scope, keyFor(label), label.trim(), weeklyAmount, now.toISOString()]
  );
}

export async function deleteSpendCap(id: number): Promise<void> {
  await getAdapter().runAsync(`DELETE FROM SpendCaps WHERE id = ?;`, [id]);
}

export interface SpendRow {
  merchant: string;
  category: string | null;
  amount: number;
  occurred_at: string;
}

/**
 * Spending payments in a window, one row each — what callouts, caps and
 * risky windows read. Same exclusions as the budget's gross spend: no
 * transfers between your own accounts, nothing marked as not-spending.
 */
export async function getSpendRowsBetween(startIso: string, endIso: string): Promise<SpendRow[]> {
  return getAdapter().getAllAsync<SpendRow>(
    `SELECT merchant, category, amount, occurred_at FROM Transactions
     WHERE kind = 'SPEND' AND status = 'COMPLETED' AND excluded_at IS NULL
       AND transfer_pair_id IS NULL AND non_spend_reason IS NULL
       AND occurred_at >= ? AND occurred_at < ?
     ORDER BY occurred_at;`,
    [startIso, endIso]
  );
}
