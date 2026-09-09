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
