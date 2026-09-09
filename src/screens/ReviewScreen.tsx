import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as db from '../db/dbService';
import { CaptureInboxRow } from '../db/types';
import { acceptCapture } from '../services/captureService';
import { formatMoney, formatRelative } from '../utils/format';
import { palette, radii, spacing, typography } from '../theme/theme';
import { Button, Card, EmptyState, Loading, Screen, ScreenTitle } from '../components/ui';

/**
 * The review queue for messages the parser was not confident about.
 *
 * This screen is the reason automatic capture is safe to ship: a shaky parse
 * never silently becomes a transaction, so a bank format nobody anticipated
 * shows up as a question rather than a wrong number on the home screen.
 */
export default function ReviewScreen() {
  const [captures, setCaptures] = useState<CaptureInboxRow[] | null>(null);

  const load = useCallback(async () => {
    setCaptures(await db.getPendingCaptures());
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!captures) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenTitle
        title="Review"
        subtitle={captures.length === 0 ? 'All clear' : `${captures.length} waiting`}
      />

      {captures.length === 0 ? (
        <Card>
          <EmptyState
            icon="check"
            title="Nothing to review"
            body="Anything Pinch can't read confidently lands here so it never guesses at your numbers."
          />
        </Card>
      ) : (
        captures.map((capture) => (
          <Card key={capture.id}>
            <View style={styles.head}>
              <Text style={styles.amount}>
                {capture.parsed_direction === 'CREDIT' ? '+' : '−'}
                {formatMoney(capture.parsed_amount ?? 0)}
              </Text>
              <Text style={styles.confidence}>{Math.round(capture.confidence * 100)}% sure</Text>
            </View>

            <Text style={styles.merchant}>{capture.parsed_merchant ?? 'Unknown'}</Text>
            <Text style={styles.meta}>
              {capture.source === 'SMS' ? 'SMS' : 'Notification'} · {capture.sender ?? 'unknown'} ·{' '}
              {formatRelative(capture.received_at)}
            </Text>

            <View style={styles.raw}>
              <Text style={styles.rawText}>{capture.raw_text}</Text>
            </View>

            <View style={styles.actions}>
              <Button
                label="Not a transaction"
                variant="ghost"
                onPress={() => rejectWithOptionToBlock(capture, load)}
                style={styles.flex}
              />
              <Button
                label="Add it"
                onPress={async () => {
                  await acceptCapture(capture.id);
                  load();
                }}
                style={styles.flex}
              />
            </View>
          </Card>
        ))
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

  Alert.alert('Not a transaction', `Should Pinch keep reading messages from ${sender}?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Just this one', onPress: dismiss },
    {
      text: 'Block sender',
      style: 'destructive',
      onPress: async () => {
        await db.addToBlocklist(sender, 'Blocked from review');
        await dismiss();
      },
    },
  ]);
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amount: { ...typography.display, color: palette.textPrimary },
  confidence: { ...typography.micro, color: palette.warningAmber },
  merchant: { ...typography.cardTitle, color: palette.textPrimary, marginTop: spacing.xs },
  meta: { ...typography.micro, color: palette.textMuted, marginTop: 2 },

  raw: {
    backgroundColor: palette.surfaceElevated,
    borderRadius: radii.input,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  rawText: { ...typography.micro, color: palette.textSecondary, lineHeight: 16 },

  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  flex: { flex: 1 },
});
