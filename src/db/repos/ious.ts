import { getAdapter } from '../connection';
import { ContactBalance, ContactRow, IOUDetail, IOUDirection, IOURow, SettlementRow } from '../types';

// The open balance of an IOU is *always* computed, never stored:
//   open = amount - SUM(settlements against it)
// A stored is_settled flag could disagree with the payments beneath it; this
// expression cannot. It is also what makes partial repayment work for free.
const OPEN_AMOUNT_SQL = `
  IOUs.amount - COALESCE(
    (SELECT SUM(s.amount) FROM Settlements s WHERE s.iou_id = IOUs.id), 0
  )`;

const IOU_DETAIL_SELECT = `
  SELECT
    IOUs.id                AS id,
    IOUs.contact_id        AS contactId,
    Contacts.name          AS contactName,
    Contacts.phone         AS contactPhone,
    IOUs.transaction_id    AS transactionId,
    Transactions.merchant  AS merchant,
    IOUs.direction         AS direction,
    IOUs.amount            AS amount,
    COALESCE((SELECT SUM(s.amount) FROM Settlements s WHERE s.iou_id = IOUs.id), 0) AS settledAmount,
    ${OPEN_AMOUNT_SQL}     AS openAmount,
    IOUs.reason            AS reason,
    IOUs.outing_id         AS outingId,
    IOUs.created_at        AS createdAt
  FROM IOUs
  JOIN Contacts ON Contacts.id = IOUs.contact_id
  LEFT JOIN Transactions ON Transactions.id = IOUs.transaction_id`;

export interface NewIOU {
  contactId: number;
  amount: number;
  direction: IOUDirection;
  /** Omitted when a friend paid the bill — no transaction of yours exists. */
  transactionId?: number | null;
  reason?: string | null;
  outingId?: number | null;
}

