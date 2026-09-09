/**
 * Test double for the native capture module.
 *
 * The real module (../index.ts) imports expo-modules-core, which ships
 * ESM-only JS that Jest's default transform does not touch inside
 * node_modules — anything that imports the real module at all fails to
 * parse under Jest, whether or not it ever calls a native function. Wired
 * in globally via jest.config.js's moduleNameMapper, so any test that pulls
 * in a service sitting on top of this (captureService, onboardingService)
 * gets this instead without needing its own jest.mock() call.
 *
 * Behaviour mirrors the real module's own "not on Android" degradation —
 * every permission is unset and every capture call returns empty — which is
 * also the correct behaviour for a test run, since nothing here should ever
 * claim a permission it was never granted.
 */
// Type-only: must never pull in the real module's runtime code, which is
// exactly what this file exists to avoid loading under Jest.
import type { CapturedMessage, PhoneContact } from '../index';

export type { CapturedMessage, PhoneContact };

export const isCaptureAvailable = false;

export function hasSmsPermission(): boolean {
  return false;
}

export async function requestSmsPermission(): Promise<boolean> {
  return false;
}

export async function readRecentSms(): Promise<CapturedMessage[]> {
  return [];
}

export function hasContactsPermission(): boolean {
  return false;
}

export async function requestContactsPermission(): Promise<boolean> {
  return false;
}

export async function readContacts(): Promise<PhoneContact[]> {
  return [];
}

export function isNotificationListenerEnabled(): boolean {
  return false;
}

export function openNotificationListenerSettings(): void {}

export function openAppSettings(): void {}

export async function drainMessages(): Promise<CapturedMessage[]> {
  return [];
}

export function pendingCount(): number {
  return 0;
}

export function addMessageListener(): null {
  return null;
}
