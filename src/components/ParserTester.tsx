import React, { useState } from 'react';
import { Text } from 'react-native';
import { Chip, ChipRow, Field, Group, Row } from './ui';
import { amountColor, palette, typography } from '../theme/theme';
import { ACCEPT_THRESHOLD, explainRejection, parseMessage } from '../services/parserService';

export default function ParserTester() {
  const [text, setText] = useState('');
  const [sender, setSender] = useState('');
  const [source, setSource] = useState<'SMS' | 'NOTIFICATION'>('SMS');

  const parsed = text.trim() ? parseMessage(text, sender || null, { source }) : null;

  return (
    <Group title="Test a message" footer="Only a preview. Nothing is saved.">
      <Field label="Message" multiline value={text} onChangeText={setText} placeholder="Paste an SMS or notification" />
      <Field label="Sender (optional)" value={sender} onChangeText={setSender} placeholder="VM-HDFCBK" autoCapitalize="characters" />
      <ChipRow>
        <Chip label="SMS" selected={source === 'SMS'} onPress={() => setSource('SMS')} />
        <Chip label="Notification" selected={source === 'NOTIFICATION'} onPress={() => setSource('NOTIFICATION')} />
      </ChipRow>
      {text.trim() === '' ? null : (
        parsed === null ? (
          <Row title="Ignored" subtitle={explainRejection(text, sender || null, { source }) ?? 'no reason given'} />
        ) : (
          <>
            <Row title="Amount" right={<Text style={[typography.body, { color: amountColor(parsed.direction) }]}>{`${parsed.direction === 'CREDIT' ? '+' : '−'}₹${parsed.amount}`}</Text>} />
            <Row title="Name" right={<Text style={[typography.body, { color: palette.textPrimary }]}>{parsed.counterparty ?? 'not found'}</Text>} />
            <Row title="Direction" right={<Text style={[typography.body, { color: palette.textPrimary }]}>{parsed.direction === 'CREDIT' ? 'Money in' : 'Money out'}</Text>} />
            <Row title="Confidence" right={<Text style={[typography.body, { color: palette.textPrimary }]}>{`${Math.round(parsed.confidence * 100)}%`}</Text>} />
            <Row title="Reference" right={<Text style={[typography.body, { color: palette.textPrimary }]}>{parsed.reference ?? 'none'}</Text>} />
            <Row title="Account" right={<Text style={[typography.body, { color: palette.textPrimary }]}>{parsed.accountHint ?? 'none'}</Text>} />
            <Row title="Result" right={<Text style={[typography.body, { color: palette.textPrimary }]}>{parsed.confidence >= ACCEPT_THRESHOLD ? 'Would be logged' : 'Would go to Review'}</Text>} />
          </>
        )
      )}
    </Group>
  );
}