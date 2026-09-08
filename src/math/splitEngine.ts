export interface SplitParticipant {
  contactId: number;
  /** Exclude toggle: false removes this person from the split entirely (share = 0). */
  included: boolean;
  /**
   * Ratio multiplier relative to other included participants. Defaults to 1
   * (even split). A participant with ratio 2 owes twice as much as one with
   * ratio 1.
   */
  ratio?: number;
}

export interface SplitShare {
  contactId: number;
  amount: number;
}

/**
 * Splits totalAmount across participants by ratio weight among everyone
 * still `included` (excluded participants get 0). ratio defaults to 1, so
 * with all-default ratios this is a plain even split.
 *
 * Amounts are rounded to cents and the rounding remainder is distributed
 * one cent at a time (largest-remainder method) so the shares always sum
 * exactly to totalAmount instead of drifting from floating point rounding.
 */
export function calculateSplit(totalAmount: number, participants: SplitParticipant[]): SplitShare[] {
  const included = participants.filter((p) => p.included);
  const totalCents = Math.round(totalAmount * 100);

  if (included.length === 0) {
    return participants.map((p) => ({ contactId: p.contactId, amount: 0 }));
  }

  const totalRatio = included.reduce((sum, p) => sum + (p.ratio ?? 1), 0);
  if (totalRatio <= 0) {
    throw new Error('calculateSplit: sum of ratios for included participants must be > 0');
  }

  const rawShares = included.map((p) => {
    const ratio = p.ratio ?? 1;
    const exact = (totalCents * ratio) / totalRatio;
    const flooredCents = Math.floor(exact);
    return {
      contactId: p.contactId,
      flooredCents,
      remainder: exact - flooredCents,
    };
  });

  const distributedCents = rawShares.reduce((sum, s) => sum + s.flooredCents, 0);
  let leftoverCents = totalCents - distributedCents;

  // Largest-remainder method: hand out leftover cents to whoever was
  // rounded down the most, so the sum matches totalCents exactly.
  const byRemainderDesc = [...rawShares].sort((a, b) => b.remainder - a.remainder);
  for (const share of byRemainderDesc) {
    if (leftoverCents <= 0) break;
    share.flooredCents += 1;
    leftoverCents -= 1;
  }

  const shareByContact = new Map(rawShares.map((s) => [s.contactId, s.flooredCents / 100]));

  return participants.map((p) => ({
    contactId: p.contactId,
    amount: shareByContact.get(p.contactId) ?? 0,
  }));
}
