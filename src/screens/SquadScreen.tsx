import React, { useCallback, useState } from 'react';
import { Alert, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as db from '../db/dbService';
import { ContactBalance, IOUDetail } from '../db/types';
import { postTransaction } from '../services/captureService';
import { sendNudge } from '../utils/nudge';
import { receivableConfidence } from '../math/budget';
import { formatMoney, formatRelative, daysBetween } from '../utils/format';
import { balanceColor, palette, radii, spacing, typography } from '../theme/theme';
import { Button, Card, CardTitle, EmptyState, Field, Loading, Row, Screen, ScreenTitle, Sheet } from '../components/ui';

export default function SquadScreen() {
  const [balances, setBalances] = useState<ContactBalance[] | null>(null);
  const [openIOUs, setOpenIOUs] = useState<IOUDetail[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [detailFor, setDetailFor] = useState<ContactBalance | null>(null);
  const [addVisible, setAddVisible] = useState(false);

  const load = useCallback(async () => {
    const [nextBalances, nextIOUs] = await Promise.all([db.getContactBalances(), db.getOpenIOUs()]);
    // Someone with no open debt and no history is just noise on this screen.
    setBalances(nextBalances.filter((b) => b.openCount > 0 || b.settledCount > 0));
    setOpenIOUs(nextIOUs);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!balances) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const owedToYou = balances.filter((b) => b.netAmount > 0.009);
  const youOwe = balances.filter((b) => b.netAmount < -0.009);
  const totalIn = owedToYou.reduce((sum, b) => sum + b.netAmount, 0);
  const totalOut = youOwe.reduce((sum, b) => sum + Math.abs(b.netAmount), 0);

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.textSecondary} />}>
      <ScreenTitle title="Squad" subtitle="Who owes who, netted out" />

      <View style={styles.totals}>
        <Card style={styles.totalCard}>
          <Text style={styles.totalLabel}>Owed to you</Text>
          <Text style={[styles.totalAmount, { color: palette.mint }]}>{formatMoney(totalIn)}</Text>
        </Card>
        <Card style={styles.totalCard}>
          <Text style={styles.totalLabel}>You owe</Text>
          <Text style={[styles.totalAmount, { color: palette.warningAmber }]}>
            {formatMoney(totalOut)}
          </Text>
        </Card>
      </View>

      <Button label="Add a debt" variant="secondary" onPress={() => setAddVisible(true)} />

      {balances.length === 0 ? (
        <Card>
          <EmptyState
            emoji="🤝"
            title="No open debts"
            body="Split a bill from Today, or add one by hand. Balances net out per person so you settle once, not six times."
          />
        </Card>
      ) : (
        <Card>
          <CardTitle>People</CardTitle>
          {balances.map((balance) => (
            <ContactRow key={balance.contactId} balance={balance} onPress={() => setDetailFor(balance)} />
          ))}
        </Card>
      )}

      <ContactSheet
        balance={detailFor}
        ious={openIOUs.filter((iou) => iou.contactId === detailFor?.contactId)}
        onClose={() => setDetailFor(null)}
        onChanged={() => {
          setDetailFor(null);
          load();
        }}
      />

      <AddDebtSheet
        visible={addVisible}
        onClose={() => setAddVisible(false)}
        onSaved={() => {
          setAddVisible(false);
          load();
        }}
      />
    </Screen>
  );
}

/**
 * Reliability is surfaced as plain language rather than a score, because the
 * useful version of this information is "this money is probably not coming
 * back", not "0.42".
 */
function reliabilityLabel(balance: ContactBalance): string | null {
  if (balance.isGhost) return '👻 ghost — barely counted';
  if (balance.settledCount === 0) return 'no track record yet';
  const days = balance.avgDaysToSettle ?? 0;
  if (days <= 3) return `⚡ pays back in ~${Math.max(1, Math.round(days))}d`;
  if (days <= 7) return `pays back in ~${Math.round(days)}d`;
  if (days <= 21) return `🐌 slow — ~${Math.round(days)}d to settle`;
  return `🐢 very slow — ~${Math.round(days)}d to settle`;
}

function ContactRow({ balance, onPress }: { balance: ContactBalance; onPress: () => void }) {
  const label = reliabilityLabel(balance);
  const age = balance.oldestOpenAt ? daysBetween(balance.oldestOpenAt, new Date().toISOString()) : 0;

  return (
    <Row
      title={balance.name}
      subtitle={[label, balance.openCount > 0 ? `${balance.openCount} open` : null]
        .filter(Boolean)
        .join(' · ')}
      onPress={onPress}
      right={
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.balanceAmount, { color: balanceColor(balance.netAmount) }]}>
            {balance.netAmount > 0 ? '+' : balance.netAmount < 0 ? '−' : ''}
            {formatMoney(Math.abs(balance.netAmount))}
          </Text>
          {age > 7 && balance.netAmount > 0 ? (
            <Text style={styles.aging}>{age}d old</Text>
          ) : null}
        </View>
      }
    />
  );
}

