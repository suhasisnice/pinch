import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as db from '../db/dbService';
import { postInvestment, postLoan, postTransaction, postTransfer } from '../services/captureService';
import { CATEGORIES } from '../db/schema';
import { OutingSummary } from '../db/repos/outings';
import { Button, Chip, Field, Sheet } from './ui';
import { palette, spacing, typography } from '../theme/theme';
import ContactPicker from './ContactPicker';
import { isCaptureAvailable } from '../../modules/pinch-capture';

/**
 * Every type of transaction Phase 2 asks for, entered up front rather than
 * retrofitted. Expense/Income are the original "Spent"/"Received" toggle,
 * unchanged. The rest each reuse existing machinery instead of inventing new
 * schema: Transfer links two ordinary rows the way an auto-detected transfer
 * already does; Loan given/received is the same transaction-then-IOU
 * composition `MarkAsLoanSheet` performs on a row that already exists;
 * Refund is `postTransaction`'s existing `kind` override; Adjustment is the
 * existing SPEND/INCOME path with a label, not a new kind (see
 * `docs/phases/PHASE_2_MANUAL_TRANSACTIONS.md`). Investment contribution/
 * withdrawal (Phase 9) is `non_spend_reason: 'INVESTMENT'` on whichever
 * direction applies — see `docs/phases/PHASE_9_INVESTMENTS.md`.
 */
export type TxnType =
  | 'EXPENSE'
  | 'INCOME'
  | 'TRANSFER'
  | 'LOAN_GIVEN'
  | 'LOAN_RECEIVED'
  | 'REFUND'
  | 'ADJUSTMENT'
  | 'INVESTMENT_IN'
  | 'INVESTMENT_OUT';

const TYPE_LABELS: Record<TxnType, string> = {
  EXPENSE: 'Expense',
  INCOME: 'Income',
  TRANSFER: 'Transfer',
  LOAN_GIVEN: 'Loan given',
  LOAN_RECEIVED: 'Loan received',
  REFUND: 'Refund',
  ADJUSTMENT: 'Adjustment',
  INVESTMENT_IN: 'Invest',
  INVESTMENT_OUT: 'Investment withdrawal',
};
const TYPE_ORDER: TxnType[] = [
  'EXPENSE',
  'INCOME',
  'TRANSFER',
  'LOAN_GIVEN',
  'LOAN_RECEIVED',
  'REFUND',
  'ADJUSTMENT',
  'INVESTMENT_IN',
  'INVESTMENT_OUT',
];

