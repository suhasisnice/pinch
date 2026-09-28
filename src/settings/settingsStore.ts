import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_NOTIFICATION_SETTINGS, NotificationSettings } from '../notifications/engine';
import type { PayPlan } from '../math/payday';
import type { Mission } from '../math/recovery';

const ALLOWANCE_KEY = 'pinch.monthlyAllowance';
const NOTIFICATION_KEY = 'pinch.notificationSettings';
const ONBOARDED_KEY = 'pinch.onboarded';
const ROUNDUP_KEY = 'pinch.roundUpGoalId';

export const DEFAULT_MONTHLY_ALLOWANCE = 5000;

export async function getMonthlyAllowance(): Promise<number> {
  const stored = await AsyncStorage.getItem(ALLOWANCE_KEY);
  if (stored === null) return DEFAULT_MONTHLY_ALLOWANCE;
  const parsed = Number(stored);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MONTHLY_ALLOWANCE;
}

export async function setMonthlyAllowance(amount: number): Promise<void> {
  await AsyncStorage.setItem(ALLOWANCE_KEY, String(amount));
}

/**
 * Notification preferences, merged over the defaults so a settings object
 * written by an older build never arrives missing a field that newer code
 * reads.
 */
export async function getNotificationSettings(): Promise<NotificationSettings> {
  const stored = await AsyncStorage.getItem(NOTIFICATION_KEY);
  if (!stored) return DEFAULT_NOTIFICATION_SETTINGS;
  try {
    const parsed = JSON.parse(stored) as Partial<NotificationSettings>;
    return { ...DEFAULT_NOTIFICATION_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

export async function setNotificationSettings(settings: NotificationSettings): Promise<void> {
  await AsyncStorage.setItem(NOTIFICATION_KEY, JSON.stringify(settings));
}

export async function hasOnboarded(): Promise<boolean> {
  return (await AsyncStorage.getItem(ONBOARDED_KEY)) === 'true';
}

export async function setOnboarded(value: boolean): Promise<void> {
  await AsyncStorage.setItem(ONBOARDED_KEY, String(value));
}

const AGE_KEY = 'pinch.ageConfirmed';

/**
 * Whether the person using the app said they are 18 or over (0.9.22).
 *
 * DPDP asks for a parent's verifiable consent before a minor's data is
 * handled, and Pinch cannot verify anything. So it asks once, before any
 * permission prompt or import, and an under-18 answer is never stored:
 * the question simply comes back next launch. "Erase everything" leaves it
 * alone, the same as the onboarding flag. The phone's owner has not changed.
 */
export async function hasConfirmedAge(): Promise<boolean> {
  return (await AsyncStorage.getItem(AGE_KEY)) === 'true';
}

export async function setAgeConfirmed(): Promise<void> {
  await AsyncStorage.setItem(AGE_KEY, 'true');
}

const DISMISSED_GAP_KEY = 'pinch.dismissedDiscrepancy';

/**
 * The unaccounted-balance gap the user has already said to leave alone.
 *
 * Stored as an amount rather than a flag so the reminder comes back when
 * the gap actually changes — dismissing "₹300 unaccounted" should not also
 * silence "₹4,000 unaccounted" next week, which is a different and much
 * more worrying fact.
 */
export async function getDismissedDiscrepancy(): Promise<number | null> {
  const stored = await AsyncStorage.getItem(DISMISSED_GAP_KEY);
  if (stored === null) return null;
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function setDismissedDiscrepancy(amount: number | null): Promise<void> {
  if (amount === null) {
    await AsyncStorage.removeItem(DISMISSED_GAP_KEY);
    return;
  }
  await AsyncStorage.setItem(DISMISSED_GAP_KEY, String(Math.round(amount)));
}

/** Goal that spare change from round-ups flows into, if the user picked one. */
export async function getRoundUpGoalId(): Promise<number | null> {
  const stored = await AsyncStorage.getItem(ROUNDUP_KEY);
  if (!stored) return null;
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function setRoundUpGoalId(goalId: number | null): Promise<void> {
  if (goalId === null) {
    await AsyncStorage.removeItem(ROUNDUP_KEY);
    return;
  }
  await AsyncStorage.setItem(ROUNDUP_KEY, String(goalId));
}

const CUSHION_KEY = 'pinch.cushionGoalId';
const RETURN_RATE_KEY = 'pinch.wealthReturnRate';

/** The goal that is the emergency cushion — rung one of the wealth ladder. */
export async function getCushionGoalId(): Promise<number | null> {
  const stored = await AsyncStorage.getItem(CUSHION_KEY);
  if (!stored) return null;
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function setCushionGoalId(goalId: number | null): Promise<void> {
  if (goalId === null) {
    await AsyncStorage.removeItem(CUSHION_KEY);
    return;
  }
  await AsyncStorage.setItem(CUSHION_KEY, String(goalId));
}

/** The annual growth rate the projection assumes, as a fraction (0.1 = 10%). */
export async function getReturnRate(fallback: number): Promise<number> {
  const stored = await AsyncStorage.getItem(RETURN_RATE_KEY);
  const parsed = stored === null ? NaN : Number(stored);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 0.3 ? parsed : fallback;
}

export async function setReturnRate(rate: number): Promise<void> {
  await AsyncStorage.setItem(RETURN_RATE_KEY, String(rate));
}

const PAY_PLAN_KEY = 'pinch.payPlan';

/** The pay-yourself-first split (see math/payday.ts). */
export async function getPayPlan(fallback: PayPlan): Promise<PayPlan> {
  const stored = await AsyncStorage.getItem(PAY_PLAN_KEY);
  if (!stored) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(stored) as Partial<PayPlan>) };
  } catch {
    return fallback;
  }
}

export async function setPayPlan(plan: PayPlan): Promise<void> {
  await AsyncStorage.setItem(PAY_PLAN_KEY, JSON.stringify(plan));
}

const RECOVERY_KEY = 'pinch.recovery';

/** The one recovery mission, if any (see math/recovery.ts). */
export async function getRecoveryMission(): Promise<Mission | null> {
  const stored = await AsyncStorage.getItem(RECOVERY_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as Mission;
  } catch {
    return null;
  }
}

export async function setRecoveryMission(mission: Mission | null): Promise<void> {
  if (mission) await AsyncStorage.setItem(RECOVERY_KEY, JSON.stringify(mission));
  else await AsyncStorage.removeItem(RECOVERY_KEY);
}

const INTERVENTION_LOG_KEY = 'pinch.interventionLog';

/**
 * Which one-off interventions have already been said, so a callout or a
 * mission's start is announced once rather than on every payment. Keys are
 * free-form ("callout:2026-W39:swiggy"); old ones are dropped after 60.
 */
export async function getInterventionLog(): Promise<string[]> {
  const stored = await AsyncStorage.getItem(INTERVENTION_LOG_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function addInterventionLog(key: string): Promise<void> {
  const log = await getInterventionLog();
  if (log.includes(key)) return;
  await AsyncStorage.setItem(INTERVENTION_LOG_KEY, JSON.stringify([...log, key].slice(-60)));
}

const APP_LOCK_KEY = 'pinch.appLock';

/** Whether opening Pinch asks for the phone's fingerprint, face or PIN. */
export async function getAppLock(): Promise<boolean> {
  return (await AsyncStorage.getItem(APP_LOCK_KEY)) === 'on';
}

export async function setAppLock(on: boolean): Promise<void> {
  await AsyncStorage.setItem(APP_LOCK_KEY, on ? 'on' : 'off');
}

/**
 * "Erase everything": forgets what Pinch knows about the person — their
 * split, goal pointers and dismissed notes. The allowance, notification
 * preferences and the app lock are how the app is set up, not personal
 * data, and are kept so the fresh start still works the way they like.
 */
export async function clearPersonalSettings(): Promise<void> {
  await AsyncStorage.multiRemove([
    RECOVERY_KEY,
    INTERVENTION_LOG_KEY,
    ROUNDUP_KEY,
    DISMISSED_GAP_KEY,
    CUSHION_KEY,
    RETURN_RATE_KEY,
    PAY_PLAN_KEY,
  ]);
}
