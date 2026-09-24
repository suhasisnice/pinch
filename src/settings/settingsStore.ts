import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_NOTIFICATION_SETTINGS, NotificationSettings } from '../notifications/engine';

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