export default function AddExpenseSheet({
  visible,
  onClose,
  onSaved,
  defaultOutingId = null,
  saveLabel = 'Save',
  title = 'Add expense',
  defaultType = 'EXPENSE',
  defaultAmount = '',
  defaultDirection,
}: {
  visible: boolean;
  onClose: () => void;
  /** Receives the new transaction id, so callers can continue with it. Null for a Transfer (two rows) or if a Loan failed to post. */
  onSaved: (transactionId: number | null) => void;
  defaultOutingId?: number | null;
  saveLabel?: string;
  title?: string;
  /** Opens on a particular type — the reconcile flow arrives asking for an Adjustment. */
  defaultType?: TxnType;
  defaultAmount?: string;
  /** Only meaningful for ADJUSTMENT, which is the one type that can go either way. */
  defaultDirection?: 'DEBIT' | 'CREDIT';
}) {
  const [type, setType] = useState<TxnType>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [outingId, setOutingId] = useState<number | null>(defaultOutingId);
  const [outings, setOutings] = useState<OutingSummary[]>([]);
  const [saving, setSaving] = useState(false);

  // Transfer-only.
  const [fromLabel, setFromLabel] = useState('');
  const [toLabel, setToLabel] = useState('');

  // Loan-only.
  const [counterparty, setCounterparty] = useState('');
  const [counterpartyPhone, setCounterpartyPhone] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [pickerVisible, setPickerVisible] = useState(false);

  // Adjustment-only.
  const [adjustmentDirection, setAdjustmentDirection] = useState<'DEBIT' | 'CREDIT'>('DEBIT');

  const direction: 'DEBIT' | 'CREDIT' =
    type === 'INCOME' || type === 'REFUND' || type === 'LOAN_RECEIVED' || type === 'INVESTMENT_OUT'
      ? 'CREDIT'
      : type === 'ADJUSTMENT'
        ? adjustmentDirection
        : 'DEBIT';

  useEffect(() => {
    if (!visible) return;
    setType(defaultType);
    setAmount(defaultAmount);
    setMerchant('');
    setCategory(null);
    setOutingId(defaultOutingId);
    setFromLabel('');
    setToLabel('');
    setCounterparty('');
    setCounterpartyPhone(null);
    setReason('');
    setAdjustmentDirection(defaultDirection ?? 'DEBIT');
    db.getOutings(false).then(setOutings).catch(() => setOutings([]));
  }, [visible, defaultOutingId, defaultType, defaultAmount, defaultDirection]);

  const parsedAmount = Number(amount.replace(/[^\d.]/g, ''));
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;

  const canSave =
    amountValid &&
    (type === 'TRANSFER'
      ? fromLabel.trim().length > 0 && toLabel.trim().length > 0
      : type === 'LOAN_GIVEN' || type === 'LOAN_RECEIVED'
        ? counterparty.trim().length > 0
        : merchant.trim().length > 0);

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      if (type === 'TRANSFER') {
        const { debitId } = await postTransfer({
          amount: parsedAmount,
          fromLabel: fromLabel.trim(),
          toLabel: toLabel.trim(),
        });
        onSaved(debitId);
        return;
      }

      if (type === 'LOAN_GIVEN' || type === 'LOAN_RECEIVED') {
        const result = await postLoan({
          amount: parsedAmount,
          direction: type === 'LOAN_GIVEN' ? 'LENT' : 'BORROWED',
          counterpartyName: counterparty.trim(),
          counterpartyPhone,
          reason: reason.trim() || undefined,
        });
        onSaved(result?.transactionId ?? null);
        return;
      }

      if (type === 'INVESTMENT_IN' || type === 'INVESTMENT_OUT') {
        const transactionId = await postInvestment({
          amount: parsedAmount,
          direction: type === 'INVESTMENT_IN' ? 'CONTRIBUTION' : 'WITHDRAWAL',
          label: merchant.trim(),
        });
        onSaved(transactionId);
        return;
      }

      const transactionId = await postTransaction({
        amount: parsedAmount,
        direction,
        merchant: merchant.trim(),
        category: type === 'EXPENSE' ? category : null,
        outingId: type === 'EXPENSE' ? outingId : null,
        source: 'MANUAL',
        kind: type === 'REFUND' ? 'REFUND' : undefined,
        isAdjustment: type === 'ADJUSTMENT',
      });
      onSaved(transactionId);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={styles.group}>
        <Text style={styles.groupLabel}>Type</Text>
        <View style={styles.chipWrap}>
          {TYPE_ORDER.map((option) => (
            <Chip
              key={option}
              label={TYPE_LABELS[option]}
              selected={type === option}
              onPress={() => setType(option)}
            />
          ))}
        </View>
      </View>

      <Field
        label="Amount"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        placeholder="0"
        autoFocus
      />

      {type === 'EXPENSE' || type === 'INCOME' || type === 'REFUND' ? (
        <Field
          label={direction === 'DEBIT' ? 'Where' : type === 'REFUND' ? 'Refunded by' : 'From whom'}
          value={merchant}
          onChangeText={setMerchant}
          placeholder={direction === 'DEBIT' ? 'Swiggy' : 'Rahul'}
        />
      ) : null}

      {type === 'INVESTMENT_IN' || type === 'INVESTMENT_OUT' ? (
        <Field
          label="Platform or fund"
          value={merchant}
          onChangeText={setMerchant}
          placeholder="Zerodha"
        />
      ) : null}

      {type === 'EXPENSE' ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Category</Text>
          <View style={styles.chipWrap}>
            {CATEGORIES.map((option) => (
              <Chip
                key={option}
                label={option}
                selected={category === option}
                onPress={() => setCategory(category === option ? null : option)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {type === 'EXPENSE' && outings.length > 0 ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Part of an outing?</Text>
          <View style={styles.chipWrap}>
            {outings.map((outing) => (
              <Chip
                key={outing.id}
                label={`${outing.emoji} ${outing.name}`}
                selected={outingId === outing.id}
                onPress={() => setOutingId(outingId === outing.id ? null : outing.id)}
                color={palette.info}
              />
            ))}
          </View>
        </View>
      ) : null}

      {type === 'TRANSFER' ? (
        <>
          <Field label="From account" value={fromLabel} onChangeText={setFromLabel} placeholder="HDFC Savings" />
          <Field label="To account" value={toLabel} onChangeText={setToLabel} placeholder="SBI FD" />
        </>
      ) : null}

      {type === 'LOAN_GIVEN' || type === 'LOAN_RECEIVED' ? (
        <>
          <Field
            label="Who"
            value={counterparty}
            onChangeText={(next) => {
              setCounterparty(next);
              setCounterpartyPhone(null);
            }}
            placeholder="Rahul"
            hint={counterpartyPhone ? `Will nudge on ${counterpartyPhone}` : undefined}
          />
          {isCaptureAvailable ? (
            <Button label="Pick from contacts" variant="ghost" onPress={() => setPickerVisible(true)} />
          ) : null}
          <Field label="What for" value={reason} onChangeText={setReason} placeholder="Rent shortfall" />
        </>
      ) : null}

      {type === 'ADJUSTMENT' ? (
        <>
          <View style={styles.toggleRow}>
            <Chip
              label="Money I'm adding"
              selected={adjustmentDirection === 'CREDIT'}
              onPress={() => setAdjustmentDirection('CREDIT')}
              color={palette.accent}
            />
            <Chip
              label="Money I'm removing"
              selected={adjustmentDirection === 'DEBIT'}
              onPress={() => setAdjustmentDirection('DEBIT')}
            />
          </View>
          <Field
            label="What are you correcting?"
            value={merchant}
            onChangeText={setMerchant}
            placeholder="Cash spending I forgot to log"
          />
        </>
      ) : null}

      <Button label={saving ? 'Saving…' : saveLabel} onPress={save} disabled={!canSave || saving} />

      <ContactPicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onPick={(contact) => {
          setCounterparty(contact.name);
          setCounterpartyPhone(contact.phone);
          setPickerVisible(false);
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  toggleRow: { flexDirection: 'row', gap: spacing.sm },
  group: { gap: spacing.sm },
  groupLabel: {
    ...typography.micro,
    color: palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
