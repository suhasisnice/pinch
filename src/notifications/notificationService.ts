import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as db from '../db/dbService';
import { PlannedNotification, DeliveryHistory, NotificationSettings } from './engine';
import { NotificationType } from './messages';
import { startOfDayIso } from '../utils/format';

const CHANNEL_ID = 'pinch-nudges';

/**
 * The action set on a notification for a transaction that just landed.
 * "Accept" needs no handling — the transaction already posted, so a plain
 * tap or an explicit accept are the same thing. "Decline" is the one that
 * matters: it excludes the transaction without ever having to open the
 * app, the same plain removal the transaction sheet's own Delete offers.
 */
export const TXN_DECISION_CATEGORY = 'txn-decision';
export const TXN_DECLINE_ACTION = 'DECLINE';
const TXN_ACCEPT_ACTION = 'ACCEPT';

let configured = false;

/**
 * Local notifications only — nothing about this app's nudges needs a server,
 * and keeping delivery on-device means spending data never leaves the phone.
 */
export async function configureNotifications(): Promise<void> {
  if (configured) return;
  configured = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Spending nudges',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 120],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      sound: null,
    });
  }

  // isDestructive is iOS-only and this app is Android-only, but the field
  // is harmless to omit — the button title alone already says enough.
  await Notifications.setNotificationCategoryAsync(TXN_DECISION_CATEGORY, [
    { identifier: TXN_ACCEPT_ACTION, buttonTitle: 'Looks right' },
    { identifier: TXN_DECLINE_ACTION, buttonTitle: 'Remove it' },
  ]);
}

export async function requestNotificationPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function hasNotificationPermission(): Promise<boolean> {
  return (await Notifications.getPermissionsAsync()).granted;
}

/**
 * Reconstructs today's delivery state from the notification log, so rate
 * limits survive the app being killed and restarted. Holding this in memory
 * only would let a restart reset every cap.
 */
export async function loadDeliveryHistory(now: Date = new Date()): Promise<DeliveryHistory> {
  const since = startOfDayIso(now);
  const types: NotificationType[] = [
    'TXN_PULSE',
    'SPLIT_PROMPT',
    'OVERSPEND',
    'GOAL_MILESTONE',
    'STREAK',
    'SETTLE_REMINDER',
    'DAY_RESET',
  ];

  const sentTodayByType: DeliveryHistory['sentTodayByType'] = {};
  const lastSentAt: DeliveryHistory['lastSentAt'] = {};
  const recentBodies: DeliveryHistory['recentBodies'] = {};

  await Promise.all(
    types.map(async (type) => {
      const [count, last, bodies] = await Promise.all([
        db.countSince(type, since),
        db.getLastOfType(type),
        db.getRecentBodies(type, 4),
      ]);
      sentTodayByType[type] = count;
      lastSentAt[type] = last?.created_at ?? null;
      recentBodies[type] = bodies;
    })
  );

  return {
    sentTodayByType,
    lastSentAt,
    recentBodies,
    totalSentToday: await db.countAllSince(since),
  };
}

/**
 * Delivers a planned notification and records it.
 *
 * The log write happens even if the OS refuses to present the notification, so
 * rate limiting stays accurate rather than retrying forever against a denied
 * permission.
 */
export async function deliver(
  planned: PlannedNotification,
  settings: NotificationSettings
): Promise<void> {
  if (!settings.enabled) return;

  await db.logNotification({
    type: planned.type,
    tier: planned.tier,
    title: planned.title,
    body: planned.body,
    payload: planned.payload,
    transactionId: (planned.payload?.transactionId as number | undefined) ?? null,
  });

  // Only a notification that names one specific transaction gets the
  // accept/decline buttons — TXN_PULSE and OVERSPEND are the two that fire
  // the moment a transaction lands, which is the only case "remove it"
  // means anything coherent.
  const isTxnDecision = planned.type === 'TXN_PULSE' || planned.type === 'OVERSPEND';

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: planned.title,
        body: planned.body,
        data: planned.payload ?? {},
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
        ...(isTxnDecision ? { categoryIdentifier: TXN_DECISION_CATEGORY } : {}),
      },
      trigger: null, // immediate
    });
  } catch {
    // Permission revoked or the channel is blocked. The log entry above still
    // records the attempt, and the in-app feed shows it regardless.
  }
}

export async function deliverAll(
  planned: PlannedNotification[],
  settings: NotificationSettings
): Promise<void> {
  for (const notification of planned) {
    await deliver(notification, settings);
  }
}

/**
 * `actionIdentifier` is Accept, Decline, or expo's own default identifier
 * for a plain tap on the notification body rather than either button —
 * callers that only care about an explicit Decline should check for that
 * exact value and ignore everything else.
 */
export function addNotificationResponseListener(
  handler: (payload: Record<string, unknown>, actionIdentifier: string) => void
) {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as Record<string, unknown>;
    handler(data ?? {}, response.actionIdentifier);
  });
}
