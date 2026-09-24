/**
 * Recovery missions (0.9.19, docs/INTERVENTIONS.md §1).
 *
 * The engine already absorbs an overspend: the pool shrinks and every later
 * day's limit drops a little. That is correct but invisible, and it never
 * ends. A mission makes the payback short, explicit and finishable: a few
 * days at a tighter number, after which the ordinary limit is back.
 *
 * Pure: dates are local calendar days as 'YYYY-MM-DD', spending comes in as
 * a lookup. Storage and notifications live in services/interventionService.
 */

export const MIN_MISSION_DAYS = 2;
export const MAX_MISSION_DAYS = 5;
/** A mission never asks for less than this share of an ordinary day. */
export const MIN_TARGET_SHARE = 0.6;

export interface Mission {
  /** First mission day — the day after the overspend. */
  startsOn: string;
  /** How far over the day that started it went. */
  overBy: number;
  /** The ordinary daily limit on the day it started. */
  normalLimit: number;
  /** The tighter daily number the mission asks for. */
  target: number;
  /** Days that must be held at or under the target. */
  daysNeeded: number;
  /** Calendar days available to do it in (a slipped day costs one of these). */
  slots: number;
}

export type MissionStatus = 'PENDING' | 'ACTIVE' | 'DONE' | 'FAILED';

export interface MissionProgress {
  status: MissionStatus;
  /** One entry per finished mission day, oldest first. */
  results: Array<'HELD' | 'SLIPPED'>;
  held: number;
  /** 1-based mission day that today is, while ACTIVE. */
  dayNumber: number | null;
  /** The last finished day, if any — what the screen reports as "yesterday". */
  lastResult: 'HELD' | 'SLIPPED' | null;
}

/**
 * Plans a mission for an overspend of `overBy` on a day whose limit was
 * `normalLimit`, with `daysAfter` days left in the period after that day.
 * Null when there is nothing to recover or no days left to do it in.
 */
export function planMission(input: {
  day: string;
  overBy: number;
  normalLimit: number;
  daysAfter: number;
}): Mission | null {
  const { overBy, normalLimit, daysAfter } = input;
  if (overBy < 1 || normalLimit <= 0 || daysAfter < 1) return null;

  const most = Math.min(MAX_MISSION_DAYS, daysAfter);
  let days = most;
  for (let n = Math.min(MIN_MISSION_DAYS, most); n <= most; n++) {
    if (normalLimit - overBy / n >= normalLimit * MIN_TARGET_SHARE) {
      days = n;
      break;
    }
  }
  const target = Math.max(0, normalLimit - overBy / days);
  return {
    startsOn: addDays(input.day, 1),
    overBy,
    normalLimit,
    target: Math.floor(target),
    daysNeeded: days,
    // One day of slack for a slip, when the period has room for it.
    slots: Math.min(MAX_MISSION_DAYS, daysAfter, days + 1),
  };
}

/** Where a mission stands on `today`, given each day's spending. */
export function missionProgress(
  mission: Mission,
  today: string,
  spentOn: (day: string) => number
): MissionProgress {
  if (today < mission.startsOn) {
    return { status: 'PENDING', results: [], held: 0, dayNumber: null, lastResult: null };
  }

  const results: Array<'HELD' | 'SLIPPED'> = [];
  let held = 0;
  for (let i = 0; i < mission.slots; i++) {
    const day = addDays(mission.startsOn, i);
    if (day >= today) break;
    const ok = spentOn(day) <= mission.target + 0.5;
    results.push(ok ? 'HELD' : 'SLIPPED');
    if (ok) held++;
    if (held >= mission.daysNeeded) break;
  }

  const lastResult = results.length > 0 ? results[results.length - 1] : null;
  if (held >= mission.daysNeeded) {
    return { status: 'DONE', results, held, dayNumber: null, lastResult };
  }
  const slotsLeft = mission.slots - results.length;
  if (slotsLeft < mission.daysNeeded - held || slotsLeft <= 0) {
    return { status: 'FAILED', results, held, dayNumber: null, lastResult };
  }
  return { status: 'ACTIVE', results, held, dayNumber: held + 1, lastResult };
}

/**
 * Today's overspend grows the pending mission rather than starting a second
 * one: the day is not over yet, so the mission is re-planned on the new total.
 */
export function shouldReplan(pending: Mission, overBy: number): boolean {
  return overBy > pending.overBy + 0.5;
}

/** 'YYYY-MM-DD' plus `n` calendar days, in local time. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d + n);
  return localDay(date);
}

export function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
