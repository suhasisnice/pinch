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

// ---------------------------------------------------------------------------
// v8 — categorising a merchant the user has never corrected.
//
// MerchantRules (v3) only ever matches a merchant string it has seen before,
// which means it starts every fresh install completely empty: nothing has
// taught it "Zomato is Food" yet, so a brand-new user's whole first month
// sits Uncategorised. This table backs a second pass — a lightweight,
// on-device classifier scored on the *words* in a merchant name rather than
// the exact string, so a restaurant the app has never heard of still reads
// as Food because "cafe" is in its name.
//
// Seeded once, here, with a modest starting vocabulary of common Indian
// merchant and category words. The weights are deliberately small: real
// corrections earn weight too (see learnMerchantRule's caller), and a few of
// those should be enough to outweigh a seed guess that turns out wrong for
// how a particular person actually uses a word.
// ---------------------------------------------------------------------------
const SEED_TOKEN_WEIGHT = 3;
const SEED_CATEGORY_TOKENS: Record<string, string[]> = {
  Food: [
    'zomato',
    'swiggy',
    'dominos',
    'mcdonald',
    'mcdonalds',
    'kfc',
    'pizza',
    'cafe',
    'restaurant',
    'dhaba',
    'mess',
    'biryani',
    'chai',
    'chaayos',
    'coffee',
    'starbucks',
    'dunkin',
    'faasos',
    'box8',
    'eatfit',
    'freshmenu',
    'behrouz',
    'ovenstory',
    'bakery',
    'sweets',
    'food',
    'foods',
    'kitchen',
    'eatery',
    'canteen',
    'tiffin',
    'thali',
    'foodpanda',
    'momo',
    'rebel',
  ],
  Transport: [
    'uber',
    'ola',
    'rapido',
    'metro',
    'irctc',
    'redbus',
    'indigo',
    'ixigo',
    'petrol',
    'diesel',
    'fuel',
    'fastag',
    'toll',
    'parking',
    'cab',
    'auto',
    'rickshaw',
    'railway',
    'railways',
    'train',
    'flight',
    'airlines',
    'spicejet',
    'vistara',
    'ather',
    'yulu',
    'bounce',
    'vogo',
  ],
  Shopping: [
    'amazon',
    'flipkart',
    'myntra',
    'ajio',
    'nykaa',
    'meesho',
    'zepto',
    'blinkit',
    'instamart',
    'bigbasket',
    'dmart',
    'reliance',
    'decathlon',
    'lenskart',
    'croma',
    'ikea',
    'mart',
    'bazaar',
    'retail',
    'boat',
    'snapdeal',
    'tatacliq',
    'pepperfry',
    'urbanic',
    'styli',
  ],
  Subscriptions: [
    'netflix',
    'spotify',
    'hotstar',
    'disney',
    'prime',
    'primevideo',
    'youtube',
    'jiosaavn',
    'gaana',
    'wynk',
    'gym',
    'cultfit',
    'cult',
    'jiofiber',
    'airtel',
    'vodafone',
    'broadband',
    'wifi',
    'dth',
    'tatasky',
    'sunnxt',
    'zee5',
    'sonyliv',
    'icloud',
    'canva',
    'notion',
    'chatgpt',
    'openai',
    'adobe',
  ],
  Academics: [
    'exam',
    'fees',
    'fee',
    'tuition',
    'coaching',
    'college',
    'university',
    'library',
    'book',
    'books',
    'stationery',
    'xerox',
    'printout',
    'course',
    'udemy',
    'coursera',
    'byjus',
    'unacademy',
    'vedantu',
    'testbook',
    'scholarship',
    'hostel',
  ],
  Health: [
    'pharmacy',
    'medical',
    'medicine',
    'medicines',
    'hospital',
    'clinic',
    'apollo',
    'doctor',
    'diagnostic',
    'diagnostics',
    'lab',
    'netmeds',
    'pharmeasy',
    'dental',
    'physiotherapy',
    'wellness',
    'fortis',
    'manipal',
  ],
  Outing: [
    'movie',
    'movies',
    'cinema',
    'pvr',
    'inox',
    'bookmyshow',
    'bowling',
    'pub',
    'bar',
    'brewery',
    'club',
    'concert',
    'trip',
    'makemytrip',
    'goibibo',
    'oyo',
    'airbnb',
    'resort',
    'waterpark',
    'trekking',
    'camping',
  ],
};

