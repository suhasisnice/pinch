import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';
import * as db from '../db/dbService';
import { TransactionRow } from '../db/types';
import { formatMoney, formatTime } from '../utils/format';
import { amountColor, categoryColor, palette, spacing, typography } from '../theme/theme';
import {
  Card,
  Chip,
  ChipRow,
  EmptyState,
  Group,
  Loading,
  Row,
  Screen,
  ScreenTitle,
  SearchBar,
} from '../components/ui';
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
    setPeriod(currentPeriod ? { start: currentPeriod.startsOn, end: currentPeriod.endsOn } : null);
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
      const day = localDay(at);
      byDay.set(day, [...(byDay.get(day) ?? []), item]);
    }
    return [...byDay.entries()];
  }, [visible, links]);

  if (!rows) {
    return (
      <Screen underHeader scroll={false}>
        <Loading />
      </Screen>
    );
  }

  const totals = summariseFiltered(visible);
  const activeCount = activeFilterCount(filter);

  return (
    <Screen
      underHeader
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={palette.textSecondary}
        />
      }
    >
      <ScreenTitle
        title="Transactions"
        subtitle={`${totals.count} shown · net ${formatMoney(Math.abs(totals.net))} ${totals.net >= 0 ? 'out' : 'in'}`}
      />

      <ChipRow>
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
          onPress={() => setFilterVisible(true)}
        />
      </ChipRow>

      <SearchBar
        value={filter.query}
        onChangeText={(text) => setFilter({ ...filter, query: text })}
        placeholder="Search merchants"
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
          <Group key={day} title={formatDay(day)}>
            {items.map((item) => {
              if (item.type === 'group') {
                return <LinkedGroupRow key={`g${item.key}`} group={item} onOpen={setDetailFor} />;
              }
              const tx = item.transaction;
              return (
                <Row
                  key={tx.id}
                  title={tx.merchant}
                  mark={categoryColor(tx.category)}
                  subtitle={[
                    tx.category ?? 'Uncategorised',
                    tx.source === 'MANUAL' ? 'added by hand' : formatTime(tx.occurred_at),
                  ].join(' · ')}
                  onPress={() => setDetailFor(tx)}
                  right={
                    <Text style={[styles.amount, { color: amountColor(tx.direction) }]}>
                      {tx.direction === 'CREDIT' ? '+' : '−'}
                      {formatMoney(tx.amount)}
                    </Text>
                  }
                />
              );
            })}
          </Group>
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
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The phone's own calendar day, as YYYY-MM-DD. Slicing the ISO string gave
 * the UTC day, which filed a 1 am payment in India under the day before.
 */
function localDay(iso: string | Date): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDay(day: string): string {
  if (day === localDay(new Date())) return 'Today';

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === localDay(yesterday)) return 'Yesterday';

  const [year, month, date] = day.split('-').map(Number);
  const d = new Date(year, month - 1, date);
  const label = `${WEEKDAYS[d.getDay()]}, ${date} ${MONTHS[month - 1]}`;
  return year === new Date().getFullYear() ? label : `${label} ${year}`;
}

const styles = StyleSheet.create({
  note: { ...typography.caption, color: palette.textMuted },
  amount: { ...typography.body, color: palette.textPrimary },
});
