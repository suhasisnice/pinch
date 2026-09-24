import React, { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  getTransactionById,
  initDatabase,
  rejectCapture,
  setTransactionCategory,
  setTransactionExcluded,
} from './src/db/dbService';
import RootNavigator from './src/navigation/RootNavigator';
import {
  addNotificationResponseListener,
  configureNotifications,
  TXN_DECLINE_ACTION,
  TXN_CONFIRM_ACTION,
  TXN_REJECT_ACTION,
  CATEGORY_ACTION_PREFIX,
} from './src/notifications/notificationService';
import { acceptCapture, ingestBatch, ingestPending } from './src/services/captureService';
import { learnFromCategoryCorrection } from './src/services/classificationService';
import { runFirstRunSetup } from './src/services/onboardingService';
import { revalidateIfRulesChanged } from './src/services/revalidationService';
import {
  addMessageListener,
  isCaptureAvailable,
  openNotificationListenerSettings,
} from './modules/pinch-capture';
import { Button } from './src/components/ui';
import { DialogHost, showDialog, showMessage } from './src/components/Dialog';
import { formatMoney } from './src/utils/format';
import { palette, spacing, typography } from './src/theme/theme';
import Icon from './src/components/Icon';
import { LockGate } from './src/security/AppLock';

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
            const lines: string[] = [];
            if (result.rejected.length > 0) {
              lines.push(
                `${result.rejected.length} imported message${
                  result.rejected.length === 1 ? '' : 's'
                } turned out not to be real transactions — ${formatMoney(
                  result.rejectedSpend
                )} removed from your spending.`
              );
            }
            if (result.transfersFound > 0) {
              lines.push(
                `${result.transfersFound} transfer${
                  result.transfersFound === 1 ? '' : 's'
                } between your own accounts ${
                  result.transfersFound === 1 ? 'was' : 'were'
                } no longer counted as spending — ${formatMoney(result.transferSpend)}.`
              );
            }
            if (result.reclassified > 0) {
              lines.push(
                `${result.reclassified} payment${
                  result.reclassified === 1 ? '' : 's'
                } turned out to be moving money rather than spending it — wallet top-ups, card bills — worth ${formatMoney(
                  result.reclassifiedSpend
                )}.`
              );
            }
            if (result.directionsCorrected > 0) {
              lines.push(
                `${result.directionsCorrected} payment${
                  result.directionsCorrected === 1 ? ' was' : 's were'
                } recorded going the wrong way — money you received counted as money you spent. Turned back round.`
              );
            }
            if (result.categorised > 0) {
              lines.push(
                `${result.categorised} older transaction${
                  result.categorised === 1 ? '' : 's'
                } finally got a category, so Insights has something to work with.${
                  result.merchantsUnrecognised > 0
                    ? ` ${result.merchantsUnrecognised} merchant${
                        result.merchantsUnrecognised === 1 ? '' : 's'
                      } still unrecognised — set one by hand and it learns the rest.`
                    : ''
                }`
              );
            }
            if (result.settled > 0) {
              lines.push(
                `${result.settled} payment${
                  result.settled === 1 ? '' : 's'
                } turned out to be someone paying back what they owed, not new income — worth ${formatMoney(
                  result.settledAmount
                )}.`
              );
            }
            lines.push('Anything here can be restored in Settings.');

            void showMessage(
              'Cleaned up your history',
              undefined,
              lines.map((line) => ({ label: line }))
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
              void showDialog({
                title: 'One more thing',
                message:
                  'UPI apps like GPay and PhonePe often never send an SMS. Give Pinch notification access and it catches those too.',
                actions: [
                  { label: 'Later', value: 'later', variant: 'ghost' },
                  { label: 'Open settings', value: 'open' },
                ],
                dismissValue: 'later',
              }).then((choice) => {
                if (choice === 'open') openNotificationListenerSettings();
              });
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

  // Answering a notification without opening the app.
  //
  // Three kinds arrive here. "Remove it" excludes a transaction that already
  // posted. Confirm/reject decides a captured payment that is being held
  // *before* it counts — ignoring it is also an answer, and leaves it in
  // Review. A category action sets the category on a logged transaction.
  //
  // A plain tap on any of them needs no handling: it opens the app, where
  // the same decision is available with the evidence on screen.
  useEffect(() => {
    if (status.phase !== 'READY') return;
    const subscription = addNotificationResponseListener((payload, actionIdentifier) => {
      const transactionId = payload.transactionId as number | undefined;
      const captureId = payload.captureId as number | undefined;

      if (actionIdentifier === TXN_DECLINE_ACTION && transactionId !== undefined) {
        setTransactionExcluded(transactionId, true).catch(() => undefined);
        return;
      }

      if (actionIdentifier === TXN_CONFIRM_ACTION && captureId !== undefined) {
        acceptCapture(captureId).catch(() => undefined);
        return;
      }

      if (actionIdentifier === TXN_REJECT_ACTION && captureId !== undefined) {
        rejectCapture(captureId).catch(() => undefined);
        return;
      }

      if (actionIdentifier?.startsWith(CATEGORY_ACTION_PREFIX) && transactionId !== undefined) {
        const category = actionIdentifier.slice(CATEGORY_ACTION_PREFIX.length);
        // Learned as well as applied, so the next payment to the same place
        // does not have to be asked about again.
        setTransactionCategory(transactionId, category)
          .then(() => getTransactionById(transactionId))
          .then((row) => (row ? learnFromCategoryCorrection(row.merchant, category) : undefined))
          .catch(() => undefined);
      }
    });
    return () => subscription.remove();
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
        <View style={styles.errorIcon}>
          <Icon name="warning" size={28} color={palette.onDanger} />
        </View>
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
      <LockGate>
        <RootNavigator />
      </LockGate>
      {/* Mounted last so dialogs sit above everything, including sheets. */}
      <DialogHost />
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
  loadingMark: { ...typography.hero, fontSize: 40, color: palette.accent },
  loadingText: { ...typography.caption, color: palette.textSecondary },

  errorIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.dangerMuted,
    marginBottom: spacing.sm,
  },
  errorTitle: { ...typography.display, color: palette.textPrimary },
  errorBody: {
    ...typography.body,
    color: palette.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  errorAction: { marginTop: spacing.lg, alignSelf: 'stretch' },
});
