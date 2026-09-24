/**
 * Moments: the few changes worth a small beat (0.9.18). Pure comparisons of a
 * screen's previous numbers against its new ones, so a moment fires on the
 * change itself — never on a cold open that merely finds a goal already done.
 */

export interface GoalLevel {
  id: number;
  name: string;
  saved: number;
  target: number;
}

/** Goals that were short of their target before and have reached it now. */
export function goalsJustReached(previous: GoalLevel[] | null, next: GoalLevel[]): GoalLevel[] {
  if (!previous) return [];
  const before = new Map(previous.map((g) => [g.id, g]));
  return next.filter((g) => {
    const was = before.get(g.id);
    return was !== undefined && g.target > 0 && was.saved < was.target && g.saved >= g.target;
  });
}

/** True only on the load where the payday list goes from unfinished to done. */
export function paydayJustDone(previous: boolean | null, next: boolean): boolean {
  return previous === false && next;
}

/** Milestone keys present now that were not there before. */
export function milestonesJustReached(previous: string[] | null, next: string[]): string[] {
  if (!previous) return [];
  const before = new Set(previous);
  return next.filter((key) => !before.has(key));
}
