/**
 * Three ways to split a bill, because one is never enough.
 *
 * EQUAL   - down the middle. The default, and right most of the time.
 * SHARES  - weighted. Someone who ordered two drinks pays for two drinks;
 *           four people in a cab where one gets out halfway.
 * EXACT   - typed amounts per person. The only honest option when the bill
 *           itemises and the shares bear no relation to each other.
 *
 * All three produce the same SplitShare[] so nothing downstream needs to know
 * which was used. EQUAL and SHARES always sum to the total exactly; EXACT
 * reports what is left over instead of quietly rescaling numbers the user
 * typed.
 *
 * The payer is not implicit. Callers that want the payer to carry a share
 * pass them in as a participant with PAYER_ID - which is what the split UI
 * does, so a 1,200 bill across you and two friends is 400 each rather than
 * 600 each with you recovering the whole bill.
 */
export type SplitMode = 'EQUAL' | 'SHARES' | 'EXACT';

export const SPLIT_MODES: SplitMode[] = ['EQUAL', 'SHARES', 'EXACT'];

export const SPLIT_MODE_LABELS: Record<SplitMode, string> = {
  EQUAL: 'Equally',
  SHARES: 'By shares',
  EXACT: 'Exact',
};

export const SPLIT_MODE_HINTS: Record<SplitMode, string> = {
  EQUAL: 'Everyone pays the same',
  SHARES: 'Weight people 1x, 2x, 3x',
  EXACT: 'Type what each person owes',
};

/**
 * Sentinel contact id standing in for the person who paid. Negative so it can
 * never collide with a real Contacts row, which is a positive AUTOINCREMENT.
 */
export const PAYER_ID = -1;

export interface SplitParticipant {
  contactId: number;
  /** Exclude toggle: false removes this person from the split entirely (share = 0). */
  included: boolean;
  /**
   * Ratio multiplier used by SHARES. Defaults to 1, so a SHARES split with
   * every ratio left alone is identical to an EQUAL one.
   */
  ratio?: number;
  /** What this person owes under EXACT. Ignored by the other two modes. */
  exactAmount?: number;
}

export interface SplitShare {
  contactId: number;
  amount: number;
}

export interface SplitResult {
  shares: SplitShare[];
  /** What everyone other than the payer covers between them. */
  assigned: number;
  /** total - assigned. What the payer is left carrying. */
  yourShare: number;
  /** EXACT only: the typed amounts add up to more than the bill. */
  overAssigned: boolean;
}

const toCents = (amount: number): number => Math.round(amount * 100);

/**
 * Distributes `totalCents` across weights, handing every leftover cent to
 * whoever was rounded down hardest (largest-remainder method) so the shares
 * sum to the total exactly instead of drifting by a paisa per person.
 */
function distribute(
  totalCents: number,
  weighted: Array<{ contactId: number; weight: number }>
): Map<number, number> {
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight <= 0) {
    throw new Error('calculateSplit: sum of ratios for included participants must be > 0');
  }

  const raw = weighted.map((entry) => {
    const exact = (totalCents * entry.weight) / totalWeight;
    const floored = Math.floor(exact);
    return { contactId: entry.contactId, cents: floored, remainder: exact - floored };
  });

  let leftover = totalCents - raw.reduce((sum, r) => sum + r.cents, 0);
  for (const entry of [...raw].sort((a, b) => b.remainder - a.remainder)) {
    if (leftover <= 0) break;
    entry.cents += 1;
    leftover -= 1;
  }

  return new Map(raw.map((r) => [r.contactId, r.cents]));
}

/** The shares alone. Unchanged in behaviour from before modes existed. */
export function calculateSplit(
  totalAmount: number,
  participants: SplitParticipant[],
  mode: SplitMode = 'SHARES'
): SplitShare[] {
  return computeSplit(totalAmount, participants, mode).shares;
}

export function computeSplit(
  totalAmount: number,
  participants: SplitParticipant[],
  mode: SplitMode = 'SHARES'
): SplitResult {
  const totalCents = toCents(totalAmount);
  const included = participants.filter((p) => p.included);

  const assignedFrom = (shares: SplitShare[]): number =>
    shares.reduce((sum, s) => (s.contactId === PAYER_ID ? sum : sum + toCents(s.amount)), 0);

  if (included.length === 0 || totalCents <= 0) {
    const shares = participants.map((p) => ({ contactId: p.contactId, amount: 0 }));
    return { shares, assigned: 0, yourShare: totalAmount, overAssigned: false };
  }

  if (mode === 'EXACT') {
    // Typed amounts are taken as given - clamped to be non-negative, never
    // rescaled. Silently adjusting a number the user entered is worse than
    // showing them that it does not add up.
    const shares = participants.map((p) => ({
      contactId: p.contactId,
      amount: p.included ? Math.max(0, toCents(p.exactAmount ?? 0)) / 100 : 0,
    }));
    const assignedCents = assignedFrom(shares);

    return {
      shares,
      assigned: assignedCents / 100,
      yourShare: (totalCents - assignedCents) / 100,
      overAssigned: assignedCents > totalCents,
    };
  }

  // EQUAL and SHARES differ only in the weights they hand to the distributor.
  const weights = included.map((p) => ({
    contactId: p.contactId,
    weight: mode === 'EQUAL' ? 1 : Math.max(0, p.ratio ?? 1),
  }));
  const centsByContact = distribute(totalCents, weights);

  const shares = participants.map((p) => ({
    contactId: p.contactId,
    amount: (centsByContact.get(p.contactId) ?? 0) / 100,
  }));
  const assignedCents = assignedFrom(shares);

  return {
    shares,
    assigned: assignedCents / 100,
    yourShare: (totalCents - assignedCents) / 100,
    overAssigned: false,
  };
}

/**
 * An even starting point for EXACT: the equal split, ready to be edited. It
 * beats starting from zero, since most bills are close to even and the user
 * only wants to nudge one or two numbers.
 */
export function suggestExactAmounts(
  totalAmount: number,
  participants: SplitParticipant[]
): Map<number, number> {
  const equal = computeSplit(totalAmount, participants, 'EQUAL');
  return new Map(equal.shares.map((s) => [s.contactId, s.amount]));
}
