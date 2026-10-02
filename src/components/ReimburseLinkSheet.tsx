import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as db from '../db/dbService';
import { TransactionRow } from '../db/types';
import { ReimbursementCandidate } from '../db/repos/reimbursements';
import { planReimbursement } from '../math/reimbursement';
import { formatMoney } from '../utils/format';
import { layer, palette, radii, spacing, stateLayer, typography } from '../theme/theme';
import { AnimatedMoney } from './motion';
import { Button, Loading, ProgressBar, Sheet } from './ui';
import { showConfirm, showMessage } from './Dialog';
import Icon from './Icon';

/**
 * "This money paid me back for those."
 *
 * Opened from an incoming payment. Tick the spends it covers and the sheet
 * works the answer out live — spent, paid back, what was actually yours —
 * so the result is visible before anything is saved. The ledger then shows
 * the set as one line at that net figure.
 *
 * Nothing is deleted. Both movements happened and the bank balance depends
 * on each of them; what changes is that the repayment stops reading as
 * income and the spends stop reading as all yours.
 *
 * Suggestions are ordered first, never pre-ticked: a bill this person
 * already owes on, or one matching the amount exactly, is a strong hint,
 * but the link is the user's to make.
 */
export default function ReimburseLinkSheet({
  transaction,
  onClose,
  onSaved,
}: {
  transaction: TransactionRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [candidates, setCandidates] = useState<ReimbursementCandidate[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!transaction) return;
    setCandidates(null);
    setSelected([]);
    db.getReimbursementCandidates(transaction.id)
      .then((rows) => {
        setCandidates(rows);
        setSelected(rows.filter((row) => row.linked).map((row) => row.id));
      })
      .catch(() => setCandidates([]));
  }, [transaction]);

  const byId = useMemo(
    () => new Map((candidates ?? []).map((candidate) => [candidate.id, candidate])),
    [candidates]
  );

  const plan = useMemo(() => {
    if (!transaction) return null;
    const spends = selected
      .map((id) => byId.get(id))
      .filter((spend): spend is ReimbursementCandidate => spend !== undefined);
    return planReimbursement(transaction.amount, spends);
  }, [transaction, selected, byId]);

  const coverFor = useMemo(() => {
    const map = new Map<number, number>();
    for (const allocation of plan?.allocations ?? []) {
      map.set(allocation.spendId, allocation.fromExisting + allocation.fromNew);
    }
    return map;
  }, [plan]);

  if (!transaction) return null;

  const wasLinked = (candidates ?? []).some((candidate) => candidate.linked);
  const explained = plan?.applied ?? 0;
  const excess = plan?.excess ?? 0;
  const complete = selected.length > 0 && excess === 0;
  // A tick that ends up covering nothing — the payment ran out on older
  // bills first — would silently not be linked. Say so on the row instead.
  const idle = selected.filter((id) => (coverFor.get(id) ?? 0) <= 0.009);

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    if (!transaction || !complete || saving) return;
    setSaving(true);
    try {
      const linkable = selected.filter((id) => !idle.includes(id));
      await db.linkReimbursement(transaction.id, linkable);
      onSaved();
    } catch (error) {
      await showMessage("Couldn't link that", error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function unlink() {
    if (!transaction) return;
    const confirmed = await showConfirm({
      title: 'Not a repayment?',
      message: `${formatMoney(transaction.amount)} from ${transaction.merchant} goes back to counting as money in, and the payments it covered count as fully yours again.`,
      confirmLabel: 'Unlink',
    });
    if (!confirmed) return;
    await db.unlinkReimbursement(transaction.id);
    onSaved();
  }

  const suggested = (candidates ?? []).filter((c) => c.linked || c.suggested);
  const rest = (candidates ?? []).filter((c) => !c.linked && !c.suggested);

  return (
    <Sheet visible={transaction !== null} onClose={onClose} title="What did this pay back?">
      <View style={styles.hero}>
        <Text style={styles.from}>From {transaction.merchant}</Text>
        <Text style={styles.incoming}>+{formatMoney(transaction.amount)}</Text>
      </View>

      {/* The answer, worked out as you tap. */}
      <View style={styles.equation}>
        <Figure label="Spent" amount={plan?.spent ?? 0} />
        <Text style={styles.operator}>−</Text>
        <Figure label="Paid back" amount={explained} tone={palette.textPrimary} />
        <Text style={styles.operator}>=</Text>
        <Figure label="Yours" amount={Math.max(0, (plan?.spent ?? 0) - explained)} emphasis />
      </View>

      <View style={styles.meter}>
        <ProgressBar
          fraction={transaction.amount > 0 ? explained / transaction.amount : 0}
          color={excess > 0 && selected.length > 0 ? palette.warning : palette.textPrimary}
          height={6}
        />
        <Text
          style={[
            styles.meterText,
            excess > 0 && selected.length > 0 && { color: palette.warning },
          ]}
        >
          {selected.length === 0
            ? 'Tap the payments this covered'
            : excess > 0
              ? `${formatMoney(excess)} still unexplained — tick another, or leave it as money in`
              : `All ${formatMoney(transaction.amount)} accounted for`}
        </Text>
      </View>

      <Button
        label={
          saving
            ? 'Linking…'
            : selected.length - idle.length > 1
              ? `Link ${selected.length - idle.length} payments`
              : 'Link'
        }
        onPress={save}
        disabled={!complete || saving || selected.length === idle.length}
      />
      {wasLinked ? (
        <Button label="Not a repayment — unlink" variant="ghost" onPress={unlink} />
      ) : null}
      {candidates === null ? (
        <Loading />
      ) : candidates.length === 0 ? (
        <Text style={styles.empty}>
          No spending within 60 days of this to link it to.
        </Text>
      ) : (
        <>
          {suggested.length > 0 ? <Text style={styles.groupLabel}>Likely</Text> : null}
          {suggested.map((candidate) => (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              selected={selected.includes(candidate.id)}
              covers={coverFor.get(candidate.id) ?? 0}
              onPress={() => toggle(candidate.id)}
            />
          ))}
          {rest.length > 0 ? (
            <Text style={styles.groupLabel}>
              {suggested.length > 0 ? 'Everything else' : 'Your spending'}
            </Text>
          ) : null}
          {rest.map((candidate) => (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              selected={selected.includes(candidate.id)}
              covers={coverFor.get(candidate.id) ?? 0}
              onPress={() => toggle(candidate.id)}
            />
          ))}
        </>
      )}

    </Sheet>
  );
}

export function Figure({
  label,
  amount,
  tone,
  emphasis = false,
}: {
  label: string;
  amount: number;
  tone?: string;
  emphasis?: boolean;
}) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <AnimatedMoney
        amount={amount}
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[emphasis ? styles.figureStrong : styles.figureValue, tone ? { color: tone } : {}]}
      />
    </View>
  );
}

