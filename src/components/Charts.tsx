import React, { useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, StyleSheet, Text, View } from 'react-native';
import { haptic } from './haptics';
import { layer, palette, spacing, typography } from '../theme/theme';

/**
 * Charts you touch (0.9.25). Press and slide along one and the piece under
 * your finger lights up while its figure shows in the `Readout` above it, the
 * way a stocks app works. A selection stays after you let go, so it can be read.
 *
 * Plain views, not a chart library: bars and one strip do not justify the
 * bundle. Colour stays information: a selected piece wears its own colour, the
 * rest dim back to ink, so nothing here is a rainbow.
 */

/** The share of the width at which each piece starts, plus 1 at the end. */
type Edges = number[];

/**
 * A horizontal scrub over pieces laid side by side. Children never receive
 * the touch (`pointerEvents="none"`), so positions are always relative to the
 * whole strip rather than whichever bar happened to be under the finger.
 */
function useScrub(edges: Edges, selected: number | null, onSelect: (index: number) => void) {
  const [width, setWidth] = useState(0);
  const latest = useRef({ edges, selected, onSelect, width, origin: 0 });
  latest.current = { ...latest.current, edges, selected, onSelect, width };

  const responder = useMemo(() => {
    const pick = (x: number) => {
      const { edges: e, width: w, selected: current, onSelect: select } = latest.current;
      if (w <= 0 || e.length < 2) return;
      const at = Math.min(Math.max(x / w, 0), 0.9999);
      let index = 0;
      while (index < e.length - 2 && at >= e[index + 1]) index += 1;
      if (index !== current) {
        haptic.scrub();
        select(index);
      }
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // A sideways drag is a scrub; an upward one belongs to the page's scroll.
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: (event, g) => {
        latest.current.origin = g.x0 - event.nativeEvent.locationX;
        pick(event.nativeEvent.locationX);
      },
      onPanResponderMove: (_, g) => pick(g.moveX - latest.current.origin),
      // Until the finger has clearly gone sideways, let a scroll take over.
      onPanResponderTerminationRequest: (_, g) => Math.abs(g.dx) < 8,
    });
  }, []);

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  return { handlers: responder.panHandlers, onLayout };
}

/** Screen-reader access: swipe up or down to step through the pieces. */
function adjustable(count: number, selected: number | null, onSelect: (i: number) => void) {
  return {
    accessible: true,
    accessibilityRole: 'adjustable' as const,
    accessibilityActions: [{ name: 'increment' as const }, { name: 'decrement' as const }],
    onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => {
      const from = selected ?? count - 1;
      const step = event.nativeEvent.actionName === 'increment' ? 1 : -1;
      const next = Math.min(Math.max(from + step, 0), count - 1);
      if (next !== from) onSelect(next);
    },
  };
}

export type Bar = {
  key: string;
  value: number;
  /** Shown under the bar (months, weekdays). Leave out for dense charts. */
  label?: string;
  /** The bar's colour when it matters (over the limit); ink otherwise. */
  color?: string;
};