/**
 * V8's own seed statement, frozen exactly as it shipped: a plain `INSERT`
 * (not `OR IGNORE`), reading only `SEED_CATEGORY_TOKENS`. `buildSeedInsert`
 * below was generalized to take a `seed` argument and switched to
 * `OR IGNORE` for v9 onward — v8 already ran on every existing install
 * under the original semantics, so its own migration keeps generating
 * exactly that SQL rather than reading through the now-shared function.
 * Never edit a migration that has already shipped; add the next one.
 */
function buildV8SeedInsert(): string {
  const rows: string[] = [];
  for (const [category, tokens] of Object.entries(SEED_CATEGORY_TOKENS)) {
    for (const token of tokens) {
      rows.push(`('${token}', '${category}', ${SEED_TOKEN_WEIGHT})`);
    }
  }
  return `INSERT INTO CategoryTokenWeights (token, category, weight) VALUES ${rows.join(', ')};`;
}

const V8_CATEGORY_TOKENS: Migration = {
  version: 8,
  name: 'category_token_weights',
  statements: [
    `CREATE TABLE IF NOT EXISTS CategoryTokenWeights (
      token TEXT NOT NULL,
      category TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (token, category)
    );`,
    buildV8SeedInsert(),
  ],
};

// OR IGNORE so a later seed never overwrites a weight the user has already
// taught for the same token and category. Used by v9 onward only — see
// buildV8SeedInsert above for why v8 does not read through this.
function buildSeedInsert(seed: Record<string, string[]>): string {
  const rows: string[] = [];
  for (const [category, tokens] of Object.entries(seed)) {
    for (const token of tokens) {
      rows.push(`('${token}', '${category}', ${SEED_TOKEN_WEIGHT})`);
    }
  }
  return `INSERT OR IGNORE INTO CategoryTokenWeights (token, category, weight) VALUES ${rows.join(', ')};`;
}

// ---------------------------------------------------------------------------
// v9 — Bills and Rent, which v8 had no category for at all (a BESCOM or
// landlord payment carried zero signal), plus Bangalore transit it missed.
// A separate migration rather than an edit to v8's list: v8 has already run
// on every existing install, so only a new version reaches them.
// ---------------------------------------------------------------------------
const LOCAL_CATEGORY_TOKENS: Record<string, string[]> = {
  Bills: [
    'bescom',
    'bwssb',
    'bbmp',
    'electricity',
    'lpg',
    'indane',
    'bharatgas',
    'hpgas',
    'cylinder',
    'bill',
    'bills',
    'recharge',
    'postpaid',
    'maintenance',
    'mygate',
    'nobrokerhood',
    'apnacomplex',
  ],
  // No "pg" or "rental": "PAYU PG" is a payment gateway on countless
  // statements, and "rental" is as often a bike or car as a flat.
  Rent: [
    'rent',
    'landlord',
    'nobroker',
    'nestaway',
    'zolo',
    'stanza',
    'colive',
    'housing',
    'lease',
  ],
  Transport: ['yatri', 'nammayatri', 'bmtc', 'bmrcl', 'ksrtc'],
};

const V9_LOCAL_CATEGORY_TOKENS: Migration = {
  version: 9,
  name: 'bills_rent_local_transit_tokens',
  statements: [buildSeedInsert(LOCAL_CATEGORY_TOKENS)],
};

