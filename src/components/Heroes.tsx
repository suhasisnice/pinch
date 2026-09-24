import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polygon, Polyline } from 'react-native-svg';
import { AnimatedMoney } from './motion';
import { formatMoney, formatMoneyCompact } from '../utils/format';
import { layer, palette, spacing, typography } from '../theme/theme';

/**
 * One hero shape per tab, so each tab is recognisable before you read a word
 * (0.9.17 — the user's answer to "it all feels like one soup"):
 *
 *   Today   a ring        how much of today is left        (Ring.tsx)
 *   Plans   jars          goals filling from the bottom    JarsHero
 *   Wealth  a chart       net worth over the months        ChartHero
 *   People  faces         who owes whom                    FacesHero
 *
 * Today stays centred; the other three are left-aligned, so even the layout
 * of the number is part of where you are. Still ink: the shapes carry the
 * distinction, not new colours.
 */

/** The number, left-aligned, with its label beside the baseline. */
function Figure({ amount, label }: { amount: number; label: string }) {
  return (
    <View style={styles.figure}>
      <AnimatedMoney
        amount={amount}
        style={styles.figureNumeral}
        numberOfLines={1}
        adjustsFontSizeToFit
      />
      <Text style={styles.figureLabel}>{label}</Text>
    </View>
  );
}

