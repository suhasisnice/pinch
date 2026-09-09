import { DbAdapter } from './types';

/**
 * Forward-only migration runner keyed on SQLite's built-in `user_version`.
 *
 * Replaces the old approach (a bare `ALTER TABLE` in a swallowed try/catch),
 * which could not tell "already applied" from "genuinely broken" and had no
 * way to order changes. Each migration is applied exactly once, in order, and
 * the version is bumped only after all of its statements succeed.
 */
export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

/**
 * Every timestamp column in this database is an ISO-8601 UTC string produced
 * by either JS `new Date().toISOString()` or this expression. They must match
 * exactly: timestamps are compared and range-scanned as TEXT, so mixing
 * SQLite's default `datetime('now')` ("2026-09-09 04:00:00") with an ISO
 * string ("2026-09-09T04:00:00.000Z") would silently break every date filter
 * in the app — "2026-09-09T..." sorts after "2026-09-09 ..." because 'T' > ' '.
 */
const NOW_ISO = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

// ---------------------------------------------------------------------------
// v1 — the original Phase 1 shape, recreated here so that a fresh install and
// an upgraded install converge on byte-identical structure.
// ---------------------------------------------------------------------------
const V1_INITIAL: Migration = {
  version: 1,
  name: 'initial',
  statements: [
    `CREATE TABLE IF NOT EXISTS Transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL,
      merchant TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('DEBIT', 'CREDIT'))
    );`,
    `CREATE TABLE IF NOT EXISTS Contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_ghost INTEGER NOT NULL DEFAULT 0
    );`,
    `CREATE TABLE IF NOT EXISTS IOUs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL REFERENCES Transactions(id),
      contact_id INTEGER NOT NULL REFERENCES Contacts(id),
      split_amount REAL NOT NULL,
      is_settled INTEGER NOT NULL DEFAULT 0
    );`,
  ],
};

// ---------------------------------------------------------------------------
// v2 — the phone column the Nudge feature needs.
// ---------------------------------------------------------------------------
const V2_CONTACT_PHONE: Migration = {
  version: 2,
  name: 'contacts_phone',
  statements: [`ALTER TABLE Contacts ADD COLUMN phone TEXT;`],
};

