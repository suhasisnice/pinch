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

export async function setNotificationCategoryAsync(): Promise<null> {
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

type ResponseHandler = (response: {
  notification: { request: { content: { data: unknown } } };
  actionIdentifier: string;
}) => void;

let registeredHandler: ResponseHandler | null = null;

export function addNotificationResponseReceivedListener(handler: ResponseHandler): {
  remove: () => void;
} {
  registeredHandler = handler;
  return { remove: () => {
    registeredHandler = null;
  } };
}

/** Test-only: simulates the user tapping a notification or one of its buttons. */
export function __simulateNotificationResponse(data: unknown, actionIdentifier: string): void {
  registeredHandler?.({ notification: { request: { content: { data } } }, actionIdentifier });
}
