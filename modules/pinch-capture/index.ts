import { NativeModulesProxy, EventEmitter, Subscription } from 'expo-modules-core';
import { Platform } from 'react-native';

export interface CapturedMessage {
  source: 'SMS' | 'NOTIFICATION';
  /** Phone number / sender ID for SMS, package name for a notification. */
  sender: string;
  body: string;
  /** Epoch milliseconds. */
  receivedAt: number;
}

interface PinchCaptureNative {
  hasSmsPermission(): boolean;
  requestSmsPermission(): Promise<boolean>;
  readRecentSms(limit: number): Promise<CapturedMessage[]>;
  isNotificationListenerEnabled(): boolean;
  openNotificationListenerSettings(): void;
  openAppSettings(): void;
  drainMessages(): Promise<CapturedMessage[]>;
  pendingCount(): number;
}

const native: PinchCaptureNative | undefined = NativeModulesProxy.PinchCapture as
  | PinchCaptureNative
  | undefined;

/**
 * True when the native capture module is present. It is Android-only, and
 * absent entirely in Expo Go or on iOS, so every call below degrades to a
 * no-op rather than throwing — the app stays fully usable with manual entry.
 */
export const isCaptureAvailable = Platform.OS === 'android' && native != null;

const emitter = native ? new EventEmitter(native as never) : null;

export function hasSmsPermission(): boolean {
  if (!isCaptureAvailable) return false;
  try {
    return native!.hasSmsPermission();
  } catch {
    return false;
  }
}

export async function requestSmsPermission(): Promise<boolean> {
  if (!isCaptureAvailable) return false;
  try {
    return await native!.requestSmsPermission();
  } catch {
    return false;
  }
}

/** One-time backfill so enabling capture does not start from nothing. */
export async function readRecentSms(limit = 100): Promise<CapturedMessage[]> {
  if (!isCaptureAvailable) return [];
  try {
    return await native!.readRecentSms(limit);
  } catch {
    return [];
  }
}

export function isNotificationListenerEnabled(): boolean {
  if (!isCaptureAvailable) return false;
  try {
    return native!.isNotificationListenerEnabled();
  } catch {
    return false;
  }
}

export function openNotificationListenerSettings(): void {
  if (!isCaptureAvailable) return;
  try {
    native!.openNotificationListenerSettings();
  } catch {
    // Settings screen unavailable on this device; nothing useful to do.
  }
}

export function openAppSettings(): void {
  if (!isCaptureAvailable) return;
  try {
    native!.openAppSettings();
  } catch {
    // Ignored for the same reason as above.
  }
}

/**
 * Collects everything buffered natively while JS was not running, clearing the
 * buffer as it goes. Call on every foreground.
 */
export async function drainMessages(): Promise<CapturedMessage[]> {
  if (!isCaptureAvailable) return [];
  try {
    return await native!.drainMessages();
  } catch {
    return [];
  }
}

export function pendingCount(): number {
  if (!isCaptureAvailable) return 0;
  try {
    return native!.pendingCount();
  } catch {
    return 0;
  }
}

/** Live arrivals while the app is in the foreground. */
export function addMessageListener(
  handler: (message: CapturedMessage) => void
): Subscription | null {
  if (!emitter) return null;
  return emitter.addListener<CapturedMessage>('onMessage', handler);
}
