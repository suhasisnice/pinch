import { TransactionRow } from '../db/types';

/**
 * "This money paid me back for those" — the arithmetic, kept out of the
 * screen and out of SQL so it can be tested on its own.
 *
 * A reimbursement never deletes anything. Both movements happened and the
 * bank saw both; what changes is what they *mean*. Each covered spend gets
 * an IOU against it (or uses one it already had), the incoming payment
 * settles those IOUs, and the payment's own kind becomes SETTLE_IN so it
 * stops reading as income. The budget then already nets them — a spend's
 * cost to you is its amount minus whatever was charged to someone else.
 */

/** One spend the user ticked, with what is already known about it. */
export interface ReimbursableSpend {
  id: number;
  amount: number;
  occurredAt: string;
  /** Total of every THEY_OWE_ME IOU on this spend, whoever it names. */
  splitAway: number;
  /** Still-open THEY_OWE_ME balance on this spend owed by the payer specifically. */
  openFromPayer: number;
}

export interface ReimbursementAllocation {
  spendId: number;
  /** Applied against IOUs this person already owed on the spend. */
  fromExisting: number;
  /** Applied against a new IOU the link creates, because nobody had been charged for it yet. */
  fromNew: number;
}

export interface ReimbursementPlan {
  allocations: ReimbursementAllocation[];
  /** How much of the incoming payment the ticked spends absorb. */
  applied: number;
  /** Incoming money the ticked spends cannot account for. Must be zero to save. */
  excess: number;
  /** Sum of the ticked spends, in full. */
  spent: number;
  /** What the linked set nets to: positive is money out, negative is money in. */
  net: number;
}

const EPSILON = 0.009;
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Spreads an incoming payment across the ticked spends, oldest first — the
 * order the debts arose in, which is also how a person paying back several
 * things thinks about it.
 *
 * On each spend it uses up what this person was already recorded as owing
 * before inventing anything, and it never charges more to anyone than the
 * part of the bill that was not already split away. That cap is what stops
 * a link from claiming a friend repaid money a third person owes.
 */
export function planReimbursement(
  available: number,
  spends: ReimbursableSpend[]
): ReimbursementPlan {
  const ordered = [...spends].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  let remaining = round2(Math.max(0, available));
  const allocations: ReimbursementAllocation[] = [];

  for (const spend of ordered) {
    const fromExisting = round2(Math.min(remaining, Math.max(0, spend.openFromPayer)));
    remaining = round2(remaining - fromExisting);

    const room = Math.max(0, spend.amount - spend.splitAway);
    const fromNew = round2(Math.min(remaining, room));
    remaining = round2(remaining - fromNew);

    allocations.push({ spendId: spend.id, fromExisting, fromNew });
  }

  const applied = round2(Math.max(0, available) - remaining);
  const spent = round2(ordered.reduce((sum, spend) => sum + spend.amount, 0));

  return {
    allocations,
    applied,
    excess: remaining > EPSILON ? remaining : 0,
    spent,
    net: round2(spent - Math.max(0, available)),
  };
}

/** A settlement joining an incoming payment to a spend it paid back. */
export interface ReimbursementLink {
  creditId: number;
  spendId: number;
  amount: number;
}

export type LedgerItem =
  | { type: 'single'; transaction: TransactionRow }
  | {
      type: 'group';
      /** Stable key: the lowest member id. */
      key: number;
      /** Newest first, same as the ledger. */
      members: TransactionRow[];
      /** When the set was resolved — its most recent member. */
      occurredAt: string;
      moneyOut: number;
      moneyIn: number;
      /** Positive is money out, negative is money in. */
      net: number;
    };

/**
 * Folds linked payments into one ledger line each.
 *
 * Only rows that are actually in the list take part: a filter that shows
 * the repayment but not the bill leaves the repayment standing alone rather
 * than inventing a net for money the list is not showing. Links can chain —
 * one friend's payment covering two bills, and one bill paid back by four
 * friends — so membership is whatever is connected, not just pairs.
 *
 * The group sits where its newest member sits, which in a newest-first
 * ledger is the moment it was squared up.
 */
export function groupLinkedTransactions(
  rows: TransactionRow[],
  links: ReimbursementLink[]
): LedgerItem[] {
  const present = new Set(rows.map((row) => row.id));
  const parent = new Map<number, number>();

  const find = (id: number): number => {
    let root = id;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    // Path compression, so long chains stay cheap on every later lookup.
    let node = id;
    while (node !== root) {
      const next = parent.get(node)!;
      parent.set(node, root);
      node = next;
    }
    return root;
  };

  for (const link of links) {
    if (!present.has(link.creditId) || !present.has(link.spendId)) continue;
    if (!parent.has(link.creditId)) parent.set(link.creditId, link.creditId);
    if (!parent.has(link.spendId)) parent.set(link.spendId, link.spendId);
    const a = find(link.creditId);
    const b = find(link.spendId);
    if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
  }

  const membersByRoot = new Map<number, TransactionRow[]>();
  for (const row of rows) {
    if (!parent.has(row.id)) continue;
    const root = find(row.id);
    membersByRoot.set(root, [...(membersByRoot.get(root) ?? []), row]);
  }

  const emitted = new Set<number>();
  const items: LedgerItem[] = [];

  for (const row of rows) {
    if (!parent.has(row.id)) {
      items.push({ type: 'single', transaction: row });
      continue;
    }
    const root = find(row.id);
    if (emitted.has(root)) continue;
    emitted.add(root);

    const members = [...membersByRoot.get(root)!].sort((a, b) =>
      b.occurred_at.localeCompare(a.occurred_at)
    );
    const moneyOut = round2(
      members.filter((m) => m.direction === 'DEBIT').reduce((sum, m) => sum + m.amount, 0)
    );
    const moneyIn = round2(
      members.filter((m) => m.direction === 'CREDIT').reduce((sum, m) => sum + m.amount, 0)
    );

    items.push({
      type: 'group',
      key: Math.min(...members.map((m) => m.id)),
      members,
      occurredAt: members[0].occurred_at,
      moneyOut,
      moneyIn,
      net: round2(moneyOut - moneyIn),
    });
  }

  return items;
}
