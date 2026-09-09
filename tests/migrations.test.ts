import { createSqlJsAdapter } from './utils/sqljsAdapter';
import { DbAdapter } from '../src/db/types';
import { LATEST_VERSION, MIGRATIONS, runMigrations } from '../src/db/migrations';

/** Applies only the migrations up to and including `version`. */
async function migrateTo(db: DbAdapter, version: number): Promise<void> {
  await db.execAsync(`PRAGMA foreign_keys = OFF;`);
  for (const migration of MIGRATIONS) {
    if (migration.version > version) break;
    for (const statement of migration.statements) {
      await db.execAsync(statement);
    }
    await db.execAsync(`PRAGMA user_version = ${migration.version};`);
  }
  await db.execAsync(`PRAGMA foreign_keys = ON;`);
}

async function tableNames(db: DbAdapter): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;`
  );
  return rows.map((r) => r.name);
}

async function columnNames(db: DbAdapter, table: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table});`);
  return rows.map((r) => r.name).sort();
}

describe('migrations', () => {
  it('brings a fresh database to the latest version', async () => {
    const db = await createSqlJsAdapter();
    const version = await runMigrations(db);

    expect(version).toBe(LATEST_VERSION);
    expect(await tableNames(db)).toEqual(
      expect.arrayContaining([
        'BudgetPeriods',
        'CaptureInbox',
        'Contacts',
        'GoalContributions',
        'Goals',
        'IOUs',
        'MerchantRules',
        'NotificationLog',
        'Outings',
        'Settlements',
        'Transactions',
      ])
    );
  });

  it('is idempotent — running twice changes nothing', async () => {
    const db = await createSqlJsAdapter();
    await runMigrations(db);
    const first = await tableNames(db);

    const version = await runMigrations(db);

    expect(version).toBe(LATEST_VERSION);
    expect(await tableNames(db)).toEqual(first);
  });

  it('drops the v1 columns that encoded the fallacies', async () => {
    const db = await createSqlJsAdapter();
    await runMigrations(db);

    const transactions = await columnNames(db, 'Transactions');
    expect(transactions).toContain('direction');
    expect(transactions).toContain('kind');
    expect(transactions).toContain('dedup_key');
    // `type` conflated bank direction with economic meaning.
    expect(transactions).not.toContain('type');

    const ious = await columnNames(db, 'IOUs');
    expect(ious).toContain('direction');
    // Settlement is derived from the Settlements ledger now.
    expect(ious).not.toContain('is_settled');
  });

  it('preserves v1 data through the v3 rebuild', async () => {
    const db = await createSqlJsAdapter();
    await migrateTo(db, 2);

    await db.runAsync(
      `INSERT INTO Transactions (amount, merchant, timestamp, type) VALUES (?, ?, ?, ?);`,
      [700, 'Olive Cafe', '2026-09-01T10:00:00.000Z', 'DEBIT']
    );
    await db.runAsync(`INSERT INTO Contacts (name, is_ghost, phone) VALUES (?, 0, ?);`, [
      'Rahul',
      '+919000000000',
    ]);
    await db.runAsync(
      `INSERT INTO IOUs (transaction_id, contact_id, split_amount, is_settled) VALUES (1, 1, ?, 0);`,
      [175]
    );
    await db.runAsync(
      `INSERT INTO IOUs (transaction_id, contact_id, split_amount, is_settled) VALUES (1, 1, ?, 1);`,
      [225]
    );

    await runMigrations(db);

    const tx = await db.getFirstAsync<{
      amount: number;
      direction: string;
      kind: string;
      merchant: string;
      occurred_at: string;
    }>(`SELECT * FROM Transactions WHERE id = 1;`);
    expect(tx).toMatchObject({
      amount: 700,
      direction: 'DEBIT',
      kind: 'SPEND',
      merchant: 'Olive Cafe',
      occurred_at: '2026-09-01T10:00:00.000Z',
    });

    const ious = await db.getAllAsync<{ id: number; direction: string; amount: number }>(
      `SELECT id, direction, amount FROM IOUs ORDER BY id;`
    );
    expect(ious).toEqual([
      { id: 1, direction: 'THEY_OWE_ME', amount: 175 },
      { id: 2, direction: 'THEY_OWE_ME', amount: 225 },
    ]);

    // The settled one became a full payment in the ledger; the open one did not.
    const settlements = await db.getAllAsync<{ iou_id: number; amount: number }>(
      `SELECT iou_id, amount FROM Settlements ORDER BY iou_id;`
    );
    expect(settlements).toEqual([{ iou_id: 2, amount: 225 }]);

    const contact = await db.getFirstAsync<{ name: string; phone: string; created_at: string }>(
      `SELECT name, phone, created_at FROM Contacts WHERE id = 1;`
    );
    expect(contact?.name).toBe('Rahul');
    expect(contact?.phone).toBe('+919000000000');
    expect(contact?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('writes timestamps in the same ISO-8601 format JS produces', async () => {
    const db = await createSqlJsAdapter();
    await migrateTo(db, 2);
    await db.runAsync(`INSERT INTO Contacts (name, is_ghost) VALUES ('Ana', 0);`);
    await runMigrations(db);

    const row = await db.getFirstAsync<{ created_at: string }>(
      `SELECT created_at FROM Contacts WHERE name = 'Ana';`
    );
    // Must be directly comparable with new Date().toISOString() as TEXT.
    expect(row?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('enforces the invariants that keep the ledger honest', async () => {
    const db = await createSqlJsAdapter();
    await runMigrations(db);
    const now = new Date().toISOString();

    // amount is always positive; the sign lives in `direction`.
    await expect(
      db.runAsync(
        `INSERT INTO Transactions (amount, direction, kind, merchant, occurred_at, created_at)
         VALUES (?, 'DEBIT', 'SPEND', 'Bad', ?, ?);`,
        [-100, now, now]
      )
    ).rejects.toThrow();

    // kind must be one of the five economic meanings.
    await expect(
      db.runAsync(
        `INSERT INTO Transactions (amount, direction, kind, merchant, occurred_at, created_at)
         VALUES (100, 'DEBIT', 'WHATEVER', 'Bad', ?, ?);`,
        [now, now]
      )
    ).rejects.toThrow();

    // dedup_key is unique, so one payment seen over both SMS and the
    // notification listener can only ever be stored once.
    await db.runAsync(
      `INSERT INTO Transactions (amount, direction, kind, merchant, occurred_at, dedup_key, created_at)
       VALUES (340, 'DEBIT', 'SPEND', 'Swiggy', ?, 'ref-123', ?);`,
      [now, now]
    );
    await expect(
      db.runAsync(
        `INSERT INTO Transactions (amount, direction, kind, merchant, occurred_at, dedup_key, created_at)
         VALUES (340, 'DEBIT', 'SPEND', 'Swiggy', ?, 'ref-123', ?);`,
        [now, now]
      )
    ).rejects.toThrow();
  });

  it('lets an IOU exist with no transaction of your own behind it', async () => {
    const db = await createSqlJsAdapter();
    await runMigrations(db);
    const now = new Date().toISOString();

    await db.runAsync(`INSERT INTO Contacts (name, is_ghost, created_at) VALUES ('Ish', 0, ?);`, [now]);

    // Ish paid the whole bill; you owe a share. No money left your account,
    // so there is no transaction_id to point at. v1 could not express this.
    const result = await db.runAsync(
      `INSERT INTO IOUs (transaction_id, contact_id, direction, amount, created_at)
       VALUES (NULL, 1, 'I_OWE_THEM', ?, ?);`,
      [260, now]
    );

    expect(result.changes).toBe(1);
    const row = await db.getFirstAsync<{ direction: string; transaction_id: number | null }>(
      `SELECT direction, transaction_id FROM IOUs WHERE id = ?;`,
      [result.lastInsertRowId]
    );
    expect(row).toEqual({ direction: 'I_OWE_THEM', transaction_id: null });
  });
});