function Words({ line, meta }: { line?: string; meta?: string }) {
  if (!line && !meta) return null;
  return (
    <View style={styles.words}>
      {line ? <Text style={styles.line}>{line}</Text> : null}
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Plans — jars
// ---------------------------------------------------------------------------

const JAR_HEIGHT = 112;
const MAX_JARS = 5;

export function JarsHero({
  amount,
  label,
  goals,
  line,
  meta,
}: {
  amount: number;
  label: string;
  goals: { name: string; saved: number; target: number }[];
  line?: string;
  meta?: string;
}) {
  const shown = goals.slice(0, MAX_JARS);
  return (
    <View style={styles.hero}>
      <Figure amount={amount} label={label} />
      {shown.length > 0 ? (
        <View
          style={styles.jars}
          accessibilityLabel={shown
            .map((g) => `${g.name} ${Math.round(fraction(g.saved, g.target) * 100)}%`)
            .join(', ')}
        >
          {shown.map((goal) => {
            const f = fraction(goal.saved, goal.target);
            return (
              <View key={goal.name} style={styles.jarColumn}>
                <Text style={styles.jarPct}>{Math.round(f * 100)}%</Text>
                <View style={styles.jar}>
                  <View style={[styles.jarFill, { height: Math.max(2, f * JAR_HEIGHT) }]} />
                </View>
                <Text style={styles.jarName} numberOfLines={2}>
                  {goal.name}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
      <Words line={line} meta={meta} />
    </View>
  );
}

function fraction(saved: number, target: number): number {
  return target > 0 ? Math.max(0, Math.min(1, saved / target)) : 0;
}

// ---------------------------------------------------------------------------
// Wealth — the chart
// ---------------------------------------------------------------------------

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const CHART_HEIGHT = 132;

export function ChartHero({
  amount,
  label,
  history,
  line,
  meta,
}: {
  amount: number;
  label: string;
  /** Oldest first, month as YYYY-MM. */
  history: { month: string; value: number }[];
  line?: string;
  meta?: string;
}) {
  const [width, setWidth] = useState(0);
  const enough = history.length >= 2;

  let chart: React.ReactNode = null;
  if (enough && width > 0) {
    const pad = 6;
    const values = history.map((h) => h.value);
    // Anchored at zero when every value is positive, so growth looks like
    // what it is rather than a cliff drawn from an arbitrary floor.
    const min = Math.min(0, ...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const points = history.map((h, i) => ({
      x: pad + (i * (width - pad * 2)) / (history.length - 1),
      y: pad + (1 - (h.value - min) / span) * (CHART_HEIGHT - pad * 2),
    }));
    const path = points.map((p) => `${p.x},${p.y}`).join(' ');
    const last = points[points.length - 1];
    const floor = CHART_HEIGHT - pad;
    chart = (
      <Svg width={width} height={CHART_HEIGHT}>
        <Polygon
          points={`${points[0].x},${floor} ${path} ${last.x},${floor}`}
          fill={layer(palette.textPrimary, 0.06)}
        />
        <Line x1={0} y1={floor} x2={width} y2={floor} stroke={palette.border} strokeWidth={1} />
        <Polyline
          points={path}
          fill="none"
          stroke={palette.textPrimary}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Circle cx={last.x} cy={last.y} r={4} fill={palette.textPrimary} />
      </Svg>
    );
  }

  return (
    <View style={styles.hero}>
      <Figure amount={amount} label={label} />
      {enough ? (
        <View
          style={styles.chart}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          accessibilityLabel={`${label} over ${history.length} months, from ${formatMoney(history[0].value)} to ${formatMoney(history[history.length - 1].value)}`}
        >
          {chart}
          <View style={styles.chartMonths}>
            {history.map((h, i) => (
              <Text
                key={h.month}
                style={[styles.chartMonth, i === history.length - 1 && styles.chartMonthNow]}
              >
                {SHORT_MONTHS[Number(h.month.slice(5, 7)) - 1]}
              </Text>
            ))}
          </View>
        </View>
      ) : null}
      <Words line={line} meta={meta} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// People — faces
// ---------------------------------------------------------------------------

const MAX_FACES = 5;
const FACE_MIN = 40;
const FACE_MAX = 64;

export function FacesHero({
  amount,
  label,
  people,
  line,
  meta,
}: {
  amount: number;
  label: string;
  /** Positive: they owe you. Negative: you owe them. */
  people: { name: string; amount: number }[];
  line?: string;
  meta?: string;
}) {
  const open = people
    .filter((p) => Math.abs(p.amount) > 0.009)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, MAX_FACES);
  const biggest = open.length > 0 ? Math.abs(open[0].amount) : 1;

  return (
    <View style={styles.hero}>
      <Figure amount={amount} label={label} />
      {open.length > 0 ? (
        <View style={styles.faces}>
          {open.map((person) => {
            // Size says how much, so the biggest debt is the biggest face.
            const size = FACE_MIN + (FACE_MAX - FACE_MIN) * (Math.abs(person.amount) / biggest);
            const theyOwe = person.amount > 0;
            return (
              <View
                key={person.name}
                style={styles.faceColumn}
                accessibilityLabel={`${person.name} ${theyOwe ? 'owes you' : 'is owed'} ${formatMoney(Math.abs(person.amount))}`}
              >
                <View
                  style={[
                    styles.face,
                    { width: size, height: size, borderRadius: size / 2 },
                    theyOwe ? styles.faceOwesYou : styles.faceYouOwe,
                  ]}
                >
                  <Text style={[styles.initials, !theyOwe && styles.initialsYouOwe]}>
                    {initials(person.name)}
                  </Text>
                </View>
                <Text style={styles.faceAmount}>
                  {theyOwe ? '+' : '−'}
                  {formatMoneyCompact(Math.abs(person.amount))}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
      <Words line={line} meta={meta} />
    </View>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

const styles = StyleSheet.create({
  hero: { paddingTop: spacing.lg, paddingBottom: spacing.md, gap: spacing.lg },

  figure: { gap: 2 },
  figureNumeral: {
    ...typography.numeral,
    color: palette.textPrimary,
    fontSize: 56,
    lineHeight: 64,
    letterSpacing: -2.5,
  },
  figureLabel: { ...typography.caption, color: palette.textMuted },

  words: { gap: spacing.xs },
  line: { ...typography.quip, color: palette.textPrimary },
  meta: { ...typography.caption, color: palette.textMuted },

  // Jars
  jars: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  jarColumn: { flex: 1, maxWidth: 72, alignItems: 'center', gap: spacing.xs },
  jarPct: { ...typography.caption, color: palette.textSecondary },
  jar: {
    width: '100%',
    height: JAR_HEIGHT,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  jarFill: { width: '100%', backgroundColor: palette.textPrimary },
  jarName: {
    ...typography.caption,
    color: palette.textMuted,
    maxWidth: '100%',
    textAlign: 'center',
  },

  // Chart
  chart: { gap: spacing.xs },
  chartMonths: { flexDirection: 'row', justifyContent: 'space-between' },
  chartMonth: { ...typography.caption, color: palette.textMuted },
  chartMonthNow: { color: palette.textPrimary },

  // Faces
  faces: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, flexWrap: 'wrap' },
  faceColumn: { alignItems: 'center', gap: spacing.xs },
  face: { alignItems: 'center', justifyContent: 'center' },
  faceOwesYou: { backgroundColor: palette.textPrimary },
  // Money you owe is the one place People uses the accent: it is the thing to act on.
  faceYouOwe: { borderWidth: 1.5, borderColor: palette.accent },
  initials: { ...typography.bodyBold, color: palette.background },
  initialsYouOwe: { color: palette.accent },
  faceAmount: { ...typography.caption, color: palette.textSecondary },
});
