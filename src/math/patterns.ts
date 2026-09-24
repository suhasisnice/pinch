/**
 * Pattern callouts and weekly caps (0.9.19, docs/INTERVENTIONS.md §2).
 *
 * A callout names a habit while it is happening: the same place, again and
 * again this week, well above what that place usually costs. A cap is the
 * one-tap answer — a weekly number for that place, which Pinch then holds
 * every matching payment up against. Neither can block a payment. Both speak.
 */

export interface SpendItem {
  merchant: string;
  category: string | null;
  amount: number;
}

export type CapScope = 'MERCHANT' | 'CATEGORY';

export interface Callout {
  scope: CapScope;
  /** The merchant or category as shown. */
  label: string;
  /** The normalised key a cap is stored under. */
  key: string;
  count: number;
  total: number;
  /** Average weekly spend there over the previous weeks; 0 when new. */
  usualWeekly: number;
}

export const CALLOUT_MIN_COUNT = 3;
export const CALLOUT_MIN_TOTAL = 300;
export const CALLOUT_RATIO = 1.5;
export const HISTORY_WEEKS = 4;
export const MAX_CALLOUTS = 2;

export function keyFor(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface Tally {
  label: string;
  count: number;
  total: number;
}

function tally(items: SpendItem[], pick: (i: SpendItem) => string | null): Map<string, Tally> {
  const out = new Map<string, Tally>();
  for (const item of items) {
    const label = pick(item);
    if (!label || item.amount <= 0) continue;
    const key = keyFor(label);
    const t = out.get(key) ?? { label, count: 0, total: 0 };
    t.count += 1;
    t.total += item.amount;
    out.set(key, t);
  }
  return out;
}

/**
 * This week's habits worth naming. Merchants first — "Swiggy" lands harder
 * than "Food" — and a category only when no single merchant inside it
 * already explains it.
 */
export function findCallouts(
  thisWeek: SpendItem[],
  previousWeeks: SpendItem[],
  weeks = HISTORY_WEEKS
): Callout[] {
  const out: Callout[] = [];
  const scopes: Array<[CapScope, (i: SpendItem) => string | null]> = [
    ['MERCHANT', (i) => i.merchant],
    ['CATEGORY', (i) => (i.category && i.category !== 'Uncategorised' ? i.category : null)],
  ];
  const calledCategories = new Set<string>();

  for (const [scope, pick] of scopes) {
    const now = tally(thisWeek, pick);
    const before = tally(previousWeeks, pick);
    for (const [key, t] of now) {
      const usualWeekly = (before.get(key)?.total ?? 0) / Math.max(1, weeks);
      if (t.count < CALLOUT_MIN_COUNT) continue;
      if (t.total < Math.max(CALLOUT_MIN_TOTAL, usualWeekly * CALLOUT_RATIO)) continue;
      if (scope === 'CATEGORY' && calledCategories.has(key)) continue;
      out.push({ scope, label: t.label, key, count: t.count, total: t.total, usualWeekly });
      if (scope === 'MERCHANT') {
        const category = thisWeek.find((i) => keyFor(i.merchant) === key)?.category;
        if (category) calledCategories.add(keyFor(category));
      }
    }
  }

  return out.sort((a, b) => b.total - a.total).slice(0, MAX_CALLOUTS);
}

export interface SpendCap {
  id: number;
  scope: CapScope;
  key: string;
  label: string;
  weeklyAmount: number;
}

export type CapLevel = 'OK' | 'NEAR' | 'BROKEN';
export const CAP_NEAR = 0.8;

export function capLevel(cap: SpendCap, spent: number): CapLevel {
  if (spent > cap.weeklyAmount + 0.5) return 'BROKEN';
  if (spent >= cap.weeklyAmount * CAP_NEAR) return 'NEAR';
  return 'OK';
}

/** Does a payment belong to this cap? */
export function capMatches(cap: SpendCap, item: Pick<SpendItem, 'merchant' | 'category'>): boolean {
  if (cap.scope === 'MERCHANT') return keyFor(item.merchant) === cap.key;
  return item.category !== null && keyFor(item.category) === cap.key;
}

/**
 * The level a payment just pushed a cap into, or null when it did not change
 * anything worth saying. Breaking a cap again (already broken) still speaks —
 * each extra payment past the line is its own decision.
 */
export function capCrossing(cap: SpendCap, before: number, after: number): CapLevel | null {
  const was = capLevel(cap, before);
  const now = capLevel(cap, after);
  if (now === 'BROKEN') return 'BROKEN';
  if (now === 'NEAR' && was === 'OK') return 'NEAR';
  return null;
}

/** A sensible cap to suggest for a callout: the usual week, or a trim of this one. */
export function suggestedCap(callout: Callout): number {
  const base = callout.usualWeekly > 0 ? callout.usualWeekly : callout.total * 0.6;
  return Math.max(100, Math.round(base / 50) * 50);
}
