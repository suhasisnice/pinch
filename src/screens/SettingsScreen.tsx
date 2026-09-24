import React, { useCallback, useState } from 'react';
import { showConfirm, showMessage } from '../components/Dialog';
import { AppState, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
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
import { backfillFromInbox, reprocessUnresolvedRawEvents } from '../services/captureService';
import { countUnresolvedRawEvents, getRejectionBreakdown } from '../db/dbService';
import { PARSER_RULES_VERSION } from '../services/revalidationService';
import { revalidateHistory } from '../services/revalidationService';
import {
  clearPersonalSettings,
  getAppLock,
  getMonthlyAllowance,
  getNotificationSettings,
  setAppLock,
  setMonthlyAllowance,
  setNotificationSettings,
} from '../settings/settingsStore';
import { NotificationSettings } from '../notifications/engine';
import { requestNotificationPermission } from '../notifications/notificationService';
import { formatMoney } from '../utils/format';
import { palette, spacing, typography } from '../theme/theme';
import { Button, Field, Group, Loading, Row, Screen, ScreenTitle } from '../components/ui';
import Icon from '../components/Icon';
import FreshStartSheet from '../components/FreshStartSheet';
import BackupSheet from '../components/BackupSheet';
import { canUseAppLock, confirmIdentity } from '../security/AppLock';
import appConfig from '../../app.json';

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
  const [counts, setCounts] = useState<Awaited<ReturnType<typeof db.countData>> | null>(null);
  // Set the moment either budget field is touched, and cleared only by a
  // successful save. Without it, load() runs on every focus and overwrites
  // whatever is half-typed with the value already stored — so a new figure
  // was reverted before the save button could read it, and every save wrote
  // the old number back. That is what "the budget is stuck" looked like.
  const [budgetEdited, setBudgetEdited] = useState(false);
  const [freshVisible, setFreshVisible] = useState(false);
  const [lockOn, setLockOn] = useState(false);
  const [lockAvailable, setLockAvailable] = useState(false);
  const [backupMode, setBackupMode] = useState<'SAVE' | 'RESTORE' | null>(null);

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
    setLockOn(await getAppLock());
    setLockAvailable(await canUseAppLock());
    setExcluded(excludedRows);
    setCounts(await db.countData());
    if (!budgetEdited) {
      setAllowance(String(period?.allowance ?? amount));
      setPeriodDays(String(period?.daysTotal ?? 30));
    }
    setNotifications(notificationSettings);
    refreshPermissions();
  }, [refreshPermissions, budgetEdited]);

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
      <Screen underHeader scroll={false}>
        <Loading />
      </Screen>
    );
  }

  async function saveAllowance() {
    const parsed = Number(allowance.replace(/[^\d.]/g, ''));
    const days = Number(periodDays.replace(/[^\d]/g, '')) || 30;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      // Silently doing nothing here was indistinguishable from a broken button.
      void showMessage('Enter an allowance', 'How much do you have for this period?');
      return;
    }

    try {
      await setMonthlyAllowance(parsed);
      const period = await db.startBudgetPeriod({ allowance: parsed, days });
      setBudgetEdited(false);
      await showMessage(
        'Budget updated',
        `${formatMoney(parsed)} over ${days} days — about ${formatMoney(
          parsed / period.daysTotal
        )} a day.`
      );
    } catch (error) {
      await showMessage(
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
      await showMessage(
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
      await showMessage(
        'Contacts access needed',
        'Only used to pick who a bill is split with, so nudges have a number to open.'
      );
    }
  }

  /**
   * Clears the ledger and starts a period from today.
   *
   * Goals, friends and blocked senders survive: the reason to reach for this
   * is almost always an import that poisoned the numbers, and throwing away
   * the rest would punish the user for the parser's mistake. "Erase
   * everything" is offered separately for the case where that is genuinely
   * what is wanted.
   */
  async function startFresh(everything: boolean) {
    setBusy(true);
    try {
      await db.resetData({
        ledger: true,
        periods: true,
        contacts: everything,
        goals: everything,
        outings: everything,
        blocklist: everything,
        personal: everything,
      });
      if (everything) await clearPersonalSettings();

      const parsed = Number(allowance.replace(/[^\d.]/g, ''));
      const days = Number(periodDays.replace(/[^\d]/g, '')) || 30;
      if (Number.isFinite(parsed) && parsed > 0) {
        await db.startBudgetPeriod({ allowance: parsed, days });
      }

      setBudgetEdited(false);
      await load();
      await showMessage(
        'Starting fresh',
        everything
          ? 'Everything cleared. Your budget starts from today.'
          : 'Spending history cleared. Goals, friends and blocked senders kept. Your budget starts from today.'
      );
    } finally {
      setBusy(false);
    }
  }

  function confirmReset(everything: boolean) {
    const detail = everything
      ? `This removes all ${counts?.transactions ?? 0} transactions, ${counts?.goals ?? 0} goals, ${counts?.contacts ?? 0} people and ${counts?.blocked ?? 0} blocked senders.`
      : `This removes all ${counts?.transactions ?? 0} transactions and ${counts?.ious ?? 0} debts. Goals, friends and blocked senders are kept.`;

    void showConfirm({
      title: everything ? 'Erase everything?' : 'Clear spending history?',
      message: `${detail} This cannot be undone.`,
      confirmLabel: 'Clear',
      destructive: true,
    }).then((ok) => {
      if (ok) startFresh(everything);
    });
  }

  async function recheckHistory() {
    setBusy(true);
    try {
      const result = await revalidateHistory();
      await load();
      await showMessage(
        result.rejected.length === 0 ? 'Nothing to clean up' : 'History rechecked',
        result.rejected.length === 0
          ? `Checked ${result.checked} imported messages and they all still look like real transactions.`
          : `${result.rejected.length} of ${result.checked} imported messages were not real transactions. ${formatMoney(result.rejectedSpend)} removed from your spending. Restore any of them below.`
      );
    } finally {
      setBusy(false);
    }
  }

  async function runBackfill() {
    setBusy(true);
    try {
      const result = await backfillFromInbox(150);
      await showMessage('Backfill complete', undefined, [
        { label: `${result.posted} added` },
        { label: `${result.queuedForReview} need review` },
        { label: `${result.skipped} skipped` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Every message that never became a transaction or a review item is kept
   * as a `RawEvent` from the moment it arrives (Phase 7) — this re-tries
   * every one of them under the current parser, which is what actually
   * recovers a payment a since-fixed rule once dropped, rather than just
   * explaining why it happened.
   */
  /**
   * What the parser is throwing away, grouped by the rule that threw it.
   *
   * Reading it here rather than shipping it anywhere: this is the user's
   * own message history, and the point is to see whether one rule is
   * quietly eating real transactions in bulk.
   */
  async function showWhatIsBeingDropped() {
    setBusy(true);
    try {
      const groups = await getRejectionBreakdown(PARSER_RULES_VERSION);
      if (groups.length === 0) {
        await showMessage(
          'Nothing dropped',
          'Every message captured under the current rules became a transaction or a review item.'
        );
        return;
      }

      // A list, shown as a list — one rule per row with the message it
      // caught underneath, rather than a paragraph of newlines.
      await showMessage(
        'What is being skipped',
        'A rule near the top with a real payment under it is a rule worth loosening.',
        groups.slice(0, 10).map((group) => ({
          label: `${group.count}× ${group.reason}`,
          detail: `e.g. "${group.example.replace(/\s+/g, ' ').slice(0, 90)}…"`,
        }))
      );
    } finally {
      setBusy(false);
    }
  }

  async function recoverMissed() {
    setBusy(true);
    try {
      const before = await countUnresolvedRawEvents();
      if (before === 0) {
        await showMessage(
          'Nothing to recover',
          'Every message on file already became a transaction or a review item.'
        );
        return;
      }
      const result = await reprocessUnresolvedRawEvents();
      await load();
      await showMessage(
        result.posted + result.queued === 0 ? 'Nothing recovered' : 'Recovery complete',
        `Checked ${result.checked} message${result.checked === 1 ? '' : 's'} that never became a transaction.`,
        [
          { label: `${result.posted} added` },
          { label: `${result.queued} sent to Review` },
          { label: `${result.stillSkipped} still don't look like real transactions` },
        ]
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen underHeader>
      <ScreenTitle title="Settings" />

      <Group title="Budget" footer="Starts today — set it when your allowance lands.">
        <View key="form" style={styles.form}>
          <Field
            label="Allowance"
            value={allowance}
            onChangeText={(text) => {
              setBudgetEdited(true);
              setAllowance(text);
            }}
            keyboardType="numeric"
            placeholder="9000"
          />
          <Field
            label="Days it has to last"
            value={periodDays}
            onChangeText={(text) => {
              setBudgetEdited(true);
              setPeriodDays(text);
            }}
            keyboardType="numeric"
            placeholder="30"
          />
          <Button label="Start a new budget period" variant="outlined" onPress={saveAllowance} />
        </View>
      </Group>

      <Group>
        <NavRow
          key="all"
          title="All transactions"
          onPress={() => navigation.navigate('Transactions')}
        />
        <NavRow key="review" title="Review inbox" onPress={() => navigation.navigate('Review')} />
      </Group>

      {!isCaptureAvailable ? (
        <Group title="Automatic capture">
          <Text key="na" style={styles.inset}>
            Needs the Android build. Manual entry still works.
          </Text>
        </Group>
      ) : (
        <>
          <Group title="Automatic capture" footer="Read on your phone. Never uploaded.">
            <Row
              key="sms"
              title="Bank SMS"
              right={
                smsGranted ? (
                  <Text style={styles.ok}>On</Text>
                ) : (
                  <Button label="Allow" variant="secondary" onPress={enableSms} />
                )
              }
            />
            <Row
              key="notif"
              title="Payment notifications"
              subtitle={listenerEnabled ? undefined : 'GPay, PhonePe, Paytm'}
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
            <Row
              key="contacts"
              title="Contacts"
              subtitle={contactsGranted ? undefined : 'For splitting bills'}
              right={
                contactsGranted ? (
                  <Text style={styles.ok}>On</Text>
                ) : (
                  <Button label="Allow" variant="secondary" onPress={enableContacts} />
                )
              }
            />
          </Group>

          <Group title="Messages">
            {smsGranted ? (
              <NavRow
                key="import"
                title={busy ? 'Reading…' : 'Import recent SMS'}
                onPress={runBackfill}
                disabled={busy}
              />
            ) : null}
            <NavRow
              key="recover"
              title={busy ? 'Checking…' : 'Recover missed messages'}
              onPress={recoverMissed}
              disabled={busy}
            />
            <NavRow
              key="skipped"
              title={busy ? 'Checking…' : "See what's skipped"}
              onPress={showWhatIsBeingDropped}
              disabled={busy}
            />
          </Group>
        </>
      )}

      {blocked.length > 0 ? (
        <Group title="Blocked senders" footer="Unblock and it counts again.">
          {blocked.map((entry) => (
            <Row
              key={entry.pattern}
              title={entry.pattern}
              subtitle={entry.reason ?? undefined}
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
        </Group>
      ) : null}

      {excluded.length > 0 ? (
        <Group
          title="Not counted"
          footer={excluded.length > 12 ? `And ${excluded.length - 12} more.` : undefined}
        >
          {excluded.slice(0, 12).map((tx) => (
            <Row
              key={tx.id}
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
        </Group>
      ) : null}

      <Group
        title="Notifications"
        footer={`Quiet ${notifications.quietStartHour}:00–${notifications.quietEndHour}:00, at most ${notifications.maxPerDay} a day.`}
      >
        <Toggle
          key="all"
          label="All notifications"
          value={notifications.enabled}
          onChange={async (value) => {
            if (value) await requestNotificationPermission();
            update({ enabled: value });
          }}
        />
        <Toggle
          key="confirm"
          label="Confirm before logging"
          hint="Numbers move only after you say yes"
          value={notifications.confirmBeforeLogging}
          onChange={(value) => update({ confirmBeforeLogging: value })}
        />
        <Toggle
          key="category"
          label="Ask for a missing category"
          value={notifications.categoryPromptsEnabled}
          onChange={(value) => update({ categoryPromptsEnabled: value })}
        />
        <Toggle
          key="pulse"
          label="After each spend"
          hint="Today's limit, at a glance"
          value={notifications.pulseEnabled}
          onChange={(value) => update({ pulseEnabled: value })}
        />
        <Toggle
          key="split"
          label="Split prompts"
          hint="For big social spends"
          value={notifications.splitPromptsEnabled}
          onChange={(value) => update({ splitPromptsEnabled: value })}
        />
        <Toggle
          key="over"
          label="Overspend warnings"
          value={notifications.overspendEnabled}
          onChange={(value) => update({ overspendEnabled: value })}
        />
        <Toggle
          key="goals"
          label="Goal milestones"
          value={notifications.goalsEnabled}
          onChange={(value) => update({ goalsEnabled: value })}
        />
        <Toggle
          key="streaks"
          label="Streaks"
          value={notifications.streaksEnabled}
          onChange={(value) => update({ streaksEnabled: value })}
        />
        <Toggle
          key="settle"
          label="Settle-up reminders"
          value={notifications.settleRemindersEnabled}
          onChange={(value) => update({ settleRemindersEnabled: value })}
        />
      </Group>

      <Group
        title="Privacy"
        footer="Pinch has no account and no server. A backup file is the only copy of your data that ever leaves this phone, and only when you make one."
      >
        {lockAvailable ? (
          <Toggle
            key="lock"
            label="Lock with fingerprint"
            hint="Asks when Pinch opens"
            value={lockOn}
            onChange={async (value) => {
              // Prove it works before relying on it, so nobody locks themselves out.
              if (value && !(await confirmIdentity('Turn on the Pinch lock'))) return;
              await setAppLock(value);
              setLockOn(value);
            }}
          />
        ) : null}
        <NavRow
          key="save-backup"
          title="Save a backup"
          subtitle="Encrypted with a passphrase"
          onPress={() => setBackupMode('SAVE')}
        />
        <NavRow
          key="restore-backup"
          title="Restore a backup"
          subtitle="Replaces what is on this phone"
          onPress={() => setBackupMode('RESTORE')}
        />
      </Group>

      <BackupSheet
        mode={backupMode}
        onClose={() => setBackupMode(null)}
        onRestored={() => {
          setBackupMode(null);
          setBudgetEdited(false);
          load();
          showMessage('Restored', 'Everything from the backup is back.');
        }}
      />

      <Group
        title="Start over"
        footer={
          counts
            ? `${counts.transactions} transactions · ${counts.captures} in review · ${counts.ious} debts`
            : undefined
        }
      >
        <NavRow
          key="fresh"
          title="Start from my current balance"
          subtitle="Forget what came before"
          onPress={() => setFreshVisible(true)}
        />
        <NavRow
          key="recheck"
          title={busy ? 'Checking…' : 'Recheck imported messages'}
          subtitle="Drop anything that isn't a real payment"
          onPress={recheckHistory}
          disabled={busy}
        />
        <NavRow
          key="clear"
          title="Clear spending history"
          subtitle="Starts a new period today"
          onPress={() => confirmReset(false)}
          disabled={busy}
        />
        <NavRow
          key="erase"
          title="Erase everything"
          danger
          onPress={() => confirmReset(true)}
          disabled={busy}
        />
      </Group>

      <FreshStartSheet
        visible={freshVisible}
        onClose={() => setFreshVisible(false)}
        onDone={() => {
          setFreshVisible(false);
          setBudgetEdited(false);
          load();
        }}
      />

      {isCaptureAvailable ? (
        <Button label="Open app settings" variant="ghost" onPress={openAppSettings} />
      ) : null}

      <Text style={styles.version}>
        Pinch {appConfig.expo.version} ({appConfig.expo.android.versionCode})
      </Text>
    </Screen>
  );
}

/** A row that goes somewhere or does something, with the chevron that says so. */
function NavRow({
  title,
  subtitle,
  onPress,
  disabled = false,
  danger = false,
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      style={({ pressed }) => [styles.navRow, (pressed || disabled) && styles.pressed]}
    >
      <View style={styles.navText}>
        <Text style={[styles.navTitle, danger && { color: palette.danger }]}>{title}</Text>
        {subtitle ? <Text style={styles.navSubtitle}>{subtitle}</Text> : null}
      </View>
      <Icon name="chevronRight" size={18} color={palette.textMuted} />
    </Pressable>
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
        // On is white, like every other "yes" in the app; coral stays rare.
        trackColor={{ false: palette.surfaceElevated, true: palette.textPrimary }}
        thumbColor={value ? palette.background : palette.textSecondary}
        {...({ activeThumbColor: palette.background } as object)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  version: {
    ...typography.caption,
    color: palette.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  note: { ...typography.caption, color: palette.textMuted, lineHeight: 18, marginTop: spacing.sm },
  ok: { ...typography.bodyBold, color: palette.textPrimary },
  undo: { ...typography.caption, color: palette.accent, fontWeight: '700' },
  form: { paddingVertical: spacing.md, gap: spacing.md },
  inset: { ...typography.body, color: palette.textSecondary, paddingVertical: spacing.md },
  pressed: { opacity: 0.6 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 14 },
  navText: { flex: 1, gap: 2 },
  navTitle: { ...typography.body, color: palette.textPrimary },
  navSubtitle: { ...typography.caption, color: palette.textSecondary },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    gap: spacing.md,
  },
  toggleText: { flex: 1 },
  toggleLabel: { ...typography.body, color: palette.textPrimary },
  toggleHint: { ...typography.caption, color: palette.textMuted, marginTop: 2 },
});
