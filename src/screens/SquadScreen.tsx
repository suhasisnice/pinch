import React, { useCallback, useEffect, useState } from 'react';
import { showConfirm, showMessage } from '../components/Dialog';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as db from '../db/dbService';
import { ContactBalance, IOUDetail, TransactionRow } from '../db/types';
import { postTransaction } from '../services/captureService';
import { sendNudge } from '../utils/nudge';
import { FacesHero } from '../components/Heroes';
import { receivableConfidence } from '../math/budget';
import { formatMoney, formatRelative, daysBetween } from '../utils/format';
import { balanceColor, palette, radii, spacing, typography } from '../theme/theme';
import {
  Button,
  Card,
  EmptyState,
  CardTitle,
  Field,
  Group,
  Loading,
  Row,
  Screen,
  Sheet,
  TextLink,
  TopBar,
} from '../components/ui';
import ContactPicker from '../components/ContactPicker';
import AddExpenseSheet from '../components/AddExpenseSheet';
import SplitModal from '../components/SplitModal';
import Icon, { IconName } from '../components/Icon';
import { isCaptureAvailable } from '../../modules/pinch-capture';

export default function SquadScreen() {
  const [balances, setBalances] = useState<ContactBalance[] | null>(null);
  const [openIOUs, setOpenIOUs] = useState<IOUDetail[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [detailFor, setDetailFor] = useState<ContactBalance | null>(null);
  const [addVisible, setAddVisible] = useState(false);
  const [expenseVisible, setExpenseVisible] = useState(false);
  const [addThenSplit, setAddThenSplit] = useState(false);
  const [splitFor, setSplitFor] = useState<TransactionRow | null>(null);

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
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={palette.textSecondary}
        />
      }
    >
      <TopBar
        left="People"
        action={{
          label: 'Split a bill',
          icon: 'split',
          onPress: () => {
            setAddThenSplit(true);
            setExpenseVisible(true);
          },
        }}
      />

      <FacesHero
        amount={totalIn}
        label="owed to you"
        people={balances.map((b) => ({ name: b.name, amount: b.netAmount }))}
        line={peopleLine(totalIn, totalOut, owedToYou.length)}
        meta={totalOut > 0.009 ? `You owe ${formatMoney(totalOut)}` : 'You owe nobody. Rare.'}
      />

      {balances.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyBody}>
            Split a bill and everyone nets down to one number each. No spreadsheets, no awkward
            maths at the table.
          </Text>
          <TextLink label="Add a debt by hand" onPress={() => setAddVisible(true)} />
        </View>
      ) : (
        <Group title="Everyone" action="Add a debt" onAction={() => setAddVisible(true)}>
          {balances.map((balance) => (
            <ContactRow
              key={balance.contactId}
              balance={balance}
              onPress={() => setDetailFor(balance)}
            />
          ))}
        </Group>
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

      <AddExpenseSheet
        visible={expenseVisible}
        title="Split a bill"
        saveLabel="Next: who was there"
        onClose={() => setExpenseVisible(false)}
        onSaved={async (transactionId) => {
          setExpenseVisible(false);
          if (addThenSplit && transactionId !== null) {
            const created = await db.getTransactionById(transactionId);
            if (created) setSplitFor(created);
          }
          setAddThenSplit(false);
          load();
        }}
      />

      <SplitModal
        visible={splitFor !== null}
        transaction={splitFor}
        onClose={() => setSplitFor(null)}
        onSplit={() => {
          setSplitFor(null);
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
function reliabilityLabel(balance: ContactBalance): { icon: IconName; text: string } | null {
  if (balance.isGhost) return { icon: 'ghost', text: 'ghost — barely counted' };
  if (balance.settledCount === 0) return null;
  const days = balance.avgDaysToSettle ?? 0;
  if (days <= 3) {
    return { icon: 'trendUp', text: `pays back in ~${Math.max(1, Math.round(days))}d` };
  }
  if (days <= 7) return { icon: 'clock', text: `pays back in ~${Math.round(days)}d` };
  if (days <= 21) return { icon: 'trendDown', text: `slow — ~${Math.round(days)}d to settle` };
  return { icon: 'warning', text: `very slow — ~${Math.round(days)}d to settle` };
}

/** One kind sentence about the state of the group. */
function peopleLine(totalIn: number, totalOut: number, owers: number): string {
  if (totalIn < 0.01 && totalOut < 0.01) return 'Everyone is square. Beautiful.';
  if (totalIn < 0.01) return 'Nobody owes you. You owe a little.';
  return owers === 1
    ? 'One person to nudge, whenever it feels right.'
    : `${owers} people to nudge, whenever it feels right.`;
}

function ContactRow({ balance, onPress }: { balance: ContactBalance; onPress: () => void }) {
  const label = reliabilityLabel(balance);
  const age = balance.oldestOpenAt
    ? daysBetween(balance.oldestOpenAt, new Date().toISOString())
    : 0;

  return (
    <Row
      title={balance.name}
      subtitle={
        Math.abs(balance.netAmount) < 0.01
          ? 'All square'
          : [
              balance.netAmount > 0 ? 'Owes you' : 'You owe',
              balance.openCount > 1 ? `${balance.openCount} items` : null,
              label?.text,
            ]
              .filter(Boolean)
              .join(' · ')
      }
      onPress={onPress}
      right={
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.balanceAmount, { color: balanceColor(balance.netAmount) }]}>
            {balance.netAmount > 0 ? '+' : balance.netAmount < 0 ? '−' : ''}
            {formatMoney(Math.abs(balance.netAmount))}
          </Text>
          {age > 7 && balance.netAmount > 0 ? <Text style={styles.aging}>{age}d old</Text> : null}
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
  const [mergeVisible, setMergeVisible] = useState(false);
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
          {net > 0
            ? `${balance.name} owes you`
            : net < 0
              ? `you owe ${balance.name}`
              : 'all square'}
        </Text>
        {net > 0 && confidence < 0.9 ? (
          <Text style={styles.confidence}>
            Counted as {formatMoney(net * confidence)} — they've paid back{' '}
            {Math.round(confidence * 100)}% before.
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
        <Button
          label={busy ? 'Settling…' : `Settle ${formatMoney(Math.abs(net))}`}
          onPress={settleAll}
          disabled={busy}
        />
      ) : null}

      {net > 0 ? (
        <Button
          label="Nudge on WhatsApp"
          variant="secondary"
          onPress={() =>
            sendNudge(balance.name, net, ious[0]?.merchant ?? 'that thing', balance.phone).catch(
              () => showMessage('Could not open WhatsApp')
            )
          }
        />
      ) : null}

      <Button
        label={balance.isGhost ? 'Unmark as ghost' : 'Mark as ghost'}
        variant="ghost"
        onPress={markGhost}
      />
      <Button
        label="Same person as someone else?"
        variant="ghost"
        onPress={() => setMergeVisible(true)}
      />

      <MergeContactSheet
        visible={mergeVisible}
        contactId={balance.contactId}
        contactName={balance.name}
        onClose={() => setMergeVisible(false)}
        onMerged={() => {
          setMergeVisible(false);
          onChanged();
        }}
      />
    </Sheet>
  );
}

function MergeContactSheet({
  visible,
  contactId,
  contactName,
  onClose,
  onMerged,
}: {
  visible: boolean;
  contactId: number;
  contactName: string;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [others, setOthers] = useState<Array<{ id: number; name: string; phone: string | null }>>(
    []
  );
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    db.getContacts().then((contacts) => {
      setOthers(
        contacts
          .filter((c) => c.id !== contactId)
          .map((c) => ({ id: c.id, name: c.name, phone: c.phone }))
      );
    });
  }, [visible, contactId]);

  const filtered = query.trim()
    ? others.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
    : others;

  function pick(other: { id: number; name: string }) {
    void showConfirm({
      title: `Merge with ${other.name}?`,
      message: `Every debt with either name moves onto one balance under "${contactName}". "${other.name}" disappears — this cannot be undone.`,
      confirmLabel: 'Merge',
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      await db.mergeContacts(contactId, other.id);
      onMerged();
    });
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={`Merge into ${contactName}`}>
      <Text style={styles.mergeIntro}>Same person, two spellings? Pick the right one.</Text>
      <Field label="Search" value={query} onChangeText={setQuery} placeholder="Search people" />
      {filtered.length === 0 ? (
        <EmptyState
          icon="squad"
          title="No one else to merge with"
          body="Everyone else already has their own balance."
        />
      ) : (
        filtered.map((other) => (
          <Row
            key={other.id}
            title={other.name}
            subtitle={other.phone ?? undefined}
            onPress={() => pick(other)}
          />
        ))
      )}
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
  const [phone, setPhone] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [direction, setDirection] = useState<'THEY_OWE_ME' | 'I_OWE_THEM'>('THEY_OWE_ME');
  const [saving, setSaving] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);

  const parsed = Number(amount.replace(/[^\d.]/g, ''));
  const canSave = name.trim().length > 0 && Number.isFinite(parsed) && parsed > 0;

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const contactId = await db.findOrCreateContact({ name: name.trim(), phone });
      // No transactionId: when a friend fronts the bill, no money left your
      // account, so there is nothing of yours to attach the debt to.
      await db.createIOU({
        contactId,
        amount: parsed,
        direction,
        reason: reason.trim() || null,
      });
      setName('');
      setPhone(null);
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
      <Field
        label="Who"
        value={name}
        onChangeText={(next) => {
          setName(next);
          // Typing over a picked contact drops the number that came with it.
          setPhone(null);
        }}
        placeholder="Rahul"
        hint={phone ? `Will nudge on ${phone}` : undefined}
      />
      {isCaptureAvailable ? (
        <Button
          label="Pick from contacts"
          variant="secondary"
          onPress={() => setPickerVisible(true)}
        />
      ) : null}
      <Field
        label="How much"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        placeholder="0"
      />
      <Field
        label="What for"
        value={reason}
        onChangeText={setReason}
        placeholder="Dinner at Toit"
      />
      <Button label={saving ? 'Saving…' : 'Add'} onPress={save} disabled={!canSave || saving} />

      <ContactPicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onPick={(contact) => {
          setName(contact.name);
          setPhone(contact.phone);
          setPickerVisible(false);
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  empty: { gap: spacing.md, paddingVertical: spacing.md },
  emptyBody: { ...typography.body, color: palette.textSecondary },
  balanceAmount: { ...typography.body },
  aging: { ...typography.caption, color: palette.warning },

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

  mergeIntro: { ...typography.body, color: palette.textSecondary, lineHeight: 20 },

  groupLabel: {
    ...typography.sectionLabel,
    color: palette.textSecondary,
    marginBottom: spacing.xs,
  },
  iouAmount: { ...typography.bodyBold, color: palette.textPrimary },

  toggleRow: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