// ---------------------------------------------------------------------------
// v3 — the real model.
//
// Tables are created in dependency order (Outings -> Transactions -> IOUs ->
// Settlements) so that no CREATE names a table that does not exist yet.
// Transactions and IOUs are rebuilt rather than altered, because the fixes are
// structural and SQLite cannot add CHECK constraints or relax NOT NULL in
// place.
// ---------------------------------------------------------------------------
const V3_CORE_MODEL: Migration = {
  version: 3,
  name: 'core_model',
  statements: [
    // -- Outings (no dependencies; referenced by Transactions and IOUs) ----
    `CREATE TABLE IF NOT EXISTS Outings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '🎉',
      starts_at TEXT NOT NULL,
      ends_at TEXT,
      budget_amount REAL CHECK (budget_amount IS NULL OR budget_amount > 0),
      created_at TEXT NOT NULL,
      closed_at TEXT
    );`,

    // -- Transactions ------------------------------------------------------
    // amount: ALWAYS POSITIVE. The sign lives in `direction`.
    // direction: what the bank did (money out / money in).
    // kind: what it MEANS economically.
    //
    // Separating direction from kind is the single most important fix here.
    // A friend repaying you is a CREDIT, but it is emphatically not income —
    // counting it as income inflates your allowance out of thin air. Paying a
    // friend back is a DEBIT but not an expense; that expense was already
    // recorded when the original bill was paid. Collapsing both into a single
    // DEBIT/CREDIT flag, as v1 did, makes those two errors unavoidable.
    `CREATE TABLE IF NOT EXISTS Transactions_v3 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL CHECK (amount > 0),
      direction TEXT NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
      kind TEXT NOT NULL CHECK (kind IN ('SPEND', 'INCOME', 'SETTLE_IN', 'SETTLE_OUT', 'REFUND')),
      merchant TEXT NOT NULL,
      category TEXT,
      occurred_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('SMS', 'NOTIFICATION', 'MANUAL')),
      raw_text TEXT,
      external_ref TEXT,
      dedup_key TEXT UNIQUE,
      outing_id INTEGER REFERENCES Outings(id) ON DELETE SET NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );`,
    `INSERT INTO Transactions_v3
       (id, amount, direction, kind, merchant, occurred_at, source, created_at)
     SELECT
       id,
       abs(amount),
       type,
       CASE WHEN type = 'DEBIT' THEN 'SPEND' ELSE 'INCOME' END,
       merchant,
       timestamp,
       'MANUAL',
       timestamp
     FROM Transactions
     WHERE amount <> 0;`,
    `DROP TABLE Transactions;`,
    `ALTER TABLE Transactions_v3 RENAME TO Transactions;`,
    `CREATE INDEX IF NOT EXISTS idx_tx_occurred ON Transactions(occurred_at);`,
    `CREATE INDEX IF NOT EXISTS idx_tx_kind ON Transactions(kind, occurred_at);`,
    `CREATE INDEX IF NOT EXISTS idx_tx_outing ON Transactions(outing_id);`,

    // -- Contacts ----------------------------------------------------------
    `ALTER TABLE Contacts ADD COLUMN created_at TEXT;`,
    `UPDATE Contacts SET created_at = ${NOW_ISO} WHERE created_at IS NULL;`,

    // -- IOUs --------------------------------------------------------------
    // transaction_id is NULLABLE now. When a friend pays the bill and you owe
    // them a share, no money left YOUR account, so there is no transaction of
    // yours to point at. v1's NOT NULL made half of all real debts literally
    // unrepresentable.
    //
    // There is deliberately no `is_settled` column. Settlement lives in the
    // Settlements ledger and the open balance is derived from it, so a stored
    // boolean can never drift out of agreement with the payments beneath it,
    // and partial repayment ("200 now, 250 later") becomes representable.
    `CREATE TABLE IF NOT EXISTS IOUs_v3 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER REFERENCES Transactions(id) ON DELETE CASCADE,
      contact_id INTEGER NOT NULL REFERENCES Contacts(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK (direction IN ('THEY_OWE_ME', 'I_OWE_THEM')),
      amount REAL NOT NULL CHECK (amount > 0),
      reason TEXT,
      outing_id INTEGER REFERENCES Outings(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );`,
    `INSERT INTO IOUs_v3 (id, transaction_id, contact_id, direction, amount, created_at)
     SELECT id, transaction_id, contact_id, 'THEY_OWE_ME', split_amount, ${NOW_ISO}
     FROM IOUs WHERE split_amount > 0;`,
    `CREATE TABLE IF NOT EXISTS Settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      iou_id INTEGER NOT NULL REFERENCES IOUs(id) ON DELETE CASCADE,
      transaction_id INTEGER REFERENCES Transactions(id) ON DELETE SET NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      settled_at TEXT NOT NULL
    );`,
    // Carry prior settlements over as one full payment each.
    `INSERT INTO Settlements (iou_id, amount, settled_at)
     SELECT id, split_amount, ${NOW_ISO} FROM IOUs WHERE is_settled = 1 AND split_amount > 0;`,
    `DROP TABLE IOUs;`,
    `ALTER TABLE IOUs_v3 RENAME TO IOUs;`,
    `CREATE INDEX IF NOT EXISTS idx_iou_contact ON IOUs(contact_id);`,
    `CREATE INDEX IF NOT EXISTS idx_settlement_iou ON Settlements(iou_id);`,

    // -- Goals -------------------------------------------------------------
    // Goals are VIRTUAL. Contributing to a goal never writes a Transaction,
    // because the money has not moved — it is still in the account, just
    // spoken for. If a contribution also wrote a SPEND row it would hit the
    // budget twice: once as spending, once as a reserve.
    `CREATE TABLE IF NOT EXISTS Goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '🎯',
      target_amount REAL NOT NULL CHECK (target_amount > 0),
      deadline TEXT,
      created_at TEXT NOT NULL,
      archived_at TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS GoalContributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL REFERENCES Goals(id) ON DELETE CASCADE,
      amount REAL NOT NULL CHECK (amount <> 0),
      source TEXT NOT NULL CHECK (source IN ('ROUNDUP', 'MANUAL', 'AUTO')),
      transaction_id INTEGER REFERENCES Transactions(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_goal_contrib ON GoalContributions(goal_id);`,

    // -- Capture inbox -----------------------------------------------------
    // Unconfirmed parses live HERE, never in Transactions. A low-confidence
    // regex hit must not be able to move the Safe-to-Spend number before a
    // human has agreed with it.
    `CREATE TABLE IF NOT EXISTS CaptureInbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_text TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('SMS', 'NOTIFICATION')),
      sender TEXT,
      received_at TEXT NOT NULL,
      parsed_amount REAL,
      parsed_merchant TEXT,
      parsed_direction TEXT CHECK (parsed_direction IS NULL OR parsed_direction IN ('DEBIT', 'CREDIT')),
      confidence REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
      transaction_id INTEGER REFERENCES Transactions(id) ON DELETE SET NULL,
      dedup_key TEXT,
      created_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_status ON CaptureInbox(status, received_at);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_dedup ON CaptureInbox(dedup_key) WHERE dedup_key IS NOT NULL;`,

    // -- Learned categorisation -------------------------------------------
    `CREATE TABLE IF NOT EXISTS MerchantRules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );`,

    // -- Budget periods ----------------------------------------------------
    // A student's month starts when the allowance lands, not on the 1st.
    // Hard-coding the calendar month is a fallacy for exactly the people this
    // app is for.
    `CREATE TABLE IF NOT EXISTS BudgetPeriods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      starts_on TEXT NOT NULL,
      ends_on TEXT NOT NULL,
      allowance REAL NOT NULL CHECK (allowance >= 0),
      created_at TEXT NOT NULL,
      CHECK (ends_on > starts_on)
    );`,

    // -- Notification ledger ----------------------------------------------
    // Every nudge is logged so the engine can rate-limit itself, avoid
    // repeating a line twice in a row, and learn which prompts get acted on.
    `CREATE TABLE IF NOT EXISTS NotificationLog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      tier TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      payload TEXT,
      transaction_id INTEGER REFERENCES Transactions(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      read_at TEXT,
      action TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_notif_type_time ON NotificationLog(type, created_at);`,
  ],
};

