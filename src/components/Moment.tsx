import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { palette, spacing, typography } from '../theme/theme';
import { haptic } from './haptics';
import { duration, easing, useReducedMotion } from './motion';

/**
 * A moment: one line that rises above the tab bar for a couple of seconds,
 * with a confirming tick under the finger (0.9.18). Kept for the few things
 * worth it — payday done, a goal reached, a milestone — so it stays special.
 *
 * No confetti, no modal, nothing to dismiss. A dot in the good green and a
 * sentence; it fades on its own.
 */

const SHOW_MS = 2600;

type Listener = (text: string) => void;
let listener: Listener | null = null;

export function celebrate(text: string) {
  haptic.success();
  listener?.(text);
}

export function MomentHost() {
  const reduced = useReducedMotion();
  const [text, setText] = useState<string | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const queue = useRef<string[]>([]);
  const showing = useRef(false);

  useEffect(() => {
    function next() {
      const line = queue.current.shift();
      if (!line) {
        showing.current = false;
        setText(null);
        return;
      }
      showing.current = true;
      setText(line);
      progress.setValue(reduced ? 1 : 0);
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: reduced ? 0 : duration.short,
          easing,
          useNativeDriver: true,
        }),
        Animated.delay(SHOW_MS),
        Animated.timing(progress, {
          toValue: 0,
          duration: reduced ? 0 : duration.short,
          easing,
          useNativeDriver: true,
        }),
      ]).start(next);
    }
    listener = (line) => {
      queue.current.push(line);
      if (!showing.current) next();
    };
    return () => {
      listener = null;
    };
  }, [progress, reduced]);

  if (!text) return null;

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Animated.View
        accessibilityLiveRegion="polite"
        style={[
          styles.moment,
          {
            opacity: progress,
            transform: [
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
            ],
          },
        ]}
      >
        <View style={styles.dot} />
        <Text style={styles.text}>{text}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.gutter,
    right: spacing.gutter,
    bottom: 96,
    alignItems: 'center',
  },
  moment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: palette.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.good },
  text: { ...typography.body, color: palette.textPrimary },
});