export function CandidateRow({
  candidate,
  selected,
  covers,
  onPress,
  incoming = false,
}: {
  candidate: Pick<ReimbursementCandidate, 'merchant' | 'amount' | 'occurredAt'> & {
    category?: string | null;
  };
  selected: boolean;
  covers: number;
  onPress: () => void;
  /** The row is money in (NetOutSheet): a plus sign, no category, never struck out. */
  incoming?: boolean;
}) {
  const partial = selected && covers > 0.009 && covers < candidate.amount - 0.009;
  const idle = selected && covers <= 0.009;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${candidate.merchant}, ${formatMoney(candidate.amount)}`}
      style={({ pressed }) => [
        styles.candidate,
        selected && styles.candidateSelected,
        pressed && { backgroundColor: layer(palette.textPrimary, 0.05) },
      ]}
    >
      <View style={[styles.tick, selected && styles.tickOn]}>
        {selected ? <Icon name="check" size={14} color={palette.onAccent} /> : null}
      </View>
      <View style={styles.candidateBody}>
        <Text style={styles.candidateTitle} numberOfLines={1}>
          {candidate.merchant}
        </Text>
        <Text style={[styles.candidateMeta, idle && { color: palette.warning }]} numberOfLines={1}>
          {idle
            ? 'Nothing left over for this one'
            : partial
              ? `${formatMoney(covers)} of it paid back`
              : incoming
                ? shortDate(candidate.occurredAt)
                : [shortDate(candidate.occurredAt), candidate.category ?? 'Uncategorised'].join(
                    ' · '
                  )}
        </Text>
      </View>
      {/* Struck through only when fully paid back — the visual "gone" the
          ledger will show, without claiming it for a bill only partly covered. */}
      <Text
        style={[
          styles.candidateAmount,
          incoming && { color: palette.good },
          selected && !idle && !partial && !incoming && styles.candidateAmountStruck,
        ]}
      >
        {incoming ? '+' : '−'}
        {formatMoney(candidate.amount)}
      </Text>
    </Pressable>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 2 },
  from: { ...typography.body, color: palette.textSecondary },
  incoming: { ...typography.display, color: palette.textPrimary },

  equation: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  figure: { flex: 1, alignItems: 'center', gap: 2 },
  figureLabel: {
    ...typography.sectionLabel,
    color: palette.textMuted,
  },
  figureValue: { ...typography.bodyBold, color: palette.textPrimary },
  figureStrong: { ...typography.cardTitle, color: palette.textPrimary },
  operator: { ...typography.body, color: palette.textMuted, paddingBottom: 2 },

  meter: { gap: spacing.xs },
  meterText: { ...typography.caption, color: palette.textSecondary, textAlign: 'center' },

  groupLabel: {
    ...typography.sectionLabel,
    color: palette.textSecondary,
    marginTop: spacing.sm,
  },
  empty: { ...typography.caption, color: palette.textMuted, textAlign: 'center' },

  candidate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  candidateSelected: { backgroundColor: palette.surfaceElevated },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: palette.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickOn: { backgroundColor: palette.textPrimary, borderColor: palette.textPrimary },
  candidateBody: { flex: 1, gap: 2 },
  candidateTitle: { ...typography.body, color: palette.textPrimary },
  candidateMeta: { ...typography.caption, color: palette.textSecondary },
  candidateAmount: { ...typography.bodyBold, color: palette.textPrimary },
  candidateAmountStruck: { color: palette.textMuted, textDecorationLine: 'line-through' },
});