/** Vertical bars you can scrub. The selected one is lit; the rest dim back. */
export function ScrubBars({
  bars,
  selected,
  onSelect,
  describe,
  height = 96,
  limit,
  edgeLabels,
}: {
  bars: Bar[];
  selected: number | null;
  onSelect: (index: number) => void;
  /** What a screen reader says for a bar. */
  describe: (index: number) => string;
  height?: number;
  /** A hairline at this value, such as the daily limit. */
  limit?: number;
  /** For dense charts: a label under the first and the last bar. */
  edgeLabels?: [string, string];
}) {
  const edges = useMemo(() => bars.map((_, i) => i / bars.length).concat(1), [bars]);
  const scrub = useScrub(edges, selected, onSelect);
  const max = Math.max(...bars.map((b) => b.value), limit ?? 0, 1);
  const dense = bars.length > 12;
  const anyLabels = bars.some((b) => b.label);

  return (
    <View
      {...adjustable(bars.length, selected, onSelect)}
      accessibilityLabel={selected !== null ? describe(selected) : describe(bars.length - 1)}
    >
      <View
        style={[styles.bars, { height, gap: dense ? 3 : spacing.sm }]}
        onLayout={scrub.onLayout}
        {...scrub.handlers}
      >
        {limit && limit > 0 ? (
          <View pointerEvents="none" style={[styles.limit, { bottom: (limit / max) * height }]} />
        ) : null}
        {bars.map((bar, i) => {
          const lit = selected === i;
          return (
            <View key={bar.key} pointerEvents="none" style={styles.slot}>
              <View
                style={[
                  styles.bar,
                  {
                    height: Math.max(3, (bar.value / max) * height),
                    backgroundColor:
                      bar.color ?? (lit ? palette.textPrimary : layer(palette.textPrimary, 0.3)),
                    opacity: selected === null || lit ? 1 : bar.color ? 0.45 : 0.8,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>
      {anyLabels ? (
        <View style={[styles.labels, { gap: dense ? 3 : spacing.sm }]} pointerEvents="none">
          {bars.map((bar, i) => (
            <Text key={bar.key} style={[styles.label, selected === i && styles.labelLit]}>
              {bar.label ?? ''}
            </Text>
          ))}
        </View>
      ) : edgeLabels ? (
        <View style={styles.edgeLabels} pointerEvents="none">
          <Text style={styles.label}>{edgeLabels[0]}</Text>
          <Text style={styles.label}>{edgeLabels[1]}</Text>
        </View>
      ) : null}
    </View>
  );
}

export type Share = { key: string; value: number; color: string };

/**
 * One strip split by share, like a storage bar. Only the selected piece wears
 * its colour; the others are ink, so ten categories never become a rainbow.
 */
export function ShareStrip({
  shares,
  selected,
  onSelect,
  describe,
}: {
  shares: Share[];
  selected: number | null;
  onSelect: (index: number) => void;
  describe: (index: number) => string;
}) {
  const total = shares.reduce((sum, s) => sum + Math.max(0, s.value), 0) || 1;
  const edges = useMemo(() => {
    const out = [0];
    shares.forEach((s) => out.push(out[out.length - 1] + Math.max(0, s.value) / total));
    return out;
  }, [shares, total]);
  const scrub = useScrub(edges, selected, onSelect);

  return (
    <View
      {...adjustable(shares.length, selected, onSelect)}
      accessibilityLabel={describe(selected ?? 0)}
      style={styles.stripHit}
      onLayout={scrub.onLayout}
      {...scrub.handlers}
    >
      <View style={styles.strip} pointerEvents="none">
        {shares.map((share, i) => (
          <View
            key={share.key}
            style={{
              flex: Math.max(0, share.value) / total,
              backgroundColor:
                selected === i ? share.color : layer(palette.textPrimary, i % 2 ? 0.14 : 0.2),
            }}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * What the chart under it is pointing at: a small name, then the figure, thin,
 * with one short note beside it.
 */
export function Readout({
  name,
  value,
  note,
  noteColor = palette.textSecondary,
  mark,
}: {
  name: string;
  value: string;
  note?: string;
  noteColor?: string;
  /** A category's dot beside the name. */
  mark?: string;
}) {
  return (
    <View style={styles.readout} accessibilityLiveRegion="polite">
      <View style={styles.readoutName}>
        {mark ? <View style={[styles.mark, { backgroundColor: mark }]} /> : null}
        <Text style={styles.name}>{name}</Text>
      </View>
      <View style={styles.readoutFigure}>
        <Text style={styles.value}>{value}</Text>
        {note ? <Text style={[styles.note, { color: noteColor }]}>{note}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bars: { flexDirection: 'row', alignItems: 'flex-end' },
  slot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  limit: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: palette.warning,
    opacity: 0.55,
  },
  labels: { flexDirection: 'row', marginTop: spacing.sm },
  label: {
    ...typography.caption,
    fontSize: 12,
    color: palette.textMuted,
    flex: 1,
    textAlign: 'center',
  },
  labelLit: { color: palette.textPrimary },
  edgeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },

  // A taller touch target than the strip itself, so a thumb can find it.
  stripHit: { paddingVertical: spacing.sm },
  strip: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    gap: 2,
  },

  readout: { gap: 2, marginBottom: spacing.md },
  readoutName: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: { width: 8, height: 8, borderRadius: 4 },
  name: { ...typography.caption, color: palette.textMuted },
  readoutFigure: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  value: {
    ...typography.display,
    fontWeight: '300',
    letterSpacing: -0.8,
    color: palette.textPrimary,
  },
  note: { ...typography.caption },
});
