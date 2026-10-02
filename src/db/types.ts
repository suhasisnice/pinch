// Row shapes matching the SQLite schema exactly (see migrations.ts).

/** What the bank did to the account. */
export type Direction = 'DEBIT' | 'CREDIT';

/**
 * What a transaction MEANS, as distinct from which way the money moved.
 *
 * - SPEND       real expense, counts against the budget
 * - INCOME      allowance or top-up, grows the budget
 * - SETTLE_IN   a friend repaying you — NOT income; it clears a receivable
 * - SETTLE_OUT  you repaying a friend — NOT an expense; the expense was
 *               already booked when the original bill was paid
 * - REFUND      a reversal of an earlier SPEND
 */
export type TransactionKind = 'SPEND' | 'INCOME' | 'SETTLE_IN' | 'SETTLE_OUT' | 'REFUND';

export type CaptureSource = 'SMS' | 'NOTIFICATION' | 'MANUAL';

/**
 * How a transaction got its category. USER: set or confirmed by hand.
 * SURE: applied automatically, with certainty. GUESS: applied, but shown as
 * a guess until confirmed. LEGACY: set before 0.9.21 recorded this, and
 * resolved into one of the others by the revalidation sweep.
 */
export type CategorySource = 'USER' | 'SURE' | 'GUESS' | 'LEGACY';

export type IOUDirection = 'THEY_OWE_ME' | 'I_OWE_THEM';

/**
 * A transaction's lifecycle, independent of `kind`/`direction`.
 *
 * Every row defaults to COMPLETED — the parser currently hard-rejects
 * failed/pending language rather than recording it, so nothing produces the
 * other states yet. The column exists so Phase 7 can start writing PENDING
 * and FAILED rows without a schema change, and so a failed payment can be
 * excluded from spending sums structurally (Rule I) rather than only by
 * never having been parsed into a row in the first place.
 */
export type TransactionStatus = 'COMPLETED' | 'PENDING' | 'FAILED' | 'REVERSED' | 'REFUNDED';

export interface TransactionRow {
  id: number;
  amount: number;
  direction: Direction;
  kind: TransactionKind;
  merchant: string;
  category: string | null;
  /** One level below category ("Delivery" under Food). Null when not known. See migration v20. */
  subcategory: string | null;
  /** Where the category came from — see CategorySource. Null when uncategorised. */
  category_source: CategorySource | null;
  occurred_at: string;
  source: CaptureSource;
  raw_text: string | null;
  external_ref: string | null;
  dedup_key: string | null;
  outing_id: number | null;
  note: string | null;
  /** The other leg, when this row is one half of a move between your accounts. */
  transfer_pair_id: number | null;
  /** Set when this left the account but was not spent on anything. */
  non_spend_reason: string | null;
  excluded_at: string | null;
  status: TransactionStatus;
  /**
   * A manual correction to the ledger, not a new `kind` — a debit adjustment
   * is still `SPEND` and a credit adjustment is still `INCOME` for every
   * budget/insights query. This only changes how it is labelled. 0 or 1.
   */
  is_adjustment: number;
  /** Paid with notes from the wallet, so it moves the cash figure and not the bank one. 0 or 1. */
  paid_in_cash: number;
  created_at: string;
}

export interface ContactRow {
  id: number;
  name: string;
  is_ghost: number; // 0 | 1
  phone: string | null;
  created_at: string | null;
}

export interface IOURow {
  id: number;
  transaction_id: number | null;
  contact_id: number;
  direction: IOUDirection;
  amount: number;
  reason: string | null;
  outing_id: number | null;
  /** The payment whose reimbursement link created this IOU; NULL for any other IOU. */
  origin_transaction_id?: number | null;
  created_at: string;
}

export interface SettlementRow {
  id: number;
  iou_id: number;
  transaction_id: number | null;
  amount: number;
  settled_at: string;
}

/**
 * An IOU with its settled total folded in. `openAmount` is always derived
 * from the Settlements ledger, never stored, so it cannot drift away from the
 * payments underneath it.
 */
export interface IOUDetail {
  id: number;
  contactId: number;
  contactName: string;
  contactPhone: string | null;
  transactionId: number | null;
  merchant: string | null;
  direction: IOUDirection;
  amount: number;
  settledAmount: number;
  openAmount: number;
  reason: string | null;
  outingId: number | null;
  createdAt: string;
}

/** Net position with one person, collapsed across every open IOU both ways. */
export interface ContactBalance {
  contactId: number;
  name: string;
  phone: string | null;
  isGhost: boolean;
  /** Positive: they owe you. Negative: you owe them. */
  netAmount: number;
  openCount: number;
  oldestOpenAt: string | null;
  /** Mean days to settle, or null with too little history to judge. */
  avgDaysToSettle: number | null;
  settledCount: number;
}

export interface OutingRow {
  id: number;
  name: string;
  emoji: string;
  starts_at: string;
  ends_at: string | null;
  budget_amount: number | null;
  created_at: string;
  closed_at: string | null;
}

/** One entry in an outing's reserve ledger. Signed; summed on read, never stored as a total. */
export interface OutingReserveRow {
  id: number;
  outing_id: number;
  amount: number;
  source: 'MANUAL' | 'AUTO';
  created_at: string;
}

export interface GoalRow {
  id: number;
  name: string;
  emoji: string;
  target_amount: number;
  deadline: string | null;
  created_at: string;
  archived_at: string | null;
}

export interface GoalContributionRow {
  id: number;
  goal_id: number;
  amount: number;
  source: 'ROUNDUP' | 'MANUAL' | 'AUTO';
  transaction_id: number | null;
  created_at: string;
}

export type CaptureStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface CaptureInboxRow {
  id: number;
  raw_text: string;
  source: 'SMS' | 'NOTIFICATION';
  sender: string | null;
  received_at: string;
  parsed_amount: number | null;
  parsed_merchant: string | null;
  parsed_direction: Direction | null;
  confidence: number;
  status: CaptureStatus;
  transaction_id: number | null;
  dedup_key: string | null;
  /**
   * Set when this looks like it might be an already-recorded payment
   * reported by a second source, but nothing could confirm it — the review
   * inbox asks rather than guessing. See migration v13.
   */
  possible_duplicate_of: number | null;
  /** 'INVESTMENT' when the message looks like one — a suggestion, never a decision (v16). */
  suggested_reason?: string | null;
  created_at: string;
}

export interface NotificationLogRow {
  id: number;
  type: string;
  tier: string;
  title: string;
  body: string;
  payload: string | null;
  transaction_id: number | null;
  created_at: string;
  read_at: string | null;
  action: string | null;
}

export interface BudgetPeriodRow {
  id: number;
  starts_on: string;
  ends_on: string;
  allowance: number;
  created_at: string;
}

export interface RunResult {
  lastInsertRowId: number;
  changes: number;
}

// Minimal async SQLite surface both expo-sqlite (on-device) and the sql.js
// test adapter (in Jest, no native module) implement identically, so the
// query logic is exercised by real SQL in both environments.
export interface DbAdapter {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<RunResult>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
}
