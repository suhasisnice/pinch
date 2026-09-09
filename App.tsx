import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initDatabase } from './src/db/dbService';
import RootNavigator from './src/navigation/RootNavigator';
import { configureNotifications } from './src/notifications/notificationService';
import { ingestBatch, ingestPending } from './src/services/captureService';
import { runFirstRunSetup } from './src/services/onboardingService';
import { revalidateIfRulesChanged } from './src/services/revalidationService';
import {
  addMessageListener,
  isCaptureAvailable,
  openNotificationListenerSettings,
} from './modules/pinch-capture';
import { Button } from './src/components/ui';
import { formatMoney } from './src/utils/format';
import { palette, spacing, typography } from './src/theme/theme';

type Status = { phase: 'LOADING' } | { phase: 'READY' } | { phase: 'ERROR'; message: string };

export default function App() {
  const [status, setStatus] = useState<Status>({ phase: 'LOADING' });
  const [attempt, setAttempt] = useState(0);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      setStatus({ phase: 'LOADING' });
      try {
        await initDatabase();
        await configureNotifications();
        if (!cancelled) setStatus({ phase: 'READY' });

        // Re-read imported history under the current parser rules before
        // anything shows a number. Tightening the parser fixes what happens
        // next; it does nothing about what is already stored, and the budget
        // is computed from what is stored. Runs once per rule-set version.
        revalidateIfRulesChanged()
          .then((result) => {
            if (cancelled || !result) return;
            Alert.alert(
              'Cleaned up your history',
              `${result.rejected.length} imported message${
                result.rejected.length === 1 ? '' : 's'
              } turned out not to be real transactions, and ${formatMoney(
                result.rejectedSpend
              )} of spending has been removed from your totals.

You can review or restore any of them in Settings.`
            );
          })
          .catch(() => undefined);

        // Pick up anything the native listeners buffered while the app was
        // closed. Never allowed to block startup.
        ingestPending().catch(() => undefined);

        // First launch asks for SMS, contacts and notifications and imports
        // recent texts, so the app has something in it before the user has
        // done anything. Deliberately after the UI is up: permission dialogs
        // on a blank loading screen have no context.
        runFirstRunSetup()
          .then((result) => {
            if (cancelled || !result.ran) return;
            if (isCaptureAvailable && result.sms && !result.listener) {
              Alert.alert(
                'One more thing',
                'UPI apps like GPay and PhonePe often never send an SMS. Give Pinch notification access and it catches those too.',
                [
                  { text: 'Later', style: 'cancel' },
                  { text: 'Open settings', onPress: openNotificationListenerSettings },
                ]
              );
            }
          })
          .catch(() => undefined);
      } catch (error) {
        // Previously this had no catch at all, so a failed database open left
        // the app on the loading text forever with nothing to act on.
        if (!cancelled) {
          setStatus({
            phase: 'ERROR',
            message: error instanceof Error ? error.message : 'Could not open the database.',
          });
        }
      }
    }

    start();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Live arrivals while the app is open.
  useEffect(() => {
    if (status.phase !== 'READY') return;
    const subscription = addMessageListener((message) => {
      ingestBatch([message]).catch(() => undefined);
    });
    return () => subscription?.remove();
  }, [status.phase]);

  // And a drain on every foreground, for whatever arrived while backgrounded.
  useEffect(() => {
    if (status.phase !== 'READY') return;
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        ingestPending().catch(() => undefined);
      }
      appState.current = next;
    });
    return () => subscription.remove();
  }, [status.phase]);

  if (status.phase === 'ERROR') {
    return (
      <View style={styles.center}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.errorEmoji}>😵</Text>
        <Text style={styles.errorTitle}>Pinch couldn't start</Text>
        <Text style={styles.errorBody}>{status.message}</Text>
        <View style={styles.errorAction}>
          <Button label="Try again" onPress={() => setAttempt((n) => n + 1)} />
        </View>
      </View>
    );
  }

  if (status.phase === 'LOADING') {
    return (
      <View style={styles.center}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.loadingMark}>pinch</Text>
        <Text style={styles.loadingText}>counting your money…</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={palette.background} />
      <RootNavigator />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: palette.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.xs,
  },
  loadingMark: { ...typography.hero, fontSize: 40, color: palette.neonGreen },
  loadingText: { ...typography.caption, color: palette.textSecondary },

  errorEmoji: { fontSize: 44, marginBottom: spacing.sm },
  errorTitle: { ...typography.display, color: palette.textPrimary },
  errorBody: {
    ...typography.body,
    color: palette.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  errorAction: { marginTop: spacing.lg, alignSelf: 'stretch' },
});
