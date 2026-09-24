import React, { useCallback, useState } from 'react';
import { showDialog } from '../components/Dialog';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as db from '../db/dbService';
import { CaptureInboxRow, TransactionRow } from '../db/types';
import { acceptCapture, confirmCaptureIsDuplicate, senderLabel } from '../services/captureService';
import { ACCEPT_THRESHOLD } from '../services/parserService';
import { formatMoney, formatRelative } from '../utils/format';
import { palette, spacing, typography } from '../theme/theme';
import { Button, Card, EmptyState, Loading, Screen, TopBar } from '../components/ui';

/**
 * The review queue for messages the parser was not confident about, and for
 * the ones it read perfectly but cannot place.
 *
 * This screen is the reason automatic capture is safe to ship: a shaky parse
 * never silently becomes a transaction, so a bank format nobody anticipated
 * shows up as a question rather than a wrong number on the home screen. The
 * same applies to a message that might be a payment already recorded under a
 * different name for the sender — see `findUnconfirmedDuplicate`.
 */
export default function ReviewScreen() {
  const [captures, setCaptures] = useState<CaptureInboxRow[] | null>(null);
  // Keyed by transaction id, for the "is this the same payment?" question.
  const [maybeDuplicates, setMaybeDuplicates] = useState<Record<number, TransactionRow>>({});

  const load = useCallback(async () => {
    const pending = await db.getPendingCaptures();
    setCaptures(pending);

    const linked = await Promise.all(
      pending
        .map((capture) => capture.possible_duplicate_of)
        .filter((id): id is number => id !== null)
        .map((id) => db.getTransactionById(id))
    );
    setMaybeDuplicates(
      Object.fromEntries(
        linked.filter((row): row is TransactionRow => row !== null).map((row) => [row.id, row])
      )
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!captures) {
    return (
      <Screen underHeader scroll={false}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen underHeader>
      <TopBar left={captures.length === 0 ? 'All clear' : `${captures.length} waiting`} />

      {captures.length === 0 ? (
        <EmptyState
          icon="check"
          title="All caught up"
          body="Anything Pinch isn't sure about waits here. Nothing is, right now."
        />
      ) : (
        captures.map((capture) => {
          const twin =
            capture.possible_duplicate_of !== null
              ? maybeDuplicates[capture.possible_duplicate_of]
              : undefined;

          return (
            <Card key={capture.id}>
              <View style={styles.head}>
                <View style={styles.flex}>
                  <Text style={styles.merchant} numberOfLines={1}>
                    {capture.parsed_merchant ?? 'Unknown'}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {capture.sender
                      ? senderLabel(capture.sender)
                      : capture.source === 'SMS'
                        ? 'SMS'
                        : 'Notification'}{' '}
                    · {formatRelative(capture.received_at)}
                  </Text>
                </View>
                <Text style={styles.amount}>
                  {capture.parsed_direction === 'CREDIT' ? '+' : '−'}
                  {formatMoney(capture.parsed_amount ?? 0)}
                </Text>
              </View>

              <View style={styles.tagRow}>
                {twin ? (
                  <Text style={[styles.tag, styles.tagNeutral]}>Possible repeat</Text>
                ) : capture.confidence >= ACCEPT_THRESHOLD ? (
                  // Read cleanly — the only question is whether it should
                  // count, not whether it was understood.
                  <Text style={[styles.tag, styles.tagNeutral]}>Read clearly</Text>
                ) : (
                  <Text style={[styles.tag, styles.tagWarn]}>
                    {Math.round(capture.confidence * 100)}% sure
                  </Text>
                )}
              </View>

              <View style={styles.raw}>
                <Text style={styles.rawText}>{capture.raw_text}</Text>
              </View>

              {twin ? (
                <>
                  {/* Two sources name the same sender differently — a UPI app
                      uses your contact name, the bank uses the registered one
                      — so this cannot be settled automatically either way. */}
                  <Text style={styles.dupeQuestion}>
                    Same as {formatMoney(twin.amount)} from {twin.merchant},{' '}
                    {formatRelative(twin.occurred_at)}?
                  </Text>
                  <View style={styles.actions}>
                    <Button
                      label="Same one"
                      onPress={async () => {
                        // Records that these two names are one person, so
                        // this stops being a question the next time they pay.
                        await confirmCaptureIsDuplicate(capture.id);
                        load();
                      }}
                      style={styles.flex}
                    />
                    <Button
                      label="Different"
                      variant="tonal"
                      onPress={async () => {
                        await acceptCapture(capture.id);
                        load();
                      }}
                      style={styles.flex}
                    />
                  </View>
                  <Text style={styles.dupeHint}>Same one keeps the original.</Text>
                </>
              ) : (
                <View style={styles.actions}>
                  <Button
                    label="Not a payment"
                    variant="tonal"
                    onPress={() => rejectWithOptionToBlock(capture, load)}
                    style={styles.flex}
                  />
                  <Button
                    // A confident parse is asking permission to count;
                    // a shaky one is asking whether it read the message
                    // right. Same two buttons, different question.
                    label={capture.confidence >= ACCEPT_THRESHOLD ? 'Confirm' : 'Add it'}
                    onPress={async () => {
                      await acceptCapture(capture.id);
                      load();
                    }}
                    style={styles.flex}
                  />
                </View>
              )}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

/**
 * Rejecting one message is rarely the whole story.
 *
 * Promotional senders send the same thing every week, so the useful action is
 * usually "and never ask me about this sender again" — blocking is offered
 * right where the annoyance is, rather than buried in Settings.
 */
function rejectWithOptionToBlock(capture: CaptureInboxRow, reload: () => void) {
  const sender = capture.sender?.trim();

  const dismiss = async () => {
    await db.rejectCapture(capture.id);
    reload();
  };

  if (!sender) {
    void dismiss();
    return;
  }

  void showDialog({
    title: 'Not a payment',
    message: `Should Pinch keep reading messages from ${senderLabel(sender)}?`,
    actions: [
      { label: 'Cancel', value: 'cancel', variant: 'ghost' },
      { label: 'Just this one', value: 'once', variant: 'secondary' },
      { label: 'Block sender', value: 'block', variant: 'danger' },
    ],
    dismissValue: 'cancel',
  }).then(async (choice) => {
    if (choice === 'once') {
      await dismiss();
      return;
    }
    if (choice === 'block') {
      await db.addToBlocklist(sender, 'Blocked from review');
      await dismiss();
    }
  });
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  amount: { ...typography.body, fontSize: 20, lineHeight: 26, color: palette.textPrimary },
  tagRow: { flexDirection: 'row', marginTop: spacing.sm },
  tag: {
    ...typography.caption,
  },
  tagWarn: { color: palette.warning },
  tagNeutral: { color: palette.textMuted },
  dupeQuestion: {
    ...typography.caption,
    color: palette.textSecondary,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  dupeHint: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xs },
  merchant: { ...typography.cardTitle, color: palette.textPrimary },
  meta: { ...typography.caption, color: palette.textSecondary, marginTop: 2 },

  raw: {
    borderLeftWidth: 1,
    borderLeftColor: palette.border,
    paddingLeft: spacing.md,
    paddingVertical: 2,
    marginTop: spacing.sm,
  },
  rawText: { ...typography.caption, color: palette.textSecondary, lineHeight: 18 },

  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  flex: { flex: 1 },
});
