/**
 * Test double for expo-notifications.
 *
 * Like modules/pinch-capture/__mocks__/index.ts, this exists because the
 * real package ships ESM-only JS that Jest's transform never sees inside
 * node_modules — anything that imports it fails to parse, whether or not a
 * test ever reaches a notification call. Wired in via jest.config.js's
 * moduleNameMapper. Every call resolves to the same "nothing is scheduled,
 * nothing is granted" shape a real device would report before the user has
 * ever interacted with a permission prompt.
 */
export const AndroidImportance = { DEFAULT: 3 };
export const AndroidNotificationVisibility = { PRIVATE: 0 };

export function setNotificationHandler(): void {}

export async function setNotificationChannelAsync(): Promise<null> {
  return null;
}

export async function getPermissionsAsync(): Promise<{ granted: boolean }> {
  return { granted: false };
}

export async function requestPermissionsAsync(): Promise<{ granted: boolean }> {
  return { granted: false };
}

export async function scheduleNotificationAsync(): Promise<string> {
  return 'mock-notification-id';
}

export function addNotificationResponseReceivedListener(): { remove: () => void } {
  return { remove: () => {} };
}
