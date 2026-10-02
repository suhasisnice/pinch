import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as db from '../db/dbService';
import { TransactionRow } from '../db/types';
import { NetOutCandidate } from '../db/repos/reimbursements';
import { formatMoney } from '../utils/format';
import { palette } from '../theme/theme';
import { Button, Loading, Sheet } from './ui';
import { showMessage } from './Dialog';
import ReimburseLinkSheet, { CandidateRow, Figure, styles } from './ReimburseLinkSheet';

interface Props {
  transaction: TransactionRow | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * "Net out", from either end of the pair. Money in asks what it paid back
 * (ReimburseLinkSheet); a spend asks what already came back for it. Both
 * write the same link, so the ledger and the budget read them the same way.
 */
export default function NetOutSheet({ transaction, onClose, onSaved }: Props) {
  const credit = transaction?.direction === 'CREDIT' ? transaction : null;
  const spend = transaction?.direction === 'DEBIT' ? transaction : null;
  return (
    <>
      <ReimburseLinkSheet transaction={credit} onClose={onClose} onSaved={onSaved} />
      <SpendNetOutSheet transaction={spend} onClose={onClose} onSaved={onSaved} />
    </>
  );
}

/**
 * Opened from a spend: tick the money that already came back for it. Paid 70,
 * a friend sent 35, so it cost you 35. Nothing is deleted; the 35 stops
 * reading as income and the 70 stops reading as all yours.
 */
function SpendNetOutSheet({ transaction, onClose, onSaved }: Props) {
  const [candidates, setCandidates] = useState<NetOutCandidate[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!transaction) return;
    setCandidates(null);
    setSelected([]);
    db.getNetOutCandidates(transaction.id)
      .then((rows) => {
        setCandidates(rows);
        setSelected(rows.filter((row) => row.applied > 0).map((row) => row.id));
      })
      .catch(() => setCandidates([]));
  }, [transaction]);

  if (!transaction) return null;

  const rows = candidates ?? [];
  const wasLinked = rows.some((row) => row.applied > 0);
  // A payment that also covers other spends only counts here for its part.
  const back = rows
    .filter((row) => selected.includes(row.id))
    .reduce((sum, row) => sum + (row.applied > 0 ? row.applied : row.amount), 0);
  const over = back - transaction.amount;

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    if (!transaction || saving) return;
    setSaving(true);
    try {
      await db.netOut(transaction.id, selected);
      onSaved();
    } catch (error) {
      await showMessage("Couldn't net that out", error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible onClose={onClose} title="Net out">
      <View style={styles.hero}>
        <Text style={styles.from}>{transaction.merchant}</Text>
        <Text style={styles.incoming}>−{formatMoney(transaction.amount)}</Text>
      </View>

      <View style={styles.equation}>
        <Figure label="Spent" amount={transaction.amount} />
        <Text style={styles.operator}>−</Text>
        <Figure label="Paid back" amount={back} tone={palette.good} />
        <Text style={styles.operator}>=</Text>
        <Figure label="Yours" amount={Math.max(0, transaction.amount - back)} emphasis />
      </View>

      {over > 0.009 ? (
        <Text style={[styles.meterText, { color: palette.warning }]}>
          That's {formatMoney(over)} more than this cost. Open the bigger payment and net it out
          from there.
        </Text>
      ) : null}

      <Button
        label={saving ? 'Saving…' : selected.length === 0 && wasLinked ? 'Remove net out' : 'Net out'}
        onPress={save}
        disabled={saving || over > 0.009 || (selected.length === 0 && !wasLinked)}
      />
      {candidates === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>No money came in within 60 days of this.</Text>
      ) : (
        <>
          <Text style={styles.groupLabel}>Money in</Text>
          {rows.map((row) => (
            <CandidateRow
              key={row.id}
              candidate={row}
              selected={selected.includes(row.id)}
              covers={row.amount}
              onPress={() => toggle(row.id)}
              incoming
            />
          ))}
        </>
      )}

    </Sheet>
  );
}
