import React, { useEffect, useState } from 'react';
import { showConfirm, showDialog } from './Dialog';
import { StyleSheet, Text, View } from 'react-native';
import * as db from '../db/dbService';
import { TransactionRow } from '../db/types';
import { CATEGORIES } from '../db/schema';
import { learnFromCategoryCorrection, propagateCategoryCorrection } from '../services/classificationService';
import { formatMoney, formatRelative } from '../utils/format';
import { palette, radii, spacing, typography } from '../theme/theme';
import { Button, Chip, Field, Sheet } from './ui';
import Icon from './Icon';

/**
 * View, edit, split, or get rid of a single transaction.
 *
 * "Get rid of" branches by where the row came from, and — for a captured
 * one — by why. A manual entry is just deleted outright; it has no SMS or
 * notification behind it to reappear from. A captured one (SMS/NOTIFICATION)
 * is always *excluded* rather than removed, because its dedup_key is what
 * stops the exact same message being re-added by the next backfill.
 *
 * Delete and Report both exclude, but they are not the same action wearing
 * two labels. Delete is for real money that genuinely moved — a friend's
 * cash back-and-forth, a one-off test payment — that you simply do not want
 * counted; it says nothing about the message and never touches the
 * blocklist. Report is a claim that the message itself was junk, and is the
 * only path that offers to block the sender, mirroring the review inbox's
 * own reject flow.
 */

/**
 * What this row actually is, for the meta line — Phase 2's "type/status"
 * requirement. An ordinary SPEND keeps showing its category, unchanged;
 * everything else (a transfer leg, a repayment, a refund, a manual
 * correction) gets a label that says so instead of "Uncategorised", since
 * none of those are meant to carry a spend category at all.
 */
function kindLabel(t: TransactionRow): string {
  if (t.transfer_pair_id !== null) return 'Transfer';
  if (t.is_adjustment) return 'Adjustment';
  switch (t.kind) {
    case 'INCOME':
      return 'Income';
    case 'REFUND':
      return 'Refund';
    case 'SETTLE_IN':
      return 'Repayment received';
    case 'SETTLE_OUT':
      return 'Repayment made';
    default:
      return t.category ?? 'Uncategorised';
  }
}