// ---------------------------------------------------------------------------
// v4 — blocking junk, and marking a transaction as excluded rather than
// deleting it.
//
// Promotional SMS are the dominant failure mode in practice: voucher blasts,
// rummy and betting spam, and "CTC" marketing all quote an amount and pass a
// naive parse. Regexes catch most of them, but the user needs a way to shut
// up the ones that get through for good, per sender.
// ---------------------------------------------------------------------------
const V4_BLOCKLIST: Migration = {
  version: 4,
  name: 'blocklist_and_exclusions',
  statements: [
    `CREATE TABLE IF NOT EXISTS CaptureBlocklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      /* Matched case-insensitively against the SMS sender ID, the notification
         package name, or the parsed merchant. */
      pattern TEXT NOT NULL UNIQUE,
      reason TEXT,
      created_at TEXT NOT NULL
    );`,

    // Excluded rather than deleted: a transaction the user says is not real
    // should leave the totals immediately, but keeping the row means the same
    // message cannot be re-imported by the next backfill through its dedup key.
    `ALTER TABLE Transactions ADD COLUMN excluded_at TEXT;`,
    `CREATE INDEX IF NOT EXISTS idx_txn_excluded ON Transactions(excluded_at);`,
  ],
};

// ---------------------------------------------------------------------------
// v5 — money moved between the user's own accounts.
//
// Stored as a link to the other leg rather than a new `kind`, for two
// reasons. Changing the kind CHECK constraint would mean rebuilding the whole
// Transactions table, and the pairing is the useful part: knowing a debit is
// a transfer is much less helpful than knowing which credit it landed in.
// Nulling the column undoes the classification.
// ---------------------------------------------------------------------------
const V5_TRANSFERS: Migration = {
  version: 5,
  name: 'self_transfers',
  statements: [
    `ALTER TABLE Transactions ADD COLUMN transfer_pair_id INTEGER;`,
    `CREATE INDEX IF NOT EXISTS idx_txn_transfer ON Transactions(transfer_pair_id);`,
  ],
};

