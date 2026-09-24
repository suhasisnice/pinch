import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { layer, palette, spacing, typography } from '../theme/theme';
import { duration, easing, useReducedMotion } from './motion';

export interface WeekDay {
  /** "M", "T", … */
  label: string;
  total: number;
  isToday: boolean;
  isFuture: boolean;
}

const HEIGHT = 64;

/**
 * This week at a glance: one column per day, measured against the daily
 * limit (the faint line). Under it and the day is quiet; over it and it
 * turns amber; today is the one lit column.
 *
 * It replaces a thin progress bar that said one thing — how much of today is
 * gone — with a picture of the rhythm that produced today's number, which is
 * the thing a person can actually change.
 */
export default function WeekStrip({ days, limit }: { days: WeekDay[]; limit: number }) {
  const peak = Math.max(limit * 1.4, ...days.map((d) => d.total), 1);
  const limitY = Math.min(HEIGHT, (limit / peak) * HEIGHT);

  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityLabel={`This week: ${days
        .filter((d) => !d.isFuture)
        .map((d) => `${d.label} ${Math.round(d.total)} rupees`)
        .join(', ')}. Daily limit ${Math.round(limit)} rupees.`}
    >
      <View style={styles.chart}>
        {limit > 0 ? <View style={[styles.limit, { bottom: limitY }]} /> : null}
        {days.map((day, i) => (
          <Column key={i} day={day} limit={limit} height={(day.total / peak) * HEIGHT} index={i} />
        ))}
      </View>
      <View style={styles.labels}>
        {days.map((day, i) => (
          <Text key={i} style={[styles.label, day.isToday && styles.labelToday]}>
            {day.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Column({
  day,
  limit,
  height,
  index,
}: {
  day: WeekDay;
  limit: number;
  height: number;
  index: number;
}) {
  const reduced = useReducedMotion();
  const grow = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) {
      grow.setValue(1);
      return;
    }
    Animated.timing(grow, {
      toValue: 1,
      duration: duration.short,
      delay: 40 + index * 25,
      easing,
      useNativeDriver: false,
    }).start();
  }, [grow, index, reduced]);

  const over = limit > 0 && day.total > limit;
  const color = day.isFuture
    ? palette.surfaceElevated
    : over
      ? palette.warning
      : day.isToday
        ? palette.accent
        : layer(palette.textPrimary, 0.22);
  // A day with nothing spent still gets a stub, so the week reads as seven
  // days rather than as gaps.
  const target = day.isFuture ? 4 : Math.max(4, height);

  return (
    <View style={styles.column}>
      <Animated.View
        style={[
          styles.bar,
          {
            backgroundColor: color,
            height: grow.interpolate({ inputRange: [0, 1], outputRange: [4, target] }),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md, gap: 6 },
  chart: { height: HEIGHT, flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  limit: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: layer(palette.textPrimary, 0.22),
  },
  column: { flex: 1, height: HEIGHT, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 6 },
  labels: { flexDirection: 'row', gap: spacing.sm },
  label: {
    ...typography.caption,
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    color: palette.textMuted,
  },
  labelToday: { color: palette.textPrimary, fontWeight: '700' },
});
