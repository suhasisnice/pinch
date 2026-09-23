import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';
import * as db from '../db/dbService';
import { TransactionRow } from '../db/types';
import { formatMoney } from '../utils/format';
import { categoryColor, palette, spacing, typography } from '../theme/theme';
import { Card, Chip, Dot, EmptyState, Field, Loading, Row, Screen, ScreenTitle } from '../components/ui';
import Icon from '../components/Icon';
import TransactionDetailSheet from '../components/TransactionDetailSheet';
import MarkAsLoanSheet from '../components/MarkAsLoanSheet';
import SplitModal from '../components/SplitModal';
import { RootStackParamList } from '../navigation/RootNavigator';
import FilterSheet from '../components/FilterSheet';
import ReimburseLinkSheet from '../components/ReimburseLinkSheet';
import LinkedGroupRow from '../components/LinkedGroupRow';
import { LedgerItem, ReimbursementLink, groupLinkedTransactions } from '../math/reimbursement';
import {
  EMPTY_FILTER,
  TransactionFilter,
  activeFilterCount,
  applyTransactionFilter,
  summariseFiltered,
} from '../math/transactionFilter';

/** The handful worth one tap; everything else lives in the filter sheet. */
const QUICK_RANGES: Array<{ key: TransactionFilter['range']; label: string }> = [
  { key: 'ALL', label: 'All time' },
  { key: 'TODAY', label: 'Today' },
  { key: 'WEEK', label: '7 days' },
  { key: 'MONTH', label: 'This month' },
];

/**
 * Every transaction, in one list.
 *
 * Split by what the bank did rather than by category, because that is the
 * question people actually arrive with — "what came out of my account" — and
 * it is the same distinction the parser now enforces on the way in.
 */
export default function TransactionsScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Transactions'>>();
  const [rows, setRows] = useState<TransactionRow[] | null>(null);
  const [owedByTx, setOwedByTx] = useState<Map<number, number>>(new Map());
  const [period, setPeriod] = useState<{ start: string; end: string } | null>(null);
  const [filter, setFilter] = useState<TransactionFilter>({
    ...EMPTY_FILTER,
    // Insights' drill-down ("View food spending →") arrives with a category
    // already chosen.
    categories: route.params?.category ? [route.params.category] : [],
  });
  const [filterVisible, setFilterVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [detailFor, setDetailFor] = useState<TransactionRow | null>(null);
  const [loanFor, setLoanFor] = useState<TransactionRow | null>(null);
  const [splitFor, setSplitFor] = useState<TransactionRow | null>(null);
  const [linkFor, setLinkFor] = useState<TransactionRow | null>(null);
  const [links, setLinks] = useState<ReimbursementLink[]>([]);

  const load = useCallback(async () => {
    // One list, filtered in memory. getAllTransactions already carries the
    // excluded ones with their excluded_at set, which is what the filter
    // reads — so there is no second query and no way for the two lists to
    // disagree about what is ignored.
    const [all, owed, currentPeriod, linked] = await Promise.all([
      db.getAllTransactions(),
      db.getOpenReceivableByTransaction(),
      db.getCurrentBudgetPeriod(),
      db.getReimbursementLinks(),
    ]);
    setRows(all);
    setLinks(linked);
    setOwedByTx(owed);
    setPeriod(
      currentPeriod ? { start: currentPeriod.startsOn, end: currentPeriod.endsOn } : null
    );
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

  const visible = useMemo(
    () =>
      applyTransactionFilter(rows ?? [], filter, {
        now: new Date(),
        periodStart: period?.start ?? null,
        periodEnd: period?.end ?? null,
        owedByTransaction: owedByTx,
      }),
    [rows, filter, period, owedByTx]
  );

  // A repayment and what it paid back fold into one line at the net, filed
  // under the day it was squared up. Only what the filter is showing takes
  // part — see groupLinkedTransactions.
  const grouped = useMemo(() => {
    const byDay = new Map<string, LedgerItem[]>();
    for (const item of groupLinkedTransactions(visible, links)) {
      const at = item.type === 'group' ? item.occurredAt : item.transaction.occurred_at;
      const day = at.slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), item]);
    }
    return [...byDay.entries()];
  }, [visible, links]);

  if (!rows) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const totals = summariseFiltered(visible);
  const activeCount = activeFilterCount(filter);

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.textSecondary} />
      }
    >
      <ScreenTitle
        title="Transactions"
        subtitle={`${totals.count} shown · net ${formatMoney(Math.abs(totals.net))} ${totals.net >= 0 ? 'out' : 'in'}`}
      />

      <View style={styles.filterRow}>
        {QUICK_RANGES.map((option) => (
          <Chip
            key={option.key}
            label={option.label}
            selected={filter.range === option.key}
            onPress={() => setFilter({ ...filter, range: option.key })}
          />
        ))}
        {/* Carries the count, so a filtered list never looks like an empty one. */}
        <Chip
          label={activeCount > 0 ? `Filters · ${activeCount}` : 'Filters'}
          selected={activeCount > 0}
          color={palette.info}
          onPress={() => setFilterVisible(true)}
        />
      </View>

      <Field
        label="Search"
        value={filter.query}
        onChangeText={(text) => setFilter({ ...filter, query: text })}
        placeholder="Merchant name"
      />

      {filter.showIgnored ? (
        <Text style={styles.note}>Removed from your totals. Open one to put it back.</Text>
      ) : null}

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={filter.showIgnored ? 'check' : 'empty'}
            title={filter.showIgnored ? 'Nothing ignored' : 'No transactions'}
            body={
              activeCount > 0
                ? 'Nothing matches these filters. Clear a few to widen the search.'
                : 'Captured payments land here automatically, or add one by hand from Today.'
            }
          />
        </Card>
      ) : (
        grouped.map(([day, items]) => (
          <Card key={day}>
            <Text style={styles.dayLabel}>{formatDay(day)}</Text>
            {items.map((item) => {
              if (item.type === 'group') {
                return <LinkedGroupRow key={`g${item.key}`} group={item} onOpen={setDetailFor} />;
              }
              const tx = item.transaction;
              return (
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
                      style={[styles.amount, tx.direction === 'CREDIT' && { color: palette.accent }]}
                    >
                      {tx.direction === 'CREDIT' ? '+' : '−'}
                      {formatMoney(tx.amount)}
                    </Text>
                  }
                />
              );
            })}
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
        onMarkLoan={(tx) => {
          setDetailFor(null);
          setLoanFor(tx);
        }}
        onLinkReimbursement={(tx) => {
          setDetailFor(null);
          setLinkFor(tx);
        }}
      />

      <ReimburseLinkSheet
        transaction={linkFor}
        onClose={() => setLinkFor(null)}
        onSaved={() => {
          setLinkFor(null);
          load();
        }}
      />

      <MarkAsLoanSheet
        transaction={loanFor}
        onClose={() => setLoanFor(null)}
        onSaved={() => {
          setLoanFor(null);
          load();
        }}
      />

      <FilterSheet
        visible={filterVisible}
        filter={filter}
        onChange={setFilter}
        onClose={() => setFilterVisible(false)}
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
    ...typography.sectionLabel,
    color: palette.textSecondary,
    marginBottom: spacing.xs,
  },
  amount: { ...typography.bodyBold, color: palette.textPrimary },
});
