import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CaptureSource } from '../db/types';
import { CATEGORIES } from '../db/schema';
import {
  DATE_RANGE_LABELS,
  DateRangePreset,
  EMPTY_FILTER,
  TransactionFilter,
  isFilterEmpty,
} from '../math/transactionFilter';
import { palette, spacing, typography } from '../theme/theme';
import { Button, Chip, Field, Sheet } from './ui';

const RANGES: DateRangePreset[] = ['ALL', 'TODAY', 'WEEK', 'MONTH', 'PERIOD', 'CUSTOM'];
const SOURCES: Array<{ value: CaptureSource; label: string }> = [
  { value: 'SMS', label: 'SMS' },
  { value: 'NOTIFICATION', label: 'Notification' },
  { value: 'MANUAL', label: 'By hand' },
];

/**
 * Every way of narrowing the ledger, in one place.
 *
 * A sheet rather than a row of chips on the screen itself: there are nine
 * conditions here and putting them all permanently above the list would
 * leave less room for the list than for the controls. What stays on screen
 * is one button carrying a count, so the fact that a filter is on is never
 * hidden — an empty-looking ledger with a quiet filter behind it is the
 * failure worth designing against.
 */
export default function FilterSheet({
  visible,
  filter,
  onChange,
  onClose,
}: {
  visible: boolean;
  filter: TransactionFilter;
  onChange: (next: TransactionFilter) => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<TransactionFilter>) => onChange({ ...filter, ...patch });

  const toggleIn = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  return (
    <Sheet visible={visible} onClose={onClose} title="Filter">
      <View style={styles.group}>
        <Text style={styles.label}>When</Text>
        <View style={styles.wrap}>
          {RANGES.map((range) => (
            <Chip
              key={range}
              label={DATE_RANGE_LABELS[range]}
              selected={filter.range === range}
              onPress={() => set({ range })}
            />
          ))}
        </View>
      </View>

      {filter.range === 'CUSTOM' ? (
        <View style={styles.row}>
          <View style={styles.flex}>
            <Field
              label="From"
              value={filter.customFrom ?? ''}
              onChangeText={(text) => set({ customFrom: text || null })}
              placeholder="2026-09-01"
            />
          </View>
          <View style={styles.flex}>
            <Field
              label="To"
              value={filter.customTo ?? ''}
              onChangeText={(text) => set({ customTo: text || null })}
              placeholder="2026-09-30"
            />
          </View>
        </View>
      ) : null}

      <View style={styles.group}>
        <Text style={styles.label}>Direction</Text>
        <View style={styles.wrap}>
          <Chip label="All" selected={filter.direction === 'ALL'} onPress={() => set({ direction: 'ALL' })} />
          <Chip label="Money out" selected={filter.direction === 'OUT'} onPress={() => set({ direction: 'OUT' })} />
          <Chip label="Money in" selected={filter.direction === 'IN'} onPress={() => set({ direction: 'IN' })} />
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Category</Text>
        <View style={styles.wrap}>
          {[...CATEGORIES, 'Uncategorised'].map((category) => (
            <Chip
              key={category}
              label={category}
              selected={filter.categories.includes(category)}
              onPress={() => set({ categories: toggleIn(filter.categories, category) })}
            />
          ))}
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Where it came from</Text>
        <View style={styles.wrap}>
          {SOURCES.map((source) => (
            <Chip
              key={source.value}
              label={source.label}
              selected={filter.sources.includes(source.value)}
              onPress={() => set({ sources: toggleIn(filter.sources, source.value) })}
            />
          ))}
        </View>
      </View>

      <View style={styles.row}>
        <View style={styles.flex}>
          <Field
            label="At least"
            value={filter.minAmount === null ? '' : String(filter.minAmount)}
            onChangeText={(text) => {
              const parsed = Number(text.replace(/[^\d.]/g, ''));
              set({ minAmount: text.trim() === '' || !Number.isFinite(parsed) ? null : parsed });
            }}
            keyboardType="numeric"
            placeholder="0"
          />
        </View>
        <View style={styles.flex}>
          <Field
            label="At most"
            value={filter.maxAmount === null ? '' : String(filter.maxAmount)}
            onChangeText={(text) => {
              const parsed = Number(text.replace(/[^\d.]/g, ''));
              set({ maxAmount: text.trim() === '' || !Number.isFinite(parsed) ? null : parsed });
            }}
            keyboardType="numeric"
            placeholder="Any"
          />
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Only show</Text>
        <View style={styles.wrap}>
          <Chip
            label="Owed back to me"
            selected={filter.onlyOwedBack}
            onPress={() => set({ onlyOwedBack: !filter.onlyOwedBack })}
          />
          <Chip
            label="Needs a category"
            selected={filter.onlyUncategorised}
            onPress={() => set({ onlyUncategorised: !filter.onlyUncategorised })}
          />
          <Chip
            label="Ignored"
            color={palette.warning}
            selected={filter.showIgnored}
            onPress={() => set({ showIgnored: !filter.showIgnored })}
          />
        </View>
      </View>

      <Button label="Show results" onPress={onClose} />
      <Button
        label="Clear all"
        variant="ghost"
        onPress={() => onChange({ ...EMPTY_FILTER })}
        disabled={isFilterEmpty(filter)}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  label: {
    ...typography.micro,
    color: palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
