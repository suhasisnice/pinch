import React, { useState } from 'react';
import {
  Button,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  addTransaction,
  createIOU,
  resolveIOUByAmount,
} from '../services/databaseService';
import { parseCreditSms, parseDebitSms } from '../services/parserService';
import { Transaction } from '../types';

const DEBIT_EXAMPLE = 'Rs. 700 spent at Olive Cafe via UPI';
const CREDIT_EXAMPLE = 'Received Rs. 175 from Rahul via UPI';

interface SplitPromptState {
  transaction: Transaction;
}

/**
 * Developer-only screen for exercising the SMS parsing pipeline without
 * relying on device SMS permissions. Two buttons simulate the two message
 * types a bank sends and drive them through the same Phase 1 database calls
 * a real SMS listener would use.
 */
export default function ParserScreen() {
  const [smsText, setSmsText] = useState(DEBIT_EXAMPLE);
  const [statusMessage, setStatusMessage] = useState('');
  const [splitPrompt, setSplitPrompt] = useState<SplitPromptState | null>(
    null
  );
  const [splitCounterparty, setSplitCounterparty] = useState('');
  const [splitAmount, setSplitAmount] = useState('');

  async function handleSimulateDebit() {
    const parsed = parseDebitSms(smsText);
    if (!parsed) {
      setStatusMessage('Could not parse a debit SMS out of that text.');
      return;
    }

    const transaction = await addTransaction({
      type: 'DEBIT',
      amount: parsed.amount,
      merchant: parsed.merchant,
      rawSms: smsText,
      date: new Date().toISOString(),
    });

    setStatusMessage(
      `Logged debit: Rs ${parsed.amount} at ${parsed.merchant}`
    );
    setSplitAmount(String(parsed.amount));
    setSplitCounterparty('');
    setSplitPrompt({ transaction });
  }

  async function handleSimulateCredit() {
    const parsed = parseCreditSms(smsText);
    if (!parsed) {
      setStatusMessage('Could not parse a credit SMS out of that text.');
      return;
    }

    const resolved = await resolveIOUByAmount(parsed.amount, parsed.sender);
    if (resolved) {
      setStatusMessage(
        `Cleared existing IOU with ${parsed.sender} for Rs ${parsed.amount} ` +
          `(not counted as new income).`
      );
      return;
    }

    await addTransaction({
      type: 'CREDIT',
      amount: parsed.amount,
      merchant: parsed.sender,
      rawSms: smsText,
      date: new Date().toISOString(),
    });
    setStatusMessage(
      `No open IOU matched. Logged Rs ${parsed.amount} from ${parsed.sender} as income.`
    );
  }

  async function handleConfirmSplit() {
    if (!splitPrompt) return;
    const amountNum = parseFloat(splitAmount);
    if (!splitCounterparty.trim() || Number.isNaN(amountNum)) {
      setStatusMessage('Enter a valid split amount and person to continue.');
      return;
    }

    await createIOU({
      amount: amountNum,
      counterparty: splitCounterparty.trim(),
      note: `Split of Rs ${splitPrompt.transaction.amount} at ${splitPrompt.transaction.merchant}`,
    });

    setStatusMessage(
      `Created IOU: ${splitCounterparty.trim()} owes Rs ${amountNum}.`
    );
    setSplitPrompt(null);
  }

  function handleDismissSplit() {
    setSplitPrompt(null);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>SMS Parser Simulator</Text>
      <Text style={styles.subtitle}>
        Paste a bank SMS below, then simulate it as a debit or credit.
      </Text>

      <TextInput
        style={styles.smsInput}
        value={smsText}
        onChangeText={setSmsText}
        multiline
        placeholder="Paste bank SMS text here"
      />

      <View style={styles.buttonRow}>
        <Button title="Simulate Debit SMS" onPress={handleSimulateDebit} />
        <Button title="Simulate Credit SMS" onPress={handleSimulateCredit} />
      </View>

      <View style={styles.exampleRow}>
        <Button
          title="Fill debit example"
          onPress={() => setSmsText(DEBIT_EXAMPLE)}
        />
        <Button
          title="Fill credit example"
          onPress={() => setSmsText(CREDIT_EXAMPLE)}
        />
      </View>

      {statusMessage ? (
        <Text style={styles.status}>{statusMessage}</Text>
      ) : null}

      {splitPrompt ? (
        <View style={styles.splitPrompt}>
          <Text style={styles.splitTitle}>Split this expense?</Text>
          <Text>
            Rs {splitPrompt.transaction.amount} at{' '}
            {splitPrompt.transaction.merchant}
          </Text>

          <TextInput
            style={styles.input}
            value={splitCounterparty}
            onChangeText={setSplitCounterparty}
            placeholder="Who owes you? (e.g. Rahul)"
          />
          <TextInput
            style={styles.input}
            value={splitAmount}
            onChangeText={setSplitAmount}
            placeholder="Split amount"
            keyboardType="numeric"
          />

          <View style={styles.buttonRow}>
            <Button title="Create IOU" onPress={handleConfirmSplit} />
            <Button title="Skip" onPress={handleDismissSplit} />
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: '#555',
  },
  smsInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    minHeight: 70,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 8,
    marginTop: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  exampleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  status: {
    marginTop: 8,
    fontStyle: 'italic',
  },
  splitPrompt: {
    marginTop: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 8,
  },
  splitTitle: {
    fontWeight: '700',
    marginBottom: 4,
  },
});
