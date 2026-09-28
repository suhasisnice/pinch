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

export async function scheduleNotificationAsync(request?: {
  identifier?: string;
  trigger?: unknown;
}): Promise<string> {
  if (request?.identifier && request.trigger) __scheduled.set(request.identifier, request);
  return request?.identifier ?? 'mock-notification-id';
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
  return {
    remove: () => {
      registeredHandler = null;
    },
  };
}

/** Test-only: simulates the user tapping a notification or one of its buttons. */
export function __simulateNotificationResponse(data: unknown, actionIdentifier: string): void {
  registeredHandler?.({ notification: { request: { content: { data } } }, actionIdentifier });
}

type Response = Parameters<ResponseHandler>[0];
let lastResponse: Response | null = null;

export function getLastNotificationResponse(): Response | null {
  return lastResponse;
}

export function clearLastNotificationResponse(): void {
  lastResponse = null;
}

/** Test-only: the app was launched by pressing a button, before any listener existed. */
export function __simulateLaunchResponse(data: unknown, actionIdentifier: string): void {
  lastResponse = { notification: { request: { content: { data } } }, actionIdentifier };
}

export const SchedulableTriggerInputTypes = { DATE: 'date' };

/** Test-only record of what is scheduled for later, by identifier. */
export const __scheduled = new Map<string, unknown>();

export async function cancelScheduledNotificationAsync(identifier: string): Promise<void> {
  __scheduled.delete(identifier);
}