export async function createIOU(input: NewIOU): Promise<number> {
  const db = getAdapter();
  const result = await db.runAsync(
    `INSERT INTO IOUs (transaction_id, contact_id, direction, amount, reason, outing_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [
      input.transactionId ?? null,
      input.contactId,
      input.direction,
      Math.abs(input.amount),
      input.reason ?? null,
      input.outingId ?? null,
      new Date().toISOString(),
    ]
  );
  return result.lastInsertRowId;
}

export async function getIOUById(id: number): Promise<IOUDetail | null> {
  const db = getAdapter();
  return db.getFirstAsync<IOUDetail>(`${IOU_DETAIL_SELECT} WHERE IOUs.id = ?;`, [id]);
}

/** Every IOU with money still outstanding, oldest debt first. */
export async function getOpenIOUs(): Promise<IOUDetail[]> {
  const db = getAdapter();
  return db.getAllAsync<IOUDetail>(
    `${IOU_DETAIL_SELECT} WHERE ${OPEN_AMOUNT_SQL} > 0.009 ORDER BY IOUs.created_at ASC;`
  );
}

export async function getOpenIOUsForContact(contactId: number): Promise<IOUDetail[]> {
  const db = getAdapter();
  return db.getAllAsync<IOUDetail>(
    `${IOU_DETAIL_SELECT}
     WHERE IOUs.contact_id = ? AND ${OPEN_AMOUNT_SQL} > 0.009
     ORDER BY IOUs.created_at ASC;`,
    [contactId]
  );
}

export async function getIOUsForOuting(outingId: number): Promise<IOUDetail[]> {
  const db = getAdapter();
  return db.getAllAsync<IOUDetail>(
    `${IOU_DETAIL_SELECT} WHERE IOUs.outing_id = ? ORDER BY IOUs.created_at ASC;`,
    [outingId]
  );
}

export async function deleteIOU(id: number): Promise<void> {
  const db = getAdapter();
  await db.runAsync(`DELETE FROM IOUs WHERE id = ?;`, [id]);
}

/**
 * Records a repayment against a specific IOU, by id.
 *
 * The old resolveIOUByAmount() matched on amount alone, so with two friends
 * each owing 175 it would close whichever row it happened to see first — a
 * coin flip that silently wrote off the wrong person's debt. Settling by id
 * removes the ambiguity entirely.
 *
 * Overpayment is clamped to what is actually outstanding, so a ledger can
 * never show more repaid than was ever owed.
 */
export async function settleIOU(
  iouId: number,
  amount?: number,
  transactionId?: number | null
): Promise<number> {
  const db = getAdapter();
  const iou = await getIOUById(iouId);
  if (!iou) throw new Error(`IOU ${iouId} not found`);
  if (iou.openAmount <= 0) return 0;

  const payment = Math.min(amount ?? iou.openAmount, iou.openAmount);
  if (payment <= 0) return 0;

  await db.runAsync(
    `INSERT INTO Settlements (iou_id, transaction_id, amount, settled_at) VALUES (?, ?, ?, ?);`,
    [iouId, transactionId ?? null, payment, new Date().toISOString()]
  );
  return payment;
}

/**
 * Settles a contact's open IOUs oldest-first out of a single payment, which is
 * how repayment actually arrives: one UPI transfer covering several bills.
 * Returns how much was applied and which IOUs it touched.
 */
export async function settleContactBalance(
  contactId: number,
  amount: number,
  transactionId?: number | null
): Promise<{ applied: number; iouIds: number[] }> {
  const open = await getOpenIOUsForContact(contactId);
  let remaining = amount;
  let applied = 0;
  const iouIds: number[] = [];

  for (const iou of open) {
    if (remaining <= 0.009) break;
    const payment = await settleIOU(iou.id, Math.min(remaining, iou.openAmount), transactionId);
    if (payment > 0) {
      remaining -= payment;
      applied += payment;
      iouIds.push(iou.id);
    }
  }

  return { applied, iouIds };
}

export async function getSettlementsForIOU(iouId: number): Promise<SettlementRow[]> {
  const db = getAdapter();
  return db.getAllAsync<SettlementRow>(
    `SELECT * FROM Settlements WHERE iou_id = ? ORDER BY settled_at ASC;`,
    [iouId]
  );
}

/**
 * Net position per person, collapsing debts in both directions into one
 * number. Six separate 75-rupee IOUs and one 200 you owe back becomes
 * "Rahul owes you 250" — which is the only form anyone actually settles in.
 *
 * `avgDaysToSettle` is the reliability signal: how long this person has
 * historically taken to pay you back, measured from when the debt was created
 * to when it was fully cleared. null until they have settled anything.
 */
export async function getContactBalances(): Promise<ContactBalance[]> {
  const db = getAdapter();
  const rows = await db.getAllAsync<{
    contactId: number;
    name: string;
    phone: string | null;
    isGhost: number;
    netAmount: number | null;
    openCount: number;
    oldestOpenAt: string | null;
  }>(
    `SELECT
       Contacts.id    AS contactId,
       Contacts.name  AS name,
       Contacts.phone AS phone,
       Contacts.is_ghost AS isGhost,
       COALESCE(SUM(
         CASE WHEN open.open_amount > 0.009
              THEN CASE WHEN open.direction = 'THEY_OWE_ME' THEN open.open_amount
                        ELSE -open.open_amount END
              ELSE 0 END
       ), 0) AS netAmount,
       COALESCE(SUM(CASE WHEN open.open_amount > 0.009 THEN 1 ELSE 0 END), 0) AS openCount,
       MIN(CASE WHEN open.open_amount > 0.009 THEN open.created_at END) AS oldestOpenAt
     FROM Contacts
     LEFT JOIN (
       SELECT IOUs.id, IOUs.contact_id, IOUs.direction, IOUs.created_at,
              ${OPEN_AMOUNT_SQL} AS open_amount
       FROM IOUs
     ) AS open ON open.contact_id = Contacts.id
     GROUP BY Contacts.id
     ORDER BY abs(netAmount) DESC, Contacts.name ASC;`
  );

  const reliability = await db.getAllAsync<{
    contactId: number;
    avgDays: number | null;
    settledCount: number;
  }>(
    `SELECT
       IOUs.contact_id AS contactId,
       AVG((julianday(last_settled) - julianday(IOUs.created_at))) AS avgDays,
       COUNT(*) AS settledCount
     FROM IOUs
     JOIN (
       SELECT iou_id, MAX(settled_at) AS last_settled, SUM(amount) AS paid
       FROM Settlements GROUP BY iou_id
     ) AS s ON s.iou_id = IOUs.id
     WHERE s.paid >= IOUs.amount - 0.009 AND IOUs.direction = 'THEY_OWE_ME'
     GROUP BY IOUs.contact_id;`
  );

  const byContact = new Map(reliability.map((r) => [r.contactId, r]));

  return rows.map((row) => {
    const rel = byContact.get(row.contactId);
    return {
      contactId: row.contactId,
      name: row.name,
      phone: row.phone,
      isGhost: row.isGhost === 1,
      netAmount: row.netAmount ?? 0,
      openCount: row.openCount,
      oldestOpenAt: row.oldestOpenAt,
      avgDaysToSettle: rel?.avgDays != null ? Math.max(0, rel.avgDays) : null,
      settledCount: rel?.settledCount ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/**
 * Reduces a phone number to the last 10 digits, so "+91 98765 43210",
 * "098765 43210" and "9876543210" all resolve to the same contact. Indian
 * mobile numbers are 10 digits; a country code or leading 0 is routing
 * detail, not part of the identity.
 */
function normalisePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

export async function addContact(
  name: string,
  isGhost = false,
  phone?: string | null
): Promise<number> {
  const db = getAdapter();
  const result = await db.runAsync(
    `INSERT INTO Contacts (name, is_ghost, phone, created_at) VALUES (?, ?, ?, ?);`,
    [name.trim(), isGhost ? 1 : 0, normalisePhone(phone), new Date().toISOString()]
  );
  return result.lastInsertRowId;
}

export async function getContacts(): Promise<ContactRow[]> {
  const db = getAdapter();
  return db.getAllAsync<ContactRow>(`SELECT * FROM Contacts ORDER BY name COLLATE NOCASE ASC;`);
}

export async function getContactById(id: number): Promise<ContactRow | null> {
  const db = getAdapter();
  return db.getFirstAsync<ContactRow>(`SELECT * FROM Contacts WHERE id = ?;`, [id]);
}

/**
 * Looks up a contact by name without creating one when there is no match.
 *
 * Unlike findOrCreateContact, this must never create a row: it exists for
 * checking whether an incoming payment might be someone paying back a debt,
 * and running that check against every stranger who ever sends money would
 * fill the Squad tab with one-off senders who were never a real contact.
 */
export async function findContactIdByName(name: string): Promise<number | null> {
  const db = getAdapter();
  const trimmed = name.trim();
  if (!trimmed) return null;
  const row = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM Contacts WHERE lower(name) = lower(?);`,
    [trimmed]
  );
  return row?.id ?? null;
}

