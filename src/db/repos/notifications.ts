import { getAdapter } from '../connection';
import { NotificationLogRow } from '../types';

export interface NewNotificationLog {
  type: string;
  tier: string;
  title: string;
  body: string;
  payload?: unknown;
  transactionId?: number | null;
}

export async function logNotification(input: NewNotificationLog): Promise<number> {
  const db = getAdapter();
  const result = await db.runAsync(
    `INSERT INTO NotificationLog (type, tier, title, body, payload, transaction_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [
      input.type,
      input.tier,
      input.title,
      input.body,
      input.payload === undefined ? null : JSON.stringify(input.payload),
      input.transactionId ?? null,
      new Date().toISOString(),
    ]
  );
  return result.lastInsertRowId;
}

export async function getRecentNotifications(limit = 50): Promise<NotificationLogRow[]> {
  const db = getAdapter();
  return db.getAllAsync<NotificationLogRow>(
    `SELECT * FROM NotificationLog ORDER BY created_at DESC LIMIT ?;`,
    [limit]
  );
}

/** How many of a given type were sent since `sinceIso`. Drives rate limiting. */
export async function countSince(type: string, sinceIso: string): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM NotificationLog WHERE type = ? AND created_at >= ?;`,
    [type, sinceIso]
  );
  return row?.count ?? 0;
}

/** Total notifications sent since `sinceIso`, across all types. */
export async function countAllSince(sinceIso: string): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM NotificationLog WHERE created_at >= ?;`,
    [sinceIso]
  );
  return row?.count ?? 0;
}

export async function getLastOfType(type: string): Promise<NotificationLogRow | null> {
  const db = getAdapter();
  return db.getFirstAsync<NotificationLogRow>(
    `SELECT * FROM NotificationLog WHERE type = ? ORDER BY created_at DESC LIMIT 1;`,
    [type]
  );
}

/**
 * The last few message bodies of a type, so the copy picker can avoid
 * repeating a line the user just saw. A joke lands once.
 */
export async function getRecentBodies(type: string, limit = 5): Promise<string[]> {
  const db = getAdapter();
  const rows = await db.getAllAsync<{ body: string }>(
    `SELECT body FROM NotificationLog WHERE type = ? ORDER BY created_at DESC LIMIT ?;`,
    [type, limit]
  );
  return rows.map((r) => r.body);
}

export async function markNotificationRead(id: number): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`UPDATE NotificationLog SET read_at = ? WHERE id = ?;`, [
    new Date().toISOString(),
    id,
  ]);
}

export async function recordNotificationAction(id: number, action: string): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`UPDATE NotificationLog SET action = ? WHERE id = ?;`, [action, id]);
}

export async function pruneNotifications(days = 30): Promise<number> {
  const db = getAdapter();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = await db.runAsync(`DELETE FROM NotificationLog WHERE created_at < ?;`, [cutoff]);
  return result.changes;
}
