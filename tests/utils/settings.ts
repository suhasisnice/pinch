import { DEFAULT_NOTIFICATION_SETTINGS } from '../../src/notifications/engine';
import { setNotificationSettings } from '../../src/settings/settingsStore';

/**
 * Turns the confirm-before-logging gate off for a suite.
 *
 * Most suites here are about ledger mechanics — dedup, transfer pairing,
 * settlement, categorisation — and were written against a pipeline that
 * posted a confident parse straight away. The gate is a product decision
 * layered on top of that and would turn every one of those into a pending
 * capture, testing the gate over and over instead of the thing each suite
 * is actually about.
 *
 * Called explicitly rather than defaulted globally, so a suite that depends
 * on auto-posting says so out loud instead of inheriting it silently.
 */
export async function disableConfirmGate(): Promise<void> {
  await setNotificationSettings({
    ...DEFAULT_NOTIFICATION_SETTINGS,
    confirmBeforeLogging: false,
  });
}

/** The gate on, for the tests that are about the gate itself. */
export async function enableConfirmGate(): Promise<void> {
  await setNotificationSettings({
    ...DEFAULT_NOTIFICATION_SETTINGS,
    confirmBeforeLogging: true,
  });
}