export async function updateContact(
  id: number,
  fields: { name?: string; phone?: string | null; isGhost?: boolean }
): Promise<void> {
  const db = getAdapter();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (fields.name !== undefined) {
    sets.push('name = ?');
    params.push(fields.name.trim());
  }
  if (fields.phone !== undefined) {
    sets.push('phone = ?');
    params.push(normalisePhone(fields.phone));
  }
  if (fields.isGhost !== undefined) {
    sets.push('is_ghost = ?');
    params.push(fields.isGhost ? 1 : 0);
  }
  if (sets.length === 0) return;

  params.push(id);
  await db.runAsync(`UPDATE Contacts SET ${sets.join(', ')} WHERE id = ?;`, params);
}

/** Resolves a name to a contact id, creating the contact if it is new. */
export async function findOrCreateContactByName(name: string): Promise<number> {
  return findOrCreateContact({ name });
}

/**
 * Same, but carries a phone number through when one is known — picking someone
 * from the phone's contacts should mean the WhatsApp nudge works, and an
 * existing contact that was typed by hand earlier gets its number filled in
 * rather than being duplicated.
 *
 * Phone is checked first, before name. A name alone drifts across capture
 * paths — "Dad" from an SMS, a different display name from a notification
 * for the same person — and matching on it alone silently forks one
 * person's debts across two Contacts rows that never settle each other.
 * The phone number does not drift, so when one is known it is the more
 * trustworthy signal and wins.
 */