// ---------------------------------------------------------------------------
// v6 — single transactions that are not spending.
//
// v5 covered money that moves in a *pair* of legs. This covers the ones that
// arrive alone: loading a wallet, paying a credit card bill. The money really
// did leave the account, so it cannot be rejected as junk, but it was not
// spent on anything — it changed hands between two things the user owns.
//
// A reason rather than a flag, because the right treatment differs: a wallet
// top-up should vanish from spending entirely, while a cash withdrawal is
// still spending and only wants a better category.
// ---------------------------------------------------------------------------
const V6_NON_SPEND: Migration = {
  version: 6,
  name: 'non_spend_reason',
  statements: [
    `ALTER TABLE Transactions ADD COLUMN non_spend_reason TEXT;`,
    `CREATE INDEX IF NOT EXISTS idx_txn_non_spend ON Transactions(non_spend_reason);`,
  ],
};

// ---------------------------------------------------------------------------
// v7 — what the bank actually says.
//
// Everything else in this database is inferred from messages, which means it
// drifts: a cash payment sends no SMS, a bank format goes unparsed, a
// notification is missed while permissions are off. A balance the user types
// in is ground truth, and the gap between it and the running total is the
// only honest measure of how much the app is missing.
//
// Stored as a history rather than a single value, so the drift between two
// snapshots can be compared against what was captured in between.
// ---------------------------------------------------------------------------
const V7_BALANCE: Migration = {
  version: 7,
  name: 'balance_snapshots',
  statements: [
    `CREATE TABLE IF NOT EXISTS BalanceSnapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL,
      recorded_at TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_balance_time ON BalanceSnapshots(recorded_at);`,
  ],
};

export const MIGRATIONS: Migration[] = [
  V1_INITIAL,
  V2_CONTACT_PHONE,
  V3_CORE_MODEL,
  V4_BLOCKLIST,
  V5_TRANSFERS,
  V6_NON_SPEND,
  V7_BALANCE,
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

async function getUserVersion(db: DbAdapter): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>(`PRAGMA user_version;`);
  return row?.user_version ?? 0;
}

/**
 * Applies every migration newer than the database's current `user_version`,
 * in ascending order.
 *
 * Foreign-key enforcement is suspended for the duration: v3 drops and
 * recreates tables that other tables reference, which a live FK graph would
 * reject even though the end state is consistent. Errors propagate — a
 * half-applied schema must fail loudly at startup rather than leave the app
 * querying columns that do not exist.
 */
export async function runMigrations(db: DbAdapter): Promise<number> {
  const startingVersion = await getUserVersion(db);
  if (startingVersion >= LATEST_VERSION) return startingVersion;

  await db.execAsync(`PRAGMA foreign_keys = OFF;`);
  try {
    for (const migration of MIGRATIONS) {
      if (migration.version <= startingVersion) continue;

      for (const statement of migration.statements) {
        await db.execAsync(statement);
      }
      // PRAGMA takes no bound parameters; the value is a literal from our own
      // migration list, never user input.
      await db.execAsync(`PRAGMA user_version = ${migration.version};`);
    }
  } finally {
    await db.execAsync(`PRAGMA foreign_keys = ON;`);
  }

  return getUserVersion(db);
}
