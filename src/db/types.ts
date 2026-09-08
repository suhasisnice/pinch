// Row shapes matching the SQLite schema exactly (see schema.ts).

export interface TransactionRow {
  id: number;
  amount: number;
  merchant: string;
  timestamp: string;
  type: 'DEBIT' | 'CREDIT';
}

export interface ContactRow {
  id: number;
  name: string;
  is_ghost: number; // 0 | 1
  phone: string | null;
}

/** Open IOU joined with its contact and originating transaction, for UI display. */
export interface OpenIOUDetail {
  id: number;
  contactId: number;
  contactName: string;
  contactPhone: string | null;
  transactionId: number;
  merchant: string;
  splitAmount: number;
}

export interface IOURow {
  id: number;
  transaction_id: number;
  contact_id: number;
  split_amount: number;
  is_settled: number; // 0 | 1
}

export interface RunResult {
  lastInsertRowId: number;
  changes: number;
}

// Minimal async SQLite surface both expo-sqlite (on-device) and the sql.js
// test adapter (in Jest, no native module) implement identically, so
// dbService.ts's logic and its exported query shapes are exercised by real
// SQL in both environments.
export interface DbAdapter {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<RunResult>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
}