function ContactSheet({
  balance,
  ious,
  onClose,
  onChanged,
}: {
  balance: ContactBalance | null;
  ious: IOUDetail[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!balance) return null;

  const net = balance.netAmount;
  const confidence =
    net > 0
      ? receivableConfidence({
          openAmount: net,
          avgDaysToSettle: balance.avgDaysToSettle,
          settledCount: balance.settledCount,
          isGhost: balance.isGhost,
          daysOutstanding: balance.oldestOpenAt
            ? daysBetween(balance.oldestOpenAt, new Date().toISOString())
            : 0,
        })
      : 1;

  async function settleAll() {
    if (busy) return;
    setBusy(true);
    try {
      // Settling writes a real transaction so the money movement is recorded,
      // classified as SETTLE_IN/OUT rather than income or spending.
      await postTransaction({
        amount: Math.abs(net),
        direction: net > 0 ? 'CREDIT' : 'DEBIT',
        merchant: balance!.name,
        settlesContactId: balance!.contactId,
        source: 'MANUAL',
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function markGhost() {
    await db.updateContact(balance!.contactId, { isGhost: !balance!.isGhost });
    onChanged();
  }

  return (
    <Sheet visible={balance !== null} onClose={onClose} title={balance.name}>
      <View style={styles.detailHead}>
        <Text style={[styles.detailAmount, { color: balanceColor(net) }]}>
          {formatMoney(Math.abs(net))}
        </Text>
        <Text style={styles.detailLabel}>
          {net > 0 ? `${balance.name} owes you` : net < 0 ? `you owe ${balance.name}` : 'all square'}
        </Text>
        {net > 0 && confidence < 0.9 ? (
          <Text style={styles.confidence}>
            Counted as {formatMoney(net * confidence)} in your budget — {Math.round(confidence * 100)}%
            confidence based on how they've paid before.
          </Text>
        ) : null}
      </View>

      {ious.length > 0 ? (
        <View>
          <Text style={styles.groupLabel}>Open items</Text>
          {ious.map((iou) => (
            <Row
              key={iou.id}
              title={iou.reason ?? iou.merchant ?? 'Split'}
              subtitle={`${iou.direction === 'THEY_OWE_ME' ? 'owes you' : 'you owe'} · ${formatRelative(iou.createdAt)}`}
              right={<Text style={styles.iouAmount}>{formatMoney(iou.openAmount)}</Text>}
            />
          ))}
        </View>
      ) : null}

      {Math.abs(net) > 0.009 ? (
        <Button label={busy ? 'Settling…' : `Settle ${formatMoney(Math.abs(net))}`} onPress={settleAll} disabled={busy} />
      ) : null}

      {net > 0 ? (
        <Button
          label="Nudge on WhatsApp"
          variant="secondary"
          onPress={() =>
            sendNudge(balance.name, net, ious[0]?.merchant ?? 'that thing', balance.phone).catch(() =>
              Alert.alert('Could not open WhatsApp')
            )
          }
        />
      ) : null}

      <Button
        label={balance.isGhost ? 'Unmark as ghost' : 'Mark as ghost 👻'}
        variant="ghost"
        onPress={markGhost}
      />
    </Sheet>
  );
}

function AddDebtSheet({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [direction, setDirection] = useState<'THEY_OWE_ME' | 'I_OWE_THEM'>('THEY_OWE_ME');
  const [saving, setSaving] = useState(false);

  const parsed = Number(amount.replace(/[^\d.]/g, ''));
  const canSave = name.trim().length > 0 && Number.isFinite(parsed) && parsed > 0;

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const contactId = await db.findOrCreateContactByName(name.trim());
      // No transactionId: when a friend fronts the bill, no money left your
      // account, so there is nothing of yours to attach the debt to.
      await db.createIOU({
        contactId,
        amount: parsed,
        direction,
        reason: reason.trim() || null,
      });
      setName('');
      setAmount('');
      setReason('');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Add a debt">
      <View style={styles.toggleRow}>
        <Button
          label="They owe me"
          variant={direction === 'THEY_OWE_ME' ? 'primary' : 'secondary'}
          onPress={() => setDirection('THEY_OWE_ME')}
          style={styles.flex}
        />
        <Button
          label="I owe them"
          variant={direction === 'I_OWE_THEM' ? 'primary' : 'secondary'}
          onPress={() => setDirection('I_OWE_THEM')}
          style={styles.flex}
        />
      </View>
      <Field label="Who" value={name} onChangeText={setName} placeholder="Rahul" />
      <Field label="How much" value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="0" />
      <Field label="What for" value={reason} onChangeText={setReason} placeholder="Dinner at Toit" />
      <Button label={saving ? 'Saving…' : 'Add'} onPress={save} disabled={!canSave || saving} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  totals: { flexDirection: 'row', gap: spacing.sm },
  totalCard: { flex: 1, alignItems: 'center', gap: 4 },
  totalLabel: { ...typography.micro, color: palette.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  totalAmount: { ...typography.heroCompact, fontSize: 28 },

  balanceAmount: { ...typography.bodyBold, fontSize: 16 },
  aging: { ...typography.micro, color: palette.warningAmber },

  detailHead: { alignItems: 'center', gap: 4 },
  detailAmount: { ...typography.hero, fontSize: 46 },
  detailLabel: { ...typography.body, color: palette.textSecondary },
  confidence: {
    ...typography.caption,
    color: palette.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 18,
  },

  groupLabel: {
    ...typography.micro,
    color: palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  iouAmount: { ...typography.bodyBold, color: palette.textPrimary },

  toggleRow: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
