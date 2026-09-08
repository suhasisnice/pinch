import React, { useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { addTransaction, resolveIOUByAmount } from '../db/dbService';
import { parseCreditSms, parseDebitSms } from '../services/parserService';
import SplitModal from '../components/SplitModal';
import { palette, radii, spacing, typography } from '../theme/theme';

const DEBIT_EXAMPLE = 'Rs. 700 spent at Olive Cafe via UPI';
const CREDIT_EXAMPLE = 'Received Rs. 175 from Rahul via UPI';

interface PendingSplit {
  transactionId: number;
  amount: number;
  merchant: string;
}

/**
 * Developer-only screen for exercising the SMS parsing pipeline without
 * relying on device SMS permissions. Two buttons simulate the two message
 * types a bank sends and drive them through the same Phase 1 database calls
 * a real SMS listener would use. Logging a debit opens the Phase 3 Split
 * Modal, matching what a live SMS listener would trigger.
 */
export default function ParserScreen() {
  const [smsText, setSmsText] = useState(DEBIT_EXAMPLE);
  const [statusMessage, setStatusMessage] = useState('');
  const [pendingSplit, setPendingSplit] = useState<PendingSplit | null>(null);

  async function handleSimulateDebit() {
    const parsed = parseDebitSms(smsText);
    if (!parsed) {
      setStatusMessage('Could not parse a debit SMS out of that text.');
      return;
    }

    const transactionId = await addTransaction(parsed.amount, parsed.merchant, 'DEBIT');

    setStatusMessage(`Logged debit: Rs ${parsed.amount} at ${parsed.merchant}`);
    setPendingSplit({ transactionId, amount: parsed.amount, merchant: parsed.merchant });
  }

  async function handleSimulateCredit() {
    const parsed = parseCreditSms(smsText);
    if (!parsed) {
      setStatusMessage('Could not parse a credit SMS out of that text.');
      return;
    }

    const resolved = await resolveIOUByAmount(parsed.amount);
    if (resolved) {
      setStatusMessage(
        `Cleared an existing IOU for Rs ${parsed.amount} from ${parsed.sender} ` +
          `(not counted as new income).`
      );
      return;
    }

    await addTransaction(parsed.amount, parsed.sender, 'CREDIT');
    setStatusMessage(
      `No open IOU matched. Logged Rs ${parsed.amount} from ${parsed.sender} as income.`
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={typography.cardTitle}>SMS Parser Simulator</Text>
        <Text style={styles.subtitle}>
          Paste a bank SMS below, then simulate it as a debit or credit.
        </Text>

        <TextInput
          style={styles.smsInput}
          value={smsText}
          onChangeText={setSmsText}
          multiline
          placeholder="Paste bank SMS text here"
          placeholderTextColor={palette.textMuted}
        />

        <View style={styles.buttonRow}>
          <Pressable style={styles.actionButton} onPress={handleSimulateDebit}>
            <Text style={styles.actionButtonText}>Simulate Debit SMS</Text>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={handleSimulateCredit}>
            <Text style={styles.actionButtonText}>Simulate Credit SMS</Text>
          </Pressable>
        </View>

        <View style={styles.buttonRow}>
          <Pressable style={styles.secondaryButton} onPress={() => setSmsText(DEBIT_EXAMPLE)}>
            <Text style={styles.secondaryButtonText}>Fill debit example</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => setSmsText(CREDIT_EXAMPLE)}>
            <Text style={styles.secondaryButtonText}>Fill credit example</Text>
          </Pressable>
        </View>

        {statusMessage ? <Text style={styles.status}>{statusMessage}</Text> : null}
      </ScrollView>

      <SplitModal
        visible={pendingSplit !== null}
        transactionId={pendingSplit?.transactionId ?? null}
        amount={pendingSplit?.amount ?? 0}
        merchant={pendingSplit?.merchant ?? ''}
        onClose={() => setPendingSplit(null)}
        onCreated={() => setStatusMessage((prev) => `${prev} Split saved.`)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  container: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  subtitle: {
    ...typography.body,
    color: palette.textSecondary,
  },
  smsInput: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.input,
    padding: spacing.md,
    minHeight: 70,
    color: palette.textPrimary,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    backgroundColor: palette.neonGreen,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  actionButtonText: {
    ...typography.bodyBold,
    color: '#0A0A0A',
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  secondaryButtonText: {
    ...typography.caption,
    color: palette.textSecondary,
  },
  status: {
    ...typography.body,
    color: palette.textSecondary,
    fontStyle: 'italic',
  },
});
