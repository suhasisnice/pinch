import { getAdapter } from '../connection';
import { CaptureInboxRow, CaptureStatus, Direction } from '../types';
import { classifyTokens, tokenize, TokenWeights } from '../../math/merchantClassifier';

export interface NewCapture {
  rawText: string;
  source: 'SMS' | 'NOTIFICATION';
  sender?: string | null;
  receivedAt?: string;
  parsedAmount?: number | null;
  parsedMerchant?: string | null;
  parsedDirection?: Direction | null;
  confidence?: number;
  dedupKey?: string | null;
}

/**
 * Files an inbound message in the review inbox.
 *
 * Nothing here counts as money yet. A regex hit on an unfamiliar bank format
 * must not be able to move the Safe-to-Spend number before a human agrees
 * with it, so captures live in their own table until promoted.
 *
 * Returns null when the message duplicates one already filed — the partial
 * UNIQUE index on dedup_key makes the second insert fail, which is exactly
 * what should happen when SMS and the notification listener both report the
 * same payment.
 */
export async function recordCapture(input: NewCapture): Promise<number | null> {
  const db = getAdapter();
  const now = new Date().toISOString();

  if (input.dedupKey) {
    const existing = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM CaptureInbox WHERE dedup_key = ?;`,
      [input.dedupKey]
    );
    if (existing) return null;
  }

  try {
    const result = await db.runAsync(
      `INSERT INTO CaptureInbox
         (raw_text, source, sender, received_at, parsed_amount, parsed_merchant,
          parsed_direction, confidence, status, dedup_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?);`,
      [
        input.rawText,
        input.source,
        input.sender ?? null,
        input.receivedAt ?? now,
        input.parsedAmount ?? null,
        input.parsedMerchant ?? null,
        input.parsedDirection ?? null,
        input.confidence ?? 0,
        input.dedupKey ?? null,
        now,
      ]
    );
    return result.lastInsertRowId;
  } catch {
    // Lost a race on the unique dedup index — the other writer filed it.
    return null;
  }
}

export async function getPendingCaptures(): Promise<CaptureInboxRow[]> {
  const db = getAdapter();
  return db.getAllAsync<CaptureInboxRow>(
    `SELECT * FROM CaptureInbox WHERE status = 'PENDING' ORDER BY received_at DESC;`
  );
}

export async function getPendingCaptureCount(): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM CaptureInbox WHERE status = 'PENDING';`
  );
  return row?.count ?? 0;
}

export async function getCaptureById(id: number): Promise<CaptureInboxRow | null> {
  const db = getAdapter();
  return db.getFirstAsync<CaptureInboxRow>(`SELECT * FROM CaptureInbox WHERE id = ?;`, [id]);
}

export async function setCaptureStatus(
  id: number,
  status: CaptureStatus,
  transactionId?: number | null
): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`UPDATE CaptureInbox SET status = ?, transaction_id = ? WHERE id = ?;`, [
    status,
    transactionId ?? null,
    id,
  ]);
}

export async function rejectCapture(id: number): Promise<void> {
  await setCaptureStatus(id, 'REJECTED');
}

/** Trims accepted/rejected captures older than `days` to bound the raw-text table. */
export async function pruneCaptures(days = 45): Promise<number> {
  const db = getAdapter();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = await db.runAsync(
    `DELETE FROM CaptureInbox WHERE status != 'PENDING' AND received_at < ?;`,
    [cutoff]
  );
  return result.changes;
}

// ---------------------------------------------------------------------------
// Learned categorisation
// ---------------------------------------------------------------------------

/**
 * Best category for a merchant, by longest matching pattern so that a
 * specific rule ("dominos") beats a generic one ("mess") when both match.
 */
export async function categoriseMerchant(merchant: string): Promise<string | null> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ category: string }>(
    `SELECT category FROM MerchantRules
     WHERE instr(lower(?), lower(pattern)) > 0
     ORDER BY length(pattern) DESC
     LIMIT 1;`,
    [merchant]
  );
  return row?.category ?? null;
}

/**
 * Teaches the categoriser from a correction. The merchant name itself becomes
 * the pattern, so it outranks the generic keyword that mis-fired.
 */
export async function learnMerchantRule(merchant: string, category: string): Promise<void> {
  const db = getAdapter();
  const pattern = merchant.trim().toLowerCase();
  if (!pattern) return;

  await db.runAsync(
    `INSERT INTO MerchantRules (pattern, category, hit_count, created_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(pattern) DO UPDATE SET category = excluded.category, hit_count = hit_count + 1;`,
    [pattern, category, new Date().toISOString()]
  );
}

// ---------------------------------------------------------------------------
// Token-level categorisation — a fallback for a merchant name MerchantRules
// has never seen. See src/math/merchantClassifier.ts for the scoring itself;
// this is just the DB plumbing around it.
// ---------------------------------------------------------------------------

/** The whole learned vocabulary, shaped for classifyTokens. Small table. */
export async function getCategoryTokenWeights(): Promise<TokenWeights> {
  const db = getAdapter();
  const rows = await db.getAllAsync<{ token: string; category: string; weight: number }>(
    `SELECT token, category, weight FROM CategoryTokenWeights;`
  );
  const weights: TokenWeights = {};
  for (const row of rows) {
    if (!weights[row.category]) weights[row.category] = {};
    weights[row.category][row.token] = row.weight;
  }
  return weights;
}

/**
 * Best category for a merchant MerchantRules has no exact pattern for.
 *
 * Tries the precise, user-taught table first — a direct correction should
 * always win over a generic word guess — and only reaches for the token
 * classifier when that comes back empty.
 */
export async function smartCategoriseMerchant(merchant: string): Promise<string | null> {
  const exact = await categoriseMerchant(merchant);
  if (exact) return exact;

  const weights = await getCategoryTokenWeights();
  const result = classifyTokens(tokenize(merchant), weights);
  return result?.category ?? null;
}

/**
 * A correction from this specific user is worth several seed guesses, not
 * one. The seed vocabulary is a generic prior spread across ~200 words so
 * that a fresh install is not silent; against that much accumulated mass, a
 * single +1 could never move a word's classification even when the word is
 * brand new to the table — the correction would be true and permanently
 * outvoted. Chosen so that one correction on a genuinely new word is enough
 * to be trusted, while a word split across two different corrected
 * categories still has to earn a second correction before either wins.
 */
const CORRECTION_WEIGHT = 5;

/**
 * Reinforces the token vocabulary from a category the user just confirmed,
 * whether by correcting a wrong guess or accepting a right one.
 *
 * Deliberately separate from learnMerchantRule (the exact-string table):
 * that one only ever helps this exact merchant name again, while this one
 * generalises — correcting "Truffles Cafe" to Food teaches "cafe" broadly,
 * which is what lets the next unfamiliar café get it right on day one.
 */
export async function bumpTokenWeights(merchant: string, category: string): Promise<void> {
  const tokens = tokenize(merchant);
  if (tokens.length === 0) return;

  const db = getAdapter();
  for (const token of tokens) {
    await db.runAsync(
      `INSERT INTO CategoryTokenWeights (token, category, weight)
       VALUES (?, ?, ?)
       ON CONFLICT(token, category) DO UPDATE SET weight = weight + ?;`,
      [token, category, CORRECTION_WEIGHT, CORRECTION_WEIGHT]
    );
  }
}
