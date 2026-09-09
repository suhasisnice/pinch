import {
  hasContactsPermission,
  hasSmsPermission,
  isCaptureAvailable,
  isNotificationListenerEnabled,
  requestContactsPermission,
  requestSmsPermission,
} from '../../modules/pinch-capture';
import { requestNotificationPermission } from '../notifications/notificationService';
import { hasOnboarded, setOnboarded } from '../settings/settingsStore';
import { backfillFromInbox } from './captureService';
import { IngestResult } from './captureService';

export interface FirstRunResult {
  ran: boolean;
  notifications: boolean;
  sms: boolean;
  contacts: boolean;
  /** Notification-listener access, which has no runtime dialog. */
  listener: boolean;
  backfill: IngestResult | null;
}

const EMPTY: IngestResult = { processed: 0, posted: 0, queuedForReview: 0, skipped: 0 };

/**
 * Asks for everything the app needs on first launch, then imports history.
 *
 * This used to live only behind buttons in Settings, which meant a fresh
 * install never asked for anything and sat there empty — the app looked like
 * it simply did not work. Permissions are requested one at a time and in
 * order of how much they explain themselves: notifications first (familiar),
 * then SMS (the thing that makes the app automatic), then contacts.
 *
 * Every step is optional. Declining any of them leaves a working app with
 * manual entry, and Settings can turn each one on later.
 */
export async function runFirstRunSetup(force = false): Promise<FirstRunResult> {
  if (!force && (await hasOnboarded())) {
    return { ran: false, notifications: false, sms: false, contacts: false, listener: false, backfill: null };
  }

  const notifications = await requestNotificationPermission().catch(() => false);

  if (!isCaptureAvailable) {
    // Expo Go or iOS: nothing more to ask for, and asking again on every
    // launch would be noise.
    await setOnboarded(true);
    return { ran: true, notifications, sms: false, contacts: false, listener: false, backfill: null };
  }

  const sms = hasSmsPermission() ? true : await requestSmsPermission();

  // Only worth importing when access was actually granted, and only once —
  // re-running it is harmless (dedup keys collapse repeats) but slow.
  let backfill: IngestResult | null = null;
  if (sms) {
    backfill = await backfillFromInbox(200).catch(() => EMPTY);
  }

  const contacts = hasContactsPermission() ? true : await requestContactsPermission();

  await setOnboarded(true);

  return {
    ran: true,
    notifications,
    sms,
    contacts,
    listener: isNotificationListenerEnabled(),
    backfill,
  };
}
