import { getAdapter } from '../connection';
import { Direction } from '../types';

/**
 * Every message the phone handed the app, before anything decided what to
 * do with it. See `docs/phases/PHASE_7_AUTO_INGESTION.md` — this table is
 * the fix for a message the parser rejected (or the blocklist caught, or
 * the duplicate matcher swallowed) leaving no row anywhere at all, which is
 * exactly why a dropped payment used to be undiagnosable.
 */
export interface RawEventRow {
  id: number;
  source: 'SMS' | 'NOTIFICATION';
  sender: string | null;
  body: string;
  receivedAt: string;
  createdAt: string;
}

export async function recordRawEvent(input: {
  source: 'SMS' | 'NOTIFICATION';
  sender: string | null;
  body: string;
  receivedAt: string;
}): Promise<number> {
  const db = getAdapter();
  const now = new Date().toISOString();
  const result = await db.runAsync(
    `INSERT INTO RawEvents (source, sender, body, received_at, created_at) VALUES (?, ?, ?, ?, ?);`,
    [input.source, input.sender, input.body, input.receivedAt, now]
  );
  return result.lastInsertRowId;
}

export async function getRawEventById(id: number): Promise<RawEventRow | null> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{
    id: number;
    source: 'SMS' | 'NOTIFICATION';
    sender: string | null;
    body: string;
    received_at: string;
    created_at: string;
  }>(`SELECT * FROM RawEvents WHERE id = ?;`, [id]);
  return row
    ? {
        id: row.id,
        source: row.source,
        sender: row.sender,
        body: row.body,
        receivedAt: row.received_at,
        createdAt: row.created_at,
      }
    : null;
}

export async function getRecentRawEvents(limit = 100): Promise<RawEventRow[]> {
  const db = getAdapter();
  const rows = await db.getAllAsync<{
    id: number;
    source: 'SMS' | 'NOTIFICATION';
    sender: string | null;
    body: string;
    received_at: string;
    created_at: string;
  }>(`SELECT * FROM RawEvents ORDER BY received_at DESC LIMIT ?;`, [limit]);
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    sender: row.sender,
    body: row.body,
    receivedAt: row.received_at,
    createdAt: row.created_at,
  }));
}

/**
 * What happened to every message that has never once produced a
 * transaction, capture, or a stored explanation of why not — the raw
 * material for "why did my payment not show up," and for reprocessing once
 * a parser fix ships. Deliberately not "every RawEvent with no ParsedEvent
 * at the *current* parser version": a message already sitting in the
 * review inbox or already posted does not need re-explaining just because
 * the parser moved on, so this only surfaces ones whose *every* recorded
 * attempt ended in one of the SKIPPED_* outcomes.
 */
export async function getUnresolvedRawEvents(limit = 200): Promise<RawEventRow[]> {
  const db = getAdapter();
  const rows = await db.getAllAsync<{
    id: number;
    source: 'SMS' | 'NOTIFICATION';
    sender: string | null;
    body: string;
    received_at: string;
    created_at: string;
  }>(
    `SELECT RawEvents.* FROM RawEvents
     WHERE NOT EXISTS (
       SELECT 1 FROM ParsedEvents
       WHERE ParsedEvents.raw_event_id = RawEvents.id
         AND ParsedEvents.outcome IN ('POSTED', 'QUEUED')
     )
     ORDER BY RawEvents.received_at DESC
     LIMIT ?;`,
    [limit]
  );
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    sender: row.sender,
    body: row.body,
    receivedAt: row.received_at,
    createdAt: row.created_at,
  }));
}

export type ParsedEventOutcome =
  | 'POSTED'
  | 'QUEUED'
  | 'SKIPPED_BLOCKED'
  | 'SKIPPED_NO_PARSE'
  | 'SKIPPED_DUPLICATE'
  | 'SKIPPED_ADD_FAILED';

export interface ParsedEventRow {
  id: number;
  rawEventId: number;
  parserVersion: number;
  outcome: ParsedEventOutcome;
  rejectReason: string | null;
  amount: number | null;
  direction: Direction | null;
  merchant: string | null;
  confidence: number | null;
  transactionId: number | null;
  captureId: number | null;
  createdAt: string;
}

export interface NewParsedEvent {
  rawEventId: number;
  parserVersion: number;
  outcome: ParsedEventOutcome;
  rejectReason?: string | null;
  amount?: number | null;
  direction?: Direction | null;
  merchant?: string | null;
  confidence?: number | null;
  transactionId?: number | null;
  captureId?: number | null;
}

/**
 * Records one processing attempt. Never updates a prior row — a message
 * reprocessed under a newer parser version keeps its old outcome on the
 * record, so the history of why it was once rejected survives the fix that
 * changed the answer (PRODUCT_SPEC §11: never discard evidence merely
 * because it was superseded).
 */
