import React, { useCallback, useState } from 'react';
import { Alert, AppState, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as db from '../db/dbService';
import { TransactionRow } from '../db/types';
import {
  hasContactsPermission,
  hasSmsPermission,
  isCaptureAvailable,
  isNotificationListenerEnabled,
  openAppSettings,
  openNotificationListenerSettings,
  requestContactsPermission,
  requestSmsPermission,
} from '../../modules/pinch-capture';
import { backfillFromInbox } from '../services/captureService';
import {
  getMonthlyAllowance,
  getNotificationSettings,
  setMonthlyAllowance,
  setNotificationSettings,
} from '../settings/settingsStore';
import { NotificationSettings } from '../notifications/engine';
import { requestNotificationPermission } from '../notifications/notificationService';
import { formatMoney } from '../utils/format';
import { palette, spacing, typography } from '../theme/theme';
import { Button, Card, CardTitle, Field, Loading, Row, Screen, ScreenTitle } from '../components/ui';
import Icon from '../components/Icon';

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const [allowance, setAllowance] = useState('');
  const [periodDays, setPeriodDays] = useState('30');
  const [notifications, setNotifications] = useState<NotificationSettings | null>(null);
  const [smsGranted, setSmsGranted] = useState(false);
  const [contactsGranted, setContactsGranted] = useState(false);
  const [listenerEnabled, setListenerEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<Array<{ pattern: string; reason: string | null }>>([]);
  const [excluded, setExcluded] = useState<TransactionRow[]>([]);

  const refreshPermissions = useCallback(() => {
    setSmsGranted(hasSmsPermission());
    setContactsGranted(hasContactsPermission());
    setListenerEnabled(isNotificationListenerEnabled());
  }, []);

  const load = useCallback(async () => {
    const [amount, notificationSettings, period, blockRows, excludedRows] = await Promise.all([
      getMonthlyAllowance(),
      getNotificationSettings(),
      db.getCurrentBudgetPeriod(),
      db.getBlocklist(),
      db.getExcludedTransactions(),
    ]);
    setBlocked(blockRows);
    setExcluded(excludedRows);
    // Show the period actually in force, not the last thing typed into the box.
    setAllowance(String(period?.allowance ?? amount));
    setPeriodDays(String(period?.daysTotal ?? 30));
    setNotifications(notificationSettings);
    refreshPermissions();
  }, [refreshPermissions]);

  useFocusEffect(
    useCallback(() => {
      load();
      // Permissions are granted in system settings, outside the app, so
      // re-check whenever the user comes back rather than trusting a stale read.
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') refreshPermissions();
      });
      return () => subscription.remove();
    }, [load, refreshPermissions])
  );

  if (!notifications) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  async function saveAllowance() {
    const parsed = Number(allowance.replace(/[^\d.]/g, ''));
    const days = Number(periodDays.replace(/[^\d]/g, '')) || 30;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      // Silently doing nothing here was indistinguishable from a broken button.
      Alert.alert('Enter an allowance', 'How much do you have for this period?');
      return;
    }

    try {
      await setMonthlyAllowance(parsed);
      const period = await db.startBudgetPeriod({ allowance: parsed, days });
      Alert.alert(
        'Budget updated',
        `${formatMoney(parsed)} over ${days} days — about ${formatMoney(
          parsed / period.daysTotal
        )} a day.`
      );
    } catch (error) {
      Alert.alert(
        'Could not save',
        error instanceof Error ? error.message : 'Something went wrong saving the period.'
      );
    }
  }

  async function update(patch: Partial<NotificationSettings>) {
    const next = { ...notifications!, ...patch };
    setNotifications(next);
    await setNotificationSettings(next);
  }

  async function enableSms() {
    const granted = await requestSmsPermission();
    refreshPermissions();
    if (!granted) {
      Alert.alert(
        'SMS access needed',
        'Pinch reads bank texts on your phone to log spending automatically. You can turn it on under Permissions in app settings.'
      );
      return;
    }
    // Granting is the moment the backfill is wanted; making the user find a
    // second button for it left new installs looking empty and broken.
    await runBackfill();
  }

  async function enableContacts() {
    const granted = await requestContactsPermission();
    refreshPermissions();
    if (!granted) {
      Alert.alert(
        'Contacts access needed',
        'Only used to pick who a bill is split with, so nudges have a number to open.'
      );
    }
  }

  async function runBackfill() {
    setBusy(true);
    try {
      const result = await backfillFromInbox(150);
      Alert.alert(
        'Backfill complete',
        `${result.posted} added, ${result.queuedForReview} need review, ${result.skipped} skipped.`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScreenTitle title="Settings" />

      <Card>
        <CardTitle>Budget</CardTitle>
        <Field
          label="Allowance"
          value={allowance}
          onChangeText={setAllowance}
          keyboardType="numeric"
          placeholder="9000"
        />
        <Field
          label="Days it has to last"
          value={periodDays}
          onChangeText={setPeriodDays}
          keyboardType="numeric"
          placeholder="30"
          hint="Starts today. Set this when your allowance actually lands, not on the 1st."
        />
        <Button label="Start a new budget period" onPress={saveAllowance} style={{ marginTop: spacing.sm }} />
      </Card>

      <Card>
        <CardTitle>Automatic capture</CardTitle>
        {!isCaptureAvailable ? (
          <Text style={styles.note}>
            Capture needs the Android dev build — it isn't available here. Everything still works with
            manual entry.
          </Text>
        ) : (
          <>
            <Row
              title="Read bank SMS"
              subtitle={smsGranted ? 'Granted' : 'Not granted'}
              right={
                smsGranted ? (
                  <Text style={styles.ok}>On</Text>
                ) : (
                  <Button label="Allow" variant="secondary" onPress={enableSms} />
                )
              }
            />
            <Row
              title="Pick friends from contacts"
              subtitle={contactsGranted ? 'Granted' : 'For splitting bills and WhatsApp nudges'}
              right={
                contactsGranted ? (
                  <Text style={styles.ok}>On</Text>
                ) : (
                  <Button label="Allow" variant="secondary" onPress={enableContacts} />
                )
              }
            />
            <Row
              title="Read payment notifications"
              subtitle={listenerEnabled ? 'Granted' : 'Catches GPay, PhonePe, Paytm'}
              right={
                listenerEnabled ? (
                  <Text style={styles.ok}>On</Text>
                ) : (
                  <Button
                    label="Allow"
                    variant="secondary"
                    onPress={openNotificationListenerSettings}
                  />
                )
              }
            />
            {smsGranted ? (
              <Button
                label={busy ? 'Reading…' : 'Import recent SMS'}
                variant="secondary"
                onPress={runBackfill}
                disabled={busy}
                style={{ marginTop: spacing.sm }}
              />
            ) : null}
            <Text style={styles.note}>
              Messages are parsed on your phone and never leave it. Anything Pinch isn't sure about
              waits for you in Review instead of being logged.
            </Text>
          </>
        )}
      </Card>

      {blocked.length > 0 || excluded.length > 0 ? (
        <Card>
          <CardTitle>Ignored</CardTitle>
          <Text style={styles.note}>
            Blocking is never permanent — undo anything here and it starts counting again.
          </Text>

          {blocked.length > 0 ? (
            <>
              <Text style={styles.groupLabel}>Blocked senders</Text>
              {blocked.map((entry) => (
                <Row
                  key={entry.pattern}
                  left={<Icon name="lock" size={15} color={palette.textMuted} />}
                  title={entry.pattern}
                  subtitle={entry.reason ?? 'Blocked'}
                  right={
                    <Text
                      style={styles.undo}
                      onPress={async () => {
                        await db.removeFromBlocklist(entry.pattern);
                        load();
                      }}
                    >
                      Unblock
                    </Text>
                  }
                />
              ))}
            </>
          ) : null}

          {excluded.length > 0 ? (
            <>
              <Text style={styles.groupLabel}>Not counted as spending</Text>
              {excluded.slice(0, 12).map((tx) => (
                <Row
                  key={tx.id}
                  left={<Icon name="close" size={15} color={palette.textMuted} />}
                  title={tx.merchant}
                  subtitle={`${formatMoney(tx.amount)} · ${tx.source.toLowerCase()}`}
                  right={
                    <Text
                      style={styles.undo}
                      onPress={async () => {
                        await db.setTransactionExcluded(tx.id, false);
                        load();
                      }}
                    >
                      Restore
                    </Text>
                  }
                />
              ))}
              {excluded.length > 12 ? (
                <Text style={styles.note}>
                  and {excluded.length - 12} more.
                </Text>
              ) : null}
            </>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <CardTitle>Nudges</CardTitle>
        <Toggle
          label="All notifications"
          value={notifications.enabled}
          onChange={async (value) => {
            if (value) await requestNotificationPermission();
            update({ enabled: value });
          }}
        />
        <Toggle
          label="Per-transaction pulse"
          hint="A quick read on today's limit after each spend"
          value={notifications.pulseEnabled}
          onChange={(value) => update({ pulseEnabled: value })}
        />
        <Toggle
          label="Split prompts"
          hint="Asks if a big social spend should be split"
          value={notifications.splitPromptsEnabled}
          onChange={(value) => update({ splitPromptsEnabled: value })}
        />
        <Toggle
          label="Overspend warnings"
          value={notifications.overspendEnabled}
          onChange={(value) => update({ overspendEnabled: value })}
        />
        <Toggle
          label="Goal milestones"
          value={notifications.goalsEnabled}
          onChange={(value) => update({ goalsEnabled: value })}
        />
        <Toggle
          label="Streaks"
          value={notifications.streaksEnabled}
          onChange={(value) => update({ streaksEnabled: value })}
        />
        <Toggle
          label="Settle-up reminders"
          value={notifications.settleRemindersEnabled}
          onChange={(value) => update({ settleRemindersEnabled: value })}
        />
        <Text style={styles.note}>
          Quiet from {notifications.quietStartHour}:00 to {notifications.quietEndHour}:00, and never
          more than {notifications.maxPerDay} a day.
        </Text>
      </Card>

      <Card onPress={() => navigation.navigate('Review')}>
        <CardTitle>Review inbox ›</CardTitle>
        <Text style={styles.note}>Messages Pinch wasn't confident enough to log on its own.</Text>
      </Card>

      {isCaptureAvailable ? (
        <Button label="Open app settings" variant="ghost" onPress={openAppSettings} />
      ) : null}
    </Screen>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.toggleHint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: palette.surfaceHigh, true: palette.neonGreen }}
        thumbColor={palette.textPrimary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  note: { ...typography.caption, color: palette.textMuted, lineHeight: 18, marginTop: spacing.sm },
  ok: { ...typography.bodyBold, color: palette.neonGreen },
  undo: { ...typography.caption, color: palette.neonGreen, fontWeight: '700' },
  groupLabel: {
    ...typography.micro,
    color: palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.md,
    marginBottom: 2,
  },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    gap: spacing.md,
  },
  toggleText: { flex: 1 },
  toggleLabel: { ...typography.body, color: palette.textPrimary },
  toggleHint: { ...typography.micro, color: palette.textMuted, marginTop: 2 },
});
