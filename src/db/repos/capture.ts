import { getAdapter } from '../connection';
import { CaptureInboxRow, CaptureStatus, Direction } from '../types';
import { tokenize, TokenWeights } from '../../math/merchantClassifier';
import { NAME_WORDS } from '../../math/categoryTaxonomy';
import {
  categorise,
  CategoriseInput,
  CategoriserKnowledge,
  CategoryDecision,
} from '../../math/categoriser';

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
  /** The transaction this might be a second report of, when that is genuinely unclear. See migration v13. */
  possibleDuplicateOf?: number | null;
  /** 'INVESTMENT' when it looks like one. Review asks; nothing is tagged automatically. See v16. */
  suggestedReason?: string | null;
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
          parsed_direction, confidence, status, dedup_key, possible_duplicate_of, suggested_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?);`,
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
        input.possibleDuplicateOf ?? null,
        input.suggestedReason ?? null,
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
 * Everything the categoriser needs from the database, loaded in one go so a
 * batch (the backfill, the legacy sweep) can reuse it across many rows.
 */
export async function loadCategoriserKnowledge(): Promise<CategoriserKnowledge> {
  const db = getAdapter();
  const [rules, weights, people] = await Promise.all([
    db.getAllAsync<{ pattern: string; category: string; subcategory: string | null; is_payee: number }>(
      `SELECT pattern, category, subcategory, is_payee FROM MerchantRules;`
    ),
    getCategoryTokenWeights(),
    db.getAllAsync<{ name: string }>(
      `SELECT name FROM Contacts UNION SELECT alias AS name FROM ContactAliases;`
    ),
  ]);
  return {
    rules: rules.map((r) => ({
      pattern: r.pattern,
      category: r.category,
      subcategory: r.subcategory,
      isPayee: r.is_payee === 1,
    })),
    weights,
    people: people.map((p) => p.name),
  };
}

/**
 * The categoriser's full answer for one payment: category, sub-category,
 * whether it is certain or a guess, and who the payee was. See
 * src/math/categoriser.ts.
 */
export async function categoriseTransaction(
  input: CategoriseInput,
  knowledge?: CategoriserKnowledge
): Promise<CategoryDecision | null> {
  return categorise(input, knowledge ?? (await loadCategoriserKnowledge()));
}

/**
 * What the user taught about this merchant, or a brand the app knows by
 * name — the two answers that need no guessing. Null otherwise.
 */
export async function categoriseMerchant(merchant: string): Promise<string | null> {
  const decision = await categoriseTransaction({ merchant });
  return decision && (decision.basis === 'learned' || decision.basis === 'brand') && decision.source !== 'GUESS'
    ? decision.category
    : null;
}

/**
 * Teaches the categoriser from a correction. The merchant name itself becomes
 * the pattern, matched on whole words (see categoriser.ts), so it outranks
 * any dictionary word that mis-fired.
 */
export async function learnMerchantRule(
  merchant: string,
  category: string,
  subcategory: string | null = null
): Promise<void> {
  const pattern = merchant.trim().toLowerCase();
  if (!pattern) return;
  await upsertRule(pattern, category, subcategory, false);
}

/**
 * Teaches the category for one person — stored against their UPI handle and
 * their name, never spread across the words in the name.
 */
export async function learnPayeeRule(
  keys: string[],
  category: string,
  subcategory: string | null = null
): Promise<void> {
  for (const key of keys) await upsertRule(key, category, subcategory, true);
}

async function upsertRule(
  pattern: string,
  category: string,
  subcategory: string | null,
  isPayee: boolean
): Promise<void> {
  const db = getAdapter();
  await db.runAsync(
    `INSERT INTO MerchantRules (pattern, category, subcategory, is_payee, hit_count, created_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(pattern) DO UPDATE SET
       category = excluded.category,
       subcategory = excluded.subcategory,
       is_payee = excluded.is_payee,
       hit_count = hit_count + 1;`,
    [pattern, category, subcategory, isPayee ? 1 : 0, new Date().toISOString()]
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
 * Best category for a merchant, by the whole cascade — guesses included.
 * Kept for callers that only want the name; new code wants
 * categoriseTransaction, which also says how sure it is.
 */
export async function smartCategoriseMerchant(merchant: string): Promise<string | null> {
  return (await categoriseTransaction({ merchant }))?.category ?? null;
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
  // A person's name never teaches a category, even inside a shop's name:
  // "Kumar Tea Stall" says "tea", not "kumar".
  const tokens = tokenize(merchant).filter((token) => !NAME_WORDS.has(token));
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