// ---------------------------------------------------------------------------
// v10 — Phase 1 financial engine: outing reserves and a transaction lifecycle.
//
// OutingReserves mirrors GoalContributions exactly, for the same reason:
// Goals already separate "spoken for" from "spent" via an append-only ledger
// summed on read, so savedAmount cannot drift from the entries that produced
// it. Outings had no equivalent, so Phase 5's "reserve money without moving
// cash" had nothing to reserve into. A signed-amount ledger costs nothing an
// isolated reserved_amount column wouldn't, and gets the same guarantee.
//
// `status` gives a transaction a lifecycle without touching kind or
// direction. It defaults every row — old and new — to COMPLETED, because
// nothing in the current parser produces anything else yet (it hard-rejects
// failed/pending language outright rather than recording it as such). No
// inline CHECK: every prior ADD COLUMN in this file is unconstrained
// (non_spend_reason, excluded_at), so validity is enforced in the repo layer
// rather than risking an ALTER TABLE ... ADD COLUMN CHECK this codebase has
// never exercised against expo-sqlite on-device.
// ---------------------------------------------------------------------------
const V10_FINANCIAL_ENGINE: Migration = {
  version: 10,
  name: 'outing_reserves_and_transaction_status',
  statements: [
    `CREATE TABLE IF NOT EXISTS OutingReserves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      outing_id INTEGER NOT NULL REFERENCES Outings(id) ON DELETE CASCADE,
      amount REAL NOT NULL CHECK (amount <> 0),
      source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'AUTO')),
      created_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_outing_reserve ON OutingReserves(outing_id);`,

    `ALTER TABLE Transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'COMPLETED';`,
    `CREATE INDEX IF NOT EXISTS idx_txn_status ON Transactions(status);`,
  ],
};

// ---------------------------------------------------------------------------
// v11 — Phase 2 manual transactions: an Adjustment marker.
//
// Not a new `kind` — see v5's own comment above on why that means rebuilding
// the whole table. An adjustment is a manual correction to the ledger
// ("I forgot to log 200 in cash spending"), and it should count toward the
// budget exactly like the SPEND or INCOME it actually is; `is_adjustment`
// only changes how it is labelled in the UI, never how any existing
// spend/income/category/insights query sums it, so none of them change.
// Unconstrained ADD COLUMN, matching v5/v6/v10's own precedent.
// ---------------------------------------------------------------------------
const V11_ADJUSTMENTS: Migration = {
  version: 11,
  name: 'transaction_adjustments',
  statements: [
    `ALTER TABLE Transactions ADD COLUMN is_adjustment INTEGER NOT NULL DEFAULT 0;`,
    `CREATE INDEX IF NOT EXISTS idx_txn_adjustment ON Transactions(is_adjustment);`,
  ],
};

// ---------------------------------------------------------------------------
// v12 — Phase 7: raw-event retention.
//
// Before this, a message the parser rejected (or that a blocklist caught, or
// that the duplicate matcher swallowed) left no row anywhere — it was gone
// as completely as if the phone had never received it, which is exactly why
// a dropped payment was undiagnosable: there was nothing left to diagnose.
//
// RawEvents stores every captured message exactly once, unconditionally,
// before any parsing or filtering runs. ParsedEvents records what happened
// to it each time it was (re)processed — one row per attempt, never
// overwritten, so a message reprocessed under a newer parser version keeps
// its old outcome on the record rather than losing the history of why it was
// once rejected. `outcome` names exactly which gate a message met;
// `reject_reason` carries the specific pattern/rule for HARD/SOFT rejects,
// so "why did my payment not show up" becomes a query instead of a guess.
// ---------------------------------------------------------------------------
const V12_RAW_EVENTS: Migration = {
  version: 12,
  name: 'raw_event_retention',
  statements: [
    `CREATE TABLE IF NOT EXISTS RawEvents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL CHECK (source IN ('SMS', 'NOTIFICATION')),
      sender TEXT,
      body TEXT NOT NULL,
      received_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_rawevents_received ON RawEvents(received_at);`,

    `CREATE TABLE IF NOT EXISTS ParsedEvents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_event_id INTEGER NOT NULL REFERENCES RawEvents(id) ON DELETE CASCADE,
      parser_version INTEGER NOT NULL,
      outcome TEXT NOT NULL CHECK (outcome IN (
        'POSTED', 'QUEUED', 'SKIPPED_BLOCKED', 'SKIPPED_NO_PARSE',
        'SKIPPED_DUPLICATE', 'SKIPPED_ADD_FAILED'
      )),
      reject_reason TEXT,
      amount REAL,
      direction TEXT CHECK (direction IS NULL OR direction IN ('DEBIT', 'CREDIT')),
      merchant TEXT,
      confidence REAL,
      transaction_id INTEGER REFERENCES Transactions(id) ON DELETE SET NULL,
      capture_id INTEGER REFERENCES CaptureInbox(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_parsedevents_raw ON ParsedEvents(raw_event_id);`,
    `CREATE INDEX IF NOT EXISTS idx_parsedevents_outcome ON ParsedEvents(outcome, created_at);`,
  ],
};

