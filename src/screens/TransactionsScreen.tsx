import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as db from '../db/dbService';
import { TransactionRow } from '../db/types';
import { formatMoney } from '../utils/format';
import { categoryColor, palette, spacing, typography } from '../theme/theme';
import { Card, Chip, Dot, EmptyState, Field, Loading, Row, Screen, ScreenTitle } from '../components/ui';
import Icon from '../components/Icon';
import TransactionDetailSheet from '../components/TransactionDetailSheet';
import SplitModal from '../components/SplitModal';

type Filter = 'ALL' | 'OUT' | 'IN' | 'IGNORED';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'OUT', label: 'Debited' },
  { key: 'IN', label: 'Credited' },
  { key: 'IGNORED', label: 'Ignored' },
];

/**
 * Every transaction, in one list.
 *
 * Split by what the bank did rather than by category, because that is the
 * question people actually arrive with — "what came out of my account" — and
 * it is the same distinction the parser now enforces on the way in.
 */
export default function TransactionsScreen() {
  const [rows, setRows] = useState<TransactionRow[] | null>(null);
  const [ignored, setIgnored] = useState<TransactionRow[]>([]);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [detailFor, setDetailFor] = useState<TransactionRow | null>(null);
  const [splitFor, setSplitFor] = useState<TransactionRow | null>(null);

  const load = useCallback(async () => {
    const [all, excluded] = await Promise.all([
      db.getAllTransactions(),
      db.getExcludedTransactions(),
    ]);
    // getAllTransactions has no opinion about exclusions, so filter here and
    // keep the ignored ones for their own tab.
    const excludedIds = new Set(excluded.map((t) => t.id));
    setRows(all.filter((t) => !excludedIds.has(t.id)));
    setIgnored(excluded);
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

  const visible = useMemo(() => {
    const source = filter === 'IGNORED' ? ignored : (rows ?? []);
    const needle = query.trim().toLowerCase();

    return source.filter((tx) => {
      if (filter === 'OUT' && tx.direction !== 'DEBIT') return false;
      if (filter === 'IN' && tx.direction !== 'CREDIT') return false;
      if (needle && !tx.merchant.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, ignored, filter, query]);

  const grouped = useMemo(() => {
    const byDay = new Map<string, TransactionRow[]>();
    for (const tx of visible) {
      const day = tx.occurred_at.slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), tx]);
    }
    return [...byDay.entries()];
  }, [visible]);

  if (!rows) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const total = visible.reduce(
    (sum, tx) => sum + (tx.direction === 'DEBIT' ? tx.amount : -tx.amount),
    0
  );

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.textSecondary} />
      }
    >
      <ScreenTitle
        title="Transactions"
        subtitle={`${visible.length} shown · net ${formatMoney(Math.abs(total))} ${total >= 0 ? 'out' : 'in'}`}
      />

      <View style={styles.filterRow}>
        {FILTERS.map((option) => (
          <Chip
            key={option.key}
            label={option.label}
            selected={filter === option.key}
            onPress={() => setFilter(option.key)}
            color={option.key === 'IGNORED' ? palette.warningAmber : palette.neonGreen}
          />
        ))}
      </View>

      <Field label="Search" value={query} onChangeText={setQuery} placeholder="Merchant name" />

      {filter === 'IGNORED' ? (
        <Text style={styles.note}>
          Removed from your totals. Open one to put it back.
        </Text>
      ) : null}

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={filter === 'IGNORED' ? 'check' : 'empty'}
            title={filter === 'IGNORED' ? 'Nothing ignored' : 'No transactions'}
            body={
              query
                ? 'Nothing matches that search.'
                : 'Captured payments land here automatically, or add one by hand from Today.'
            }
          />
        </Card>
      ) : (
        grouped.map(([day, items]) => (
          <Card key={day}>
            <Text style={styles.dayLabel}>{formatDay(day)}</Text>
            {items.map((tx) => (
              <Row
                key={tx.id}
                left={<Dot color={categoryColor(tx.category)} />}
                title={tx.merchant}
                subtitle={[
                  tx.category ?? 'Uncategorised',
                  tx.source === 'MANUAL' ? 'by hand' : tx.source.toLowerCase(),
                ].join(' · ')}
                onPress={() => setDetailFor(tx)}
                right={
                  <Text
                    style={[styles.amount, tx.direction === 'CREDIT' && { color: palette.mint }]}
                  >
                    {tx.direction === 'CREDIT' ? '+' : '−'}
                    {formatMoney(tx.amount)}
                  </Text>
                }
              />
            ))}
          </Card>
        ))
      )}

      <TransactionDetailSheet
        transaction={detailFor}
        onClose={() => setDetailFor(null)}
        onChanged={load}
        onSplit={(tx) => {
          setDetailFor(null);
          setSplitFor(tx);
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
    </Screen>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDay(day: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (day === today) return 'Today';

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.toISOString().slice(0, 10)) return 'Yesterday';

  const [year, month, date] = day.split('-');
  return `${Number(date)} ${MONTHS[Number(month) - 1]} ${year}`;
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  note: { ...typography.caption, color: palette.textMuted },
  dayLabel: {
    ...typography.micro,
    color: palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  amount: { ...typography.bodyBold, color: palette.textPrimary },
});