export async function findOrCreateContact(input: {
  name: string;
  phone?: string | null;
}): Promise<number> {
  const db = getAdapter();
  const trimmed = input.name.trim();
  const phone = normalisePhone(input.phone);

  if (phone) {
    const byPhone = await db.getFirstAsync<ContactRow>(`SELECT * FROM Contacts WHERE phone = ?;`, [
      phone,
    ]);
    if (byPhone) return byPhone.id;
  }

  const existing = await db.getFirstAsync<ContactRow>(
    `SELECT * FROM Contacts WHERE lower(name) = lower(?);`,
    [trimmed]
  );

  if (!existing) return addContact(trimmed, false, phone);

  if (phone && !existing.phone) {
    await updateContact(existing.id, { phone });
  }
  return existing.id;
}

/**
 * Folds one contact into another — same person, recorded twice because a
 * capture path worded their name differently before phone matching existed,
 * or because they were typed by hand more than once. Every IOU moves to the
 * kept contact so open and settled debts stop being split across two
 * balances that never talk to each other; the merged-away contact is then
 * gone for good.
 */
export async function mergeContacts(keepId: number, mergeId: number): Promise<void> {
  if (keepId === mergeId) return;
  const db = getAdapter();

  const [kept, merging] = await Promise.all([getContactById(keepId), getContactById(mergeId)]);
  if (!kept || !merging) return;

  await db.runAsync(`UPDATE IOUs SET contact_id = ? WHERE contact_id = ?;`, [keepId, mergeId]);

  if (!kept.phone && merging.phone) {
    await updateContact(keepId, { phone: merging.phone });
  }

  await db.runAsync(`DELETE FROM Contacts WHERE id = ?;`, [mergeId]);
}

/** Total still owed to you across everyone. Feeds Safe-to-Spend. */
export async function getTotalReceivable(): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(open_amount), 0) AS total FROM (
       SELECT ${OPEN_AMOUNT_SQL} AS open_amount FROM IOUs WHERE IOUs.direction = 'THEY_OWE_ME'
     ) WHERE open_amount > 0.009;`
  );
  return row?.total ?? 0;
}

/** Total you still owe others. A hard claim on the budget — never discounted. */
export async function getTotalPayable(): Promise<number> {
  const db = getAdapter();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(open_amount), 0) AS total FROM (
       SELECT ${OPEN_AMOUNT_SQL} AS open_amount FROM IOUs WHERE IOUs.direction = 'I_OWE_THEM'
     ) WHERE open_amount > 0.009;`
  );
  return row?.total ?? 0;
}

/**
 * Every time a bill was split with someone, for ranking the quick-add row.
 *
 * Settled debts count as much as open ones — the question here is "who do you
 * go out with", not "who owes you", and someone who always pays back promptly
 * would otherwise be the first to disappear from the list.
 */
export async function getSplitHistory(sinceDays = 180): Promise<
  Array<{ contactId: number; at: string }>
> {
  const db = getAdapter();
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  return db.getAllAsync<{ contactId: number; at: string }>(
    `SELECT contact_id AS contactId, created_at AS at
     FROM IOUs
     WHERE created_at >= ?
     ORDER BY created_at DESC;`,
    [since]
  );
}
