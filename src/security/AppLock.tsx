import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, StyleSheet, Text, View } from 'react-native';
import { getAppLock } from '../settings/settingsStore';
import { palette, spacing, typography } from '../theme/theme';
import { Button } from '../components/ui';

/**
 * Pinch behind the phone's own lock — fingerprint, face or the device PIN,
 * whichever the user set up. Off by default; turned on from Settings.
 *
 * The app relocks after it has been in the background for a little while, so
 * handing someone an unlocked phone does not hand them your balances. A quick
 * trip to the share sheet or a bank app to copy a UPI ref does not relock.
 */

const RELOCK_AFTER_MS = 60_000;

export async function canUseAppLock(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const LocalAuthentication = require('expo-local-authentication');
    return (
      (await LocalAuthentication.hasHardwareAsync()) &&
      (await LocalAuthentication.isEnrolledAsync())
    );
  } catch {
    return false;
  }
}

export async function confirmIdentity(reason: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const LocalAuthentication = require('expo-local-authentication');
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      // The device PIN is a fine fallback: it is still the owner's secret.
      disableDeviceFallback: false,
    });
    return !!result.success;
  } catch {
    return false;
  }
}

export function LockGate({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState<boolean | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  const prompting = useRef(false);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      if (await confirmIdentity('Unlock Pinch')) setLocked(false);
    } finally {
      prompting.current = false;
    }
  }, []);

  useEffect(() => {
    getAppLock().then((on) => {
      setLocked(on);
      if (on) unlock();
    });
  }, [unlock]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next: AppStateStatus) => {
      if (next === 'background') {
        backgroundedAt.current = Date.now();
        return;
      }
      if (next !== 'active' || backgroundedAt.current === null) return;
      const away = Date.now() - backgroundedAt.current;
      backgroundedAt.current = null;
      if (away < RELOCK_AFTER_MS || !(await getAppLock())) return;
      setLocked(true);
      unlock();
    });
    return () => sub.remove();
  }, [unlock]);

  if (locked === null) return <View style={styles.cover} />;
  if (!locked) return <>{children}</>;
  return (
    <View style={styles.cover}>
      <Text style={styles.title}>Pinch is locked.</Text>
      <Text style={styles.body}>Your money, your fingerprint.</Text>
      <Button label="Unlock" variant="secondary" onPress={unlock} />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    flex: 1,
    backgroundColor: palette.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  title: { ...typography.screenTitle, color: palette.textPrimary },
  body: { ...typography.body, color: palette.textSecondary, marginBottom: spacing.md },
});
