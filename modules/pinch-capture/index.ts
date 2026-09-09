import { EventEmitter, Subscription, requireOptionalNativeModule } from 'expo-modules-core';
import { PermissionsAndroid, Platform } from 'react-native';

export interface CapturedMessage {
  source: 'SMS' | 'NOTIFICATION';
  /** Phone number / sender ID for SMS, package name for a notification. */
  sender: string;
  body: string;
  /** Epoch milliseconds. */
  receivedAt: number;
}

export interface PhoneContact {
  name: string;
  phone: string | null;
}

interface PinchCaptureNative {
  hasSmsPermission(): boolean;
  requestSmsPermission(): Promise<boolean>;
  readRecentSms(limit: number): Promise<CapturedMessage[]>;
  hasContactsPermission(): boolean;
  readContacts(): Promise<PhoneContact[]>;
  isNotificationListenerEnabled(): boolean;
  openNotificationListenerSettings(): void;
  openAppSettings(): void;
  drainMessages(): Promise<CapturedMessage[]>;
  pendingCount(): number;
}

/**
 * requireOptionalNativeModule, not NativeModulesProxy.
 *
 * The legacy proxy wraps every native method in a Promise and stubs out
 * addListener, so `hasSmsPermission()` came back as a pending Promise (always
 * truthy — the UI reported "granted" for a permission that had never been
 * asked for) and no captured message ever reached JS. The JSI module returned
 * here supports genuinely synchronous functions and real events.
 */
const native = requireOptionalNativeModule<PinchCaptureNative>('PinchCapture');

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

/**
 * Asks for SMS access and resolves with the user's actual answer.
 *
 * React Native's PermissionsAndroid is used rather than the module's own
 * requestPermissions call because it delivers the dialog result back to JS;
 * the native path resolved immediately and left the caller guessing on a
 * timer.
 */
export async function requestSmsPermission(): Promise<boolean> {
  if (!isCaptureAvailable) return false;
  try {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
      PermissionsAndroid.PERMISSIONS.READ_SMS,
    ]);
    return (
      result[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] === 'granted' &&
      result[PermissionsAndroid.PERMISSIONS.READ_SMS] === 'granted'
    );
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

export function hasContactsPermission(): boolean {
  if (!isCaptureAvailable) return false;
  try {
    return native!.hasContactsPermission();
  } catch {
    return false;
  }
}

export async function requestContactsPermission(): Promise<boolean> {
  if (!isCaptureAvailable) return false;
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_CONTACTS
    );
    return result === 'granted';
  } catch {
    return false;
  }
}

/**
 * The phone's contacts, for picking who a bill is split with. Read on demand
 * and never copied wholesale — a contact only enters the database once the
 * user picks them.
 */
export async function readContacts(): Promise<PhoneContact[]> {
  if (!isCaptureAvailable) return [];
  try {
    return await native!.readContacts();
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
  try {
    return emitter.addListener<CapturedMessage>('onMessage', handler);
  } catch {
    return null;
  }
}