export default function TransactionDetailSheet({
  transaction,
  onClose,
  onChanged,
  onSplit,
  onMarkLoan,
  onLinkReimbursement,
}: {
  transaction: TransactionRow | null;
  onClose: () => void;
  onChanged: () => void;
  /** Hands off to the split flow instead of handling it here. */
  onSplit: (transaction: TransactionRow) => void;
  /** Hands off to recording this payment as a debt. */
  onMarkLoan: (transaction: TransactionRow) => void;
  /** Hands off to linking an incoming payment to the spends it paid back. */
  onLinkReimbursement?: (transaction: TransactionRow) => void;
}) {
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!transaction) return;
    setAmount(String(transaction.amount));
    setMerchant(transaction.merchant);
    setCategory(transaction.category);
    setEditing(false);
  }, [transaction]);

  if (!transaction) return null;

  const isCaptured = transaction.source !== 'MANUAL';
  const parsedAmount = Number(amount.replace(/[^\d.]/g, ''));
  const canSave = Number.isFinite(parsedAmount) && parsedAmount > 0 && merchant.trim().length > 0;

  async function saveEdits() {
    if (!canSave || busy) return;
    setBusy(true);
    try {
      const trimmedMerchant = merchant.trim();
      const categoryChanged = category !== transaction!.category;
      await db.updateTransaction(transaction!.id, {
        amount: parsedAmount,
        merchant: trimmedMerchant,
        category,
      });
      if (categoryChanged) {
        // A category set by hand is the strongest signal the app ever gets —
        // stronger than its own guess, right or wrong. Feed it back so the
        // next message from this merchant, and eventually similarly-named
        // ones, do not need the same correction again...
        await learnFromCategoryCorrection(trimmedMerchant, category);
        // ...and reach every other visit to the same place already sitting
        // in the ledger, not just future ones. Matching is fuzzy, since the
        // same chain rarely gets written identically twice.
        await propagateCategoryCorrection(trimmedMerchant, category, transaction!.id);
      }
      setEditing(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function deleteOutright() {
    setBusy(true);
    try {
      await db.deleteTransaction(transaction!.id);
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  /**
   * Both Report and Delete hide a captured row the same way underneath —
   * excluded, not removed, because the dedup_key is what stops the exact
   * same message being re-added by the next backfill. What differs is
   * intent, not mechanics: Delete says nothing about the message itself,
   * while Report is a claim that the message was junk, and only Report
   * offers to act on that claim by blocking the sender.
   */
  async function excludeTransaction() {
    setBusy(true);
    try {
      await db.setTransactionExcluded(transaction!.id, true);
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function excludeAndBlock() {
    setBusy(true);
    try {
      await db.setTransactionExcluded(transaction!.id, true);
      // The merchant string is what future parses of this sender will
      // produce too, so blocking on it catches the next message from the
      // same voucher/rummy/marketing blast without needing the raw sender.
      await db.addToBlocklist(transaction!.merchant, 'Reported from a transaction');
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    void showConfirm({
      title: 'Delete this transaction?',
      message: `${transaction!.merchant} · ${formatMoney(transaction!.amount)}`,
      confirmLabel: 'Delete',
      destructive: true,
    }).then((ok) => {
      if (ok) deleteOutright();
    });
  }

  /**
   * Plain removal. No claim about the message, no mention of the sender —
   * this is for real money that moved (a friend paid you back in cash for
   * something, a one-off back-and-forth) that you just don't want counted.
   */
  function confirmDeleteCaptured() {
    void showConfirm({
      title: 'Delete this transaction?',
      message:
        'It stops counting. Bring it back from Settings.',
      confirmLabel: 'Delete',
      destructive: true,
    }).then((ok) => {
      if (ok) excludeTransaction();
    });
  }

  /**
   * The message itself is the problem — fake, spam, a scam. Mirrors the
   * review inbox's own reject flow, so blocking a sender always looks and
   * reads the same regardless of where it was found from.
   */
  function confirmReport() {
    void showDialog({
      title: 'Report this transaction',
      message: `Should Pinch keep reading messages from "${transaction!.merchant}"?`,
      actions: [
        { label: 'Cancel', value: 'cancel', variant: 'ghost' },
        { label: 'Just this one', value: 'once', variant: 'secondary' },
        { label: 'Block sender', value: 'block', variant: 'danger' },
      ],
      dismissValue: 'cancel',
    }).then((choice) => {
      if (choice === 'once') excludeTransaction();
      if (choice === 'block') excludeAndBlock();
    });
  }

  return (
    <Sheet visible={transaction !== null} onClose={onClose} title={editing ? 'Edit' : 'Transaction'}>
      {editing ? (
        <>
          <Field label="Amount" value={amount} onChangeText={setAmount} keyboardType="numeric" />
          <Field label="Merchant" value={merchant} onChangeText={setMerchant} />
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
          <Button label={busy ? 'Saving…' : 'Save changes'} onPress={saveEdits} disabled={!canSave || busy} />
          <Button label="Cancel" variant="ghost" onPress={() => setEditing(false)} />
        </>
      ) : (
        <>
          <View style={styles.summary}>
            <Text style={styles.merchant}>{transaction.merchant}</Text>
            <Text
              style={[
                styles.amount,
                transaction.direction === 'CREDIT' && { color: palette.accent },
              ]}
            >
              {transaction.direction === 'CREDIT' ? '+' : '−'}
              {formatMoney(transaction.amount)}
            </Text>
            <Text style={styles.meta}>
              {kindLabel(transaction)} · {formatRelative(transaction.occurred_at)}
            </Text>
            <View style={styles.sourceBadge}>
              <Icon
                name={
                  transaction.source === 'SMS'
                    ? 'inbox'
                    : transaction.source === 'NOTIFICATION'
                      ? 'info'
                      : 'edit'
                }
                size={12}
                color={palette.textMuted}
              />
              <Text style={styles.sourceText}>
                {transaction.source === 'MANUAL' ? 'Added by hand' : `Captured from ${transaction.source.toLowerCase()}`}
              </Text>
            </View>
          </View>

          {transaction.raw_text ? (
            <View style={styles.rawBox}>
              <Text style={styles.rawLabel}>Original message</Text>
              <Text style={styles.rawText}>{transaction.raw_text}</Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Button label="Edit" variant="secondary" onPress={() => setEditing(true)} style={styles.flex} />
            {transaction.kind === 'SPEND' && transaction.transfer_pair_id === null ? (
              <Button
                label="Split"
                variant="secondary"
                onPress={() => onSplit(transaction)}
                style={styles.flex}
              />
            ) : null}
          </View>

          {onLinkReimbursement && db.canBeReimbursement(transaction) ? (
            <>
              <Button
                label={transaction.kind === 'SETTLE_IN' ? 'What this paid back' : 'This paid me back for…'}
                onPress={() => onLinkReimbursement(transaction)}
              />
              <Text style={styles.loanHint}>
                Pick what it covered to see your real share.
              </Text>
            </>
          ) : null}

          {/* Lending or borrowing your own transfer between accounts is not a
              real debt — hidden for a transfer leg rather than reachable and
              meaningless. */}
          {transaction.transfer_pair_id === null ? (
            <>
              <Button
                label={transaction.direction === 'DEBIT' ? 'I lent this' : 'I borrowed this'}
                variant="secondary"
                onPress={() => onMarkLoan(transaction)}
              />
              <Text style={styles.loanHint}>
                {transaction.direction === 'DEBIT'
                  ? 'Stops counting as your spending.'
                  : "Won't count as money to spend."}
              </Text>
            </>
          ) : null}

          {isCaptured ? (
            <View style={styles.excludeBlock}>
              <Button label="Delete" variant="danger" onPress={confirmDeleteCaptured} disabled={busy} />
              <Button label="Report as fake or spam" variant="ghost" onPress={confirmReport} disabled={busy} />
            </View>
          ) : (
            <Button label="Delete" variant="danger" onPress={confirmDelete} disabled={busy} />
          )}
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  summary: { alignItems: 'center', gap: 4 },
  merchant: { ...typography.body, color: palette.textSecondary },
  amount: { ...typography.display, color: palette.textPrimary },
  meta: { ...typography.caption, color: palette.textMuted },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  sourceText: { ...typography.micro, color: palette.textMuted },

  rawBox: {
    backgroundColor: palette.surfaceElevated,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  rawLabel: {
    ...typography.sectionLabel,
    color: palette.textMuted,
    marginBottom: 4,
  },
  rawText: { ...typography.caption, color: palette.textSecondary, lineHeight: 18 },

  actions: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },

  excludeBlock: { gap: spacing.sm, alignItems: 'center' },
  loanHint: { ...typography.micro, color: palette.textMuted, lineHeight: 15 },

  group: { gap: spacing.sm },
  groupLabel: {
    ...typography.sectionLabel,
    color: palette.textSecondary,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
