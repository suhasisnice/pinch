import AsyncStorage from '@react-native-async-storage/async-storage';
import { CalibrationBaseline } from '../math/safeToSpend';

const ALLOWANCE_KEY = 'pinch.monthlyAllowance';
const CALIBRATION_KEY = 'pinch.calibrationBaseline';
export const DEFAULT_MONTHLY_ALLOWANCE = 5000;

export async function getMonthlyAllowance(): Promise<number> {
  const stored = await AsyncStorage.getItem(ALLOWANCE_KEY);
  if (stored === null) return DEFAULT_MONTHLY_ALLOWANCE;
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? parsed : DEFAULT_MONTHLY_ALLOWANCE;
}

export async function setMonthlyAllowance(amount: number): Promise<void> {
  await AsyncStorage.setItem(ALLOWANCE_KEY, String(amount));
}

/** Reads the active Mid-Month Calibration baseline, if the user has set one. */
export async function getCalibration(): Promise<CalibrationBaseline | null> {
  const stored = await AsyncStorage.getItem(CALIBRATION_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as CalibrationBaseline;
    if (
      typeof parsed.balance === 'number' &&
      typeof parsed.daysRemaining === 'number' &&
      typeof parsed.calibratedAt === 'string'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setCalibration(balance: number, daysRemaining: number): Promise<void> {
  const baseline: CalibrationBaseline = {
    balance,
    daysRemaining,
    calibratedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(CALIBRATION_KEY, JSON.stringify(baseline));
}

export async function clearCalibration(): Promise<void> {
  await AsyncStorage.removeItem(CALIBRATION_KEY);
}