// ---------------------------------------------------------------------------
// v13 — "is this the same payment, or a different one?"
//
// Two sources reporting one payment often name the sender differently — a
// UPI app uses the phone's contact name, the bank's SMS uses the name
// registered against the handle — so no string comparison can connect them.
// Matching on amount and timing alone would, but two people paying an
// identical amount seconds apart (everyone settling a shared bill at once)
// is a real thing that would then silently lose one of them.
//
// Neither guess is safe, so the app stops guessing: the capture goes to the
// review inbox pointing at the transaction it might duplicate, and the
// person who was there answers. PRODUCT_SPEC §1.4 — automatic when
// confident, ask when uncertain.
// ---------------------------------------------------------------------------
const V13_POSSIBLE_DUPLICATE: Migration = {
  version: 13,
  name: 'capture_possible_duplicate',
  statements: [
    `ALTER TABLE CaptureInbox ADD COLUMN possible_duplicate_of INTEGER REFERENCES Transactions(id) ON DELETE SET NULL;`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_possible_dupe ON CaptureInbox(possible_duplicate_of);`,
  ],
};

// ---------------------------------------------------------------------------
// v14 — the other name the same person goes by.
//
// One person reaches the app under at least two names: the one the phone's
// contacts call them, which is what a UPI app's notification shows, and the
// one registered against their UPI handle, which is what the bank's SMS
// uses. Nothing in either string connects them.
//
// That breaks two things, not one. Duplicate detection cannot tell the two
// reports of a payment apart from two different payments (v13 asks about
// that). And settlement matching — findContactIdByName, an exact match —
// silently fails to find the friend repaying a debt, so the repayment lands
// as income and the debt stays open. Both are the same missing fact, so
// both are fixed by storing it once: the answer the user already gives in
// Review is recorded here rather than thrown away, and the question stops
// being asked about that person again.
// ---------------------------------------------------------------------------
const V14_CONTACT_ALIASES: Migration = {
  version: 14,
  name: 'contact_aliases',
  statements: [
    `CREATE TABLE IF NOT EXISTS ContactAliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL REFERENCES Contacts(id) ON DELETE CASCADE,
      alias TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`,
    // An alias names one person. Case-insensitive so "RAVI ANNA" and
    // "Ravi Anna" cannot both be learned against different contacts.
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_alias_unique ON ContactAliases(lower(alias));`,
    `CREATE INDEX IF NOT EXISTS idx_contact_alias_contact ON ContactAliases(contact_id);`,
  ],
};

// ---------------------------------------------------------------------------
// v15 — "this money paid me back for those."
//
// Linking a reimbursement to the spends it covers is recorded with the
// machinery that already exists: an IOU against each spend, settled by the
// incoming payment. No row is deleted — both movements happened, and the
// bank-balance check depends on every one of them — the ledger just shows
// the linked set as one net line.
//
// What did not exist is a way to undo it cleanly. An IOU the user made by
// splitting a bill must survive an unlink; one the link itself invented to
// have something to settle must not. This column is that distinction: it
// names the payment whose linking created the IOU, and is NULL for every
// IOU made any other way.
// ---------------------------------------------------------------------------
const V15_REIMBURSEMENT_LINKS: Migration = {
  version: 15,
  name: 'reimbursement_links',
  statements: [
    `ALTER TABLE IOUs ADD COLUMN origin_transaction_id INTEGER REFERENCES Transactions(id) ON DELETE CASCADE;`,
    `CREATE INDEX IF NOT EXISTS idx_iou_origin ON IOUs(origin_transaction_id);`,
    `CREATE INDEX IF NOT EXISTS idx_settlement_tx ON Settlements(transaction_id);`,
  ],
};