export async function recordParsedEvent(input: NewParsedEvent): Promise<number> {
  const db = getAdapter();
  const now = new Date().toISOString();
  const result = await db.runAsync(
    `INSERT INTO ParsedEvents
       (raw_event_id, parser_version, outcome, reject_reason, amount, direction,
        merchant, confidence, transaction_id, capture_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      input.rawEventId,
      input.parserVersion,
      input.outcome,
      input.rejectReason ?? null,
      input.amount ?? null,
      input.direction ?? null,
      input.merchant ?? null,
      input.confidence ?? null,
      input.transactionId ?? null,
      input.captureId ?? null,
      now,
    ]
  );
  return result.lastInsertRowId;
}

function toParsedEventRow(row: {
  id: number;
  raw_event_id: number;
  parser_version: number;
  outcome: ParsedEventOutcome;
  reject_reason: string | null;
  amount: number | null;
  direction: Direction | null;
  merchant: string | null;
  confidence: number | null;
  transaction_id: number | null;
  capture_id: number | null;
  created_at: string;
}): ParsedEventRow {
  return {
    id: row.id,
    rawEventId: row.raw_event_id,
    parserVersion: row.parser_version,
    outcome: row.outcome,
    rejectReason: row.reject_reason,
    amount: row.amount,
    direction: row.direction,
    merchant: row.merchant,
    confidence: row.confidence,
    transactionId: row.transaction_id,
    captureId: row.capture_id,
    createdAt: row.created_at,
  };
}

/** Every attempt on file for one message, newest first — the full "why" history. */
export async function getParsedEventsForRawEvent(rawEventId: number): Promise<ParsedEventRow[]> {
  const db = getAdapter();
  const rows = await db.getAllAsync<Parameters<typeof toParsedEventRow>[0]>(
    `SELECT * FROM ParsedEvents WHERE raw_event_id = ? ORDER BY created_at DESC;`,
    [rawEventId]
  );
  return rows.map(toParsedEventRow);
}

/** The most recent attempt on file for one message, or null if it has never been processed at all. */
export async function getLatestParsedEvent(rawEventId: number): Promise<ParsedEventRow | null> {
  const db = getAdapter();
  const row = await db.getFirstAsync<Parameters<typeof toParsedEventRow>[0]>(
    `SELECT * FROM ParsedEvents WHERE raw_event_id = ? ORDER BY created_at DESC LIMIT 1;`,
    [rawEventId]
  );
  return row ? toParsedEventRow(row) : null;
}

export interface RejectionGroup {
  /** The stored explanation, e.g. "hard reject: \\botp\\b" or "no amount found". */
  reason: string;
  outcome: ParsedEventOutcome;
  count: number;
  /** One message that met this gate, for reading what the rule is actually catching. */
  example: string;
}

/**
 * Why messages are being dropped, most common first.
 *
 * The parser is tuned against the handful of formats anyone thought to try;
 * a real phone holds months of messages from banks nobody tested. Since
 * Phase 7 every one of them is kept along with the gate it met, which turns
 * "a payment went missing once" into something answerable in bulk: a rule
 * catching hundreds of real transactions shows up at the top of this list,
 * where a single bug report would never have revealed it.
 *
 * Grouped on the current parser version only. An explanation from an older
 * version describes a rule that may no longer exist, and mixing the two
 * would make a fixed problem look like a live one.
 */
export async function getRejectionBreakdown(
  parserVersion: number,
  limit = 20
): Promise<RejectionGroup[]> {
  const db = getAdapter();
  return db.getAllAsync<RejectionGroup>(
    `SELECT
       COALESCE(ParsedEvents.reject_reason, ParsedEvents.outcome) AS reason,
       ParsedEvents.outcome AS outcome,
       COUNT(*) AS count,
       MIN(RawEvents.body) AS example
     FROM ParsedEvents
     JOIN RawEvents ON RawEvents.id = ParsedEvents.raw_event_id
     WHERE ParsedEvents.parser_version = ?
       AND ParsedEvents.outcome LIKE 'SKIPPED%'
     GROUP BY reason, ParsedEvents.outcome
     ORDER BY count DESC
     LIMIT ?;`,
    [parserVersion, limit]
  );
}

/** How many raw events never became a transaction or a review item — the headline "missed" count. */
export async function countUnresolvedRawEvents(): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM RawEvents
     WHERE NOT EXISTS (
       SELECT 1 FROM ParsedEvents
       WHERE ParsedEvents.raw_event_id = RawEvents.id
         AND ParsedEvents.outcome IN ('POSTED', 'QUEUED')
     );`
  );
  return row?.total ?? 0;
}
