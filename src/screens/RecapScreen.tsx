import React, { useCallback, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as db from '../db/dbService';
import { getBudgetSnapshot } from '../services/budgetService';
import { getMonthlyAllowance } from '../settings/settingsStore';
import { RecapSlide, WeeklyRecap, buildWeeklyRecap, lastCompletedWeek } from '../math/weeklyRecap';
import { AnimatedMoney, FadeSlideIn } from '../components/motion';
import { Button, EmptyState, Loading } from '../components/ui';
import Icon from '../components/Icon';
import MoneyAmount from '../components/Money';
import { palette, spacing, typography } from '../theme/theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 24 * 60 * 60 * 1000;

/** "14–20 Sep", or "28 Sep – 4 Oct" across a month boundary. */
export function weekRange(start: Date, end: Date): string {
  return start.getMonth() === end.getMonth()
    ? `${start.getDate()}–${end.getDate()} ${MONTHS[end.getMonth()]}`
    : `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]}`;
}

/** Loads last week's recap, or null when last week had no spending. */
export async function loadWeeklyRecap(now: Date = new Date()): Promise<WeeklyRecap | null> {
  const { start, end } = lastCompletedWeek(now);
  const before = new Date(start.getTime() - 7 * DAY_MS);
  const [allowance, spends, previous] = await Promise.all([
    getMonthlyAllowance(),
    db.getSpendsWithShare(start.toISOString(), end.toISOString()),
    db.getSpendsWithShare(before.toISOString(), start.toISOString()),
  ]);
  const snapshot = await getBudgetSnapshot(allowance);
  return buildWeeklyRecap({
    weekStart: start,
    spends,
    previousWeekYours:
      previous.length > 0 ? previous.reduce((sum, s) => sum + s.amount - s.splitAway, 0) : null,
    dailyLimit: snapshot.budget.dailyLimit,
  });
}

/**
 * Last week as a few full-screen slides, one number each. Swipe or tap the
 * right half for the next, the left half to go back.
 *
 * Deliberately the app's own dark canvas and type rather than a burst of
 * colour: the numbers are the show. Nothing on a slide is invented — every
 * figure is a sum of real transactions (see `math/weeklyRecap.ts`).
 */
export default function RecapScreen() {
  const navigation = useNavigation<any>();
  const window = useWindowDimensions();
  // The pager's own width, not the window's: they differ on a foldable, in
  // split screen, and in the web preview's phone frame, and a page one
  // pixel wider than its pager cuts the text off the right edge.
  const [width, setWidth] = useState(window.width);
  const scroller = useRef<ScrollView>(null);
  const [recap, setRecap] = useState<WeeklyRecap | null | undefined>(undefined);
  const [index, setIndex] = useState(0);

  useFocusEffect(
    useCallback(() => {
      loadWeeklyRecap()
        .then(setRecap)
        .catch(() => setRecap(null));
    }, [])
  );

  const close = () => navigation.goBack();

  if (recap === undefined) {
    return (
      <SafeAreaView style={styles.screen}>
        <Loading />
      </SafeAreaView>
    );
  }

  if (recap === null) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.topBar}>
          <View style={styles.flex} />
          <CloseButton onPress={close} />
        </View>
        <EmptyState
          icon="insights"
          title="No recap this week"
          body="Last week had no spending to look back on."
        />
      </SafeAreaView>
    );
  }

  const slides = recap.slides;
  const last = index === slides.length - 1;

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(slides.length - 1, next));
    setIndex(clamped);
    scroller.current?.scrollTo({ x: clamped * width, animated: true });
  };

  const onSettle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  return (
    <SafeAreaView style={styles.screen}>
      {/* One segment per slide, like stories: you can see how long this is. */}
      <View style={styles.progress}>
        {slides.map((slide, i) => (
          <View key={slide.id} style={[styles.segment, i <= index && styles.segmentDone]} />
        ))}
      </View>
      <View style={styles.topBar}>
        <Text style={styles.week}>Week of {weekRange(recap.weekStart, recap.weekEnd)}</Text>
        <CloseButton onPress={close} />
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onSettle}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={styles.flex}
      >
        {slides.map((slide, i) => (
          <Pressable
            key={slide.id}
            style={[styles.slide, { width }]}
            onPress={(event) => goTo(event.nativeEvent.locationX < width / 3 ? i - 1 : i + 1)}
            accessibilityRole="button"
            accessibilityLabel={`${describe(slide)}. Next`}
          >
            {/* Keyed on visibility so each slide animates in when it arrives. */}
            {i === index ? (
              <SlideBody key={`on-${slide.id}`} slide={slide} />
            ) : (
              <SlideBody slide={slide} still />
            )}
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        {last ? (
          <Button label="Done" onPress={close} />
        ) : (
          <Text style={styles.hint}>
            {index + 1} of {slides.length}
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

function SlideBody({ slide, still = false }: { slide: RecapSlide; still?: boolean }) {
  const colour = slide.good ? palette.accent : palette.textPrimary;
  const body = (
    <View style={styles.slideBody}>
      <Text style={styles.eyebrow}>{slide.eyebrow}</Text>
      {slide.amount !== undefined ? (
        still ? (
          <MoneyAmount
            amount={slide.amount}
            style={[styles.figure, { color: colour }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          />
        ) : (
          <AnimatedMoney
            amount={slide.amount}
            style={[styles.figure, { color: colour }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          />
        )
      ) : (
        <Text style={[styles.figure, { color: colour }]} numberOfLines={2} adjustsFontSizeToFit>
          {slide.figure}
        </Text>
      )}
      <Text style={styles.line}>{slide.line}</Text>
    </View>
  );
  return still ? body : <FadeSlideIn distance={16}>{body}</FadeSlideIn>;
}

function CloseButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Close recap"
    >
      <Icon name="close" size={24} color={palette.textSecondary} />
    </Pressable>
  );
}

function describe(slide: RecapSlide): string {
  const figure =
    slide.amount !== undefined
      ? `₹${Math.round(slide.amount).toLocaleString('en-IN')}`
      : (slide.figure ?? '');
  return `${slide.eyebrow} ${figure}. ${slide.line}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  flex: { flex: 1 },

  progress: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.sm,
  },
  segment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: palette.surfaceElevated },
  segmentDone: { backgroundColor: palette.textPrimary },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.md,
  },
  week: { ...typography.caption, fontWeight: '600', color: palette.textSecondary },

  slide: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.gutter },
  slideBody: { gap: spacing.sm, paddingBottom: spacing.xxl },
  eyebrow: { ...typography.cardTitle, color: palette.textSecondary },
  figure: { ...typography.hero, fontSize: 56, lineHeight: 62, letterSpacing: -1.5 },
  line: { ...typography.body, fontSize: 18, lineHeight: 26, color: palette.textPrimary },

  footer: {
    minHeight: 72,
    justifyContent: 'center',
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.md,
  },
  hint: { ...typography.caption, color: palette.textMuted, textAlign: 'center' },
});