// ---------------------------------------------------------------------------
// v16 — wealth: what you hold, what you put in, and what goes in monthly.
//
// A holding is a place long-term money lives (a fund, an FD, gold). Money
// into or out of it is still an ordinary Transaction tagged INVESTMENT
// (Phase 9); holding_id only says which holding it went to, so every
// existing total keeps working and an untagged row is simply "unassigned".
//
// current_value is typed in by the user now and then. Pinch has no market
// data (offline-first), so it is never computed and never guessed — NULL
// means "not told yet" and the screen falls back to money put in.
//
// sip_amount/sip_day make a monthly plan: the amount is set aside from the
// budget on its day, the same way a goal reserve is, until the contribution
// is actually logged.
//
// suggested_reason lets the capture pipeline say "this looks like an
// investment" without deciding it: such messages always wait in Review.
// ---------------------------------------------------------------------------
const V16_WEALTH: Migration = {
  version: 16,
  name: 'wealth',
  statements: [
    `CREATE TABLE IF NOT EXISTS Holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'OTHER',
      sip_amount REAL,
      sip_day INTEGER CHECK (sip_day IS NULL OR (sip_day BETWEEN 1 AND 28)),
      current_value REAL,
      value_updated_at TEXT,
      created_at TEXT NOT NULL,
      archived_at TEXT
    );`,
    `ALTER TABLE Transactions ADD COLUMN holding_id INTEGER REFERENCES Holdings(id) ON DELETE SET NULL;`,
    `CREATE INDEX IF NOT EXISTS idx_tx_holding ON Transactions(holding_id);`,
    `ALTER TABLE CaptureInbox ADD COLUMN suggested_reason TEXT;`,
  ],
};

// ---------------------------------------------------------------------------
// v17 — progress you can see.
//
// Net worth can only be computed for "now" (it rests on a bank balance that
// is projected forward), so its history has to be written down as it goes:
// one row per calendar month, overwritten while the month is current and
// frozen once it ends.
//
// Milestones are stored rather than recomputed so each keeps the date it
// was first reached — "cushion full, 3 Nov" should not move if the cushion
// later dips and refills.
// ---------------------------------------------------------------------------
const V17_PROGRESS: Migration = {
  version: 17,
  name: 'progress',
  statements: [
    `CREATE TABLE IF NOT EXISTS NetWorthSnapshots (
      month TEXT PRIMARY KEY,
      value REAL NOT NULL,
      recorded_at TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS Milestones (
      key TEXT PRIMARY KEY,
      achieved_at TEXT NOT NULL
    );`,
  ],
};

// ---------------------------------------------------------------------------
// v18 — personal SMS out.
//
// Before 0.9.17 every incoming SMS became a RawEvent, a friend's text
// included. Google Play's money-management exception and DPDP's data
// minimisation both say only financial messages may be kept. This removes
// what should never have been stored: SMS from a phone number (a sender with
// no letters in it) and OTP messages — in both cases only when the message
// never became a transaction or a review item, so no evidence behind a real
// ledger row is lost. From here on FinancialSms.kt and smsPrivacy.ts stop
// them at the door.
// ---------------------------------------------------------------------------
const PURGEABLE_RAW = `
  SELECT r.id FROM RawEvents r
  WHERE r.source = 'SMS'
    AND (
      r.sender IS NULL OR r.sender NOT GLOB '*[A-Za-z]*'
      OR r.body LIKE '%OTP%' OR r.body LIKE '%one time password%'
      OR r.body LIKE '%verification code%'
    )
    AND NOT EXISTS (
      SELECT 1 FROM ParsedEvents p
      WHERE p.raw_event_id = r.id
        AND (p.transaction_id IS NOT NULL OR p.capture_id IS NOT NULL)
    )`;

export const V18_SMS_PRIVACY: Migration = {
  version: 18,
  name: 'sms_privacy',
  statements: [
    `DELETE FROM ParsedEvents WHERE raw_event_id IN (${PURGEABLE_RAW});`,
    `DELETE FROM RawEvents WHERE id IN (${PURGEABLE_RAW});`,
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
  V8_CATEGORY_TOKENS,
  V9_LOCAL_CATEGORY_TOKENS,
  V10_FINANCIAL_ENGINE,
  V11_ADJUSTMENTS,
  V12_RAW_EVENTS,
  V13_POSSIBLE_DUPLICATE,
  V14_CONTACT_ALIASES,
  V15_REIMBURSEMENT_LINKS,
  V16_WEALTH,
  V17_PROGRESS,
  V18_SMS_PRIVACY,
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
