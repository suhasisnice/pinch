import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Text, TextStyle, ViewStyle } from 'react-native';
import { formatMoney } from '../utils/format';

/**
 * The app's motion vocabulary, built on React Native's own Animated.
 *
 * Deliberately not Reanimated: this is an Expo managed project, and a new
 * native dependency would mean a prebuild and a version pin for the sake of
 * effects that the built-in driver handles at sixty frames a second.
 *
 * Everything here checks reduce-motion first. Someone who has turned that on
 * at the system level is usually not asking for a calmer aesthetic, and a
 * money screen is the last place to argue with them — they still get every
 * number, just immediately.
 */

/** Durations, in milliseconds. Short enough to feel like feedback, not a wait. */
export const duration = {
  /** Press states and other direct responses to a finger. */
  instant: 120,
  /** Micro-interactions: a button taking a state layer. */
  short: 200,
  /** Cards arriving, sheets settling. The MD3 standard. */
  quick: 300,
  /** Large surfaces: a sheet coming up from the bottom. */
  long: 450,
  /** A number counting to its new value. */
  count: 650,
} as const;

/**
 * Material You's signature curve — "emphasized decelerate". Moves off
 * quickly and settles without bouncing, which is what makes MD3 motion read
 * as confident rather than either robotic or springy. Everything in the app
 * that moves uses this one curve; that consistency is most of the effect.
 */
export const easing = Easing.bezier(0.2, 0, 0, 1);

/**
 * Tracks the system "reduce motion" setting, and keeps tracking it — people
 * turn it on mid-session precisely when they start feeling unwell.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduced(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return reduced;
}

/**
 * Eases a number towards its target and reports each step.
 *
 * The animated value cannot drive text on the native thread, so this one runs
 * in JS and rounds to whole rupees before re-rendering: paise ticking past at
 * sixty frames a second is noise, not information.
 */
export function useCountUp(value: number): number {
  const reduced = useReducedMotion();
  const safe = Number.isFinite(value) ? value : 0;

  const animated = useRef(new Animated.Value(safe)).current;
  const [displayed, setDisplayed] = useState(safe);
  // The first number to arrive is the truth, not a change to animate from —
  // counting up from zero on launch would make every cold start feel slow.
  const seeded = useRef(false);

  useEffect(() => {
    const id = animated.addListener(({ value: v }) => setDisplayed(Math.round(v)));
    return () => animated.removeListener(id);
  }, [animated]);

  useEffect(() => {
    if (!seeded.current || reduced) {
      seeded.current = true;
      animated.setValue(safe);
      setDisplayed(safe);
      return;
    }

    const animation = Animated.timing(animated, {
      toValue: safe,
      duration: duration.count,
      easing,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [safe, animated, reduced]);

  return displayed;
}

/** A money figure that counts to each new value instead of blinking to it. */
export function AnimatedMoney({
  amount,
  style,
  numberOfLines,
  adjustsFontSizeToFit,
}: {
  amount: number;
  style?: TextStyle | TextStyle[];
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
}) {
  const displayed = useCountUp(amount);
  return (
    <Text style={style} numberOfLines={numberOfLines} adjustsFontSizeToFit={adjustsFontSizeToFit}>
      {formatMoney(displayed)}
    </Text>
  );
}

/**
 * Fades and lifts its children into place, optionally after a delay.
 *
 * Used to stagger a screen's cards so the eye is walked down the page in the
 * order the information matters, rather than being handed all of it at once.
 */
export function FadeSlideIn({
  children,
  delay = 0,
  distance = 12,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  style?: ViewStyle;
}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: duration.quick,
      delay,
      easing,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, delay, reduced]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [distance, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Press feedback as a slight give under the finger.
 *
 * Returns handlers and a style to spread onto an Animated.View. Scale reads as
 * physical in a way that an opacity dip does not, and it survives on a dark
 * background where a dimmed surface mostly just disappears.
 */
export function usePressScale(scale = 0.97) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(1)).current;

  const to = (toValue: number) => {
    if (reduced) return;
    Animated.timing(value, {
      toValue,
      duration: duration.instant,
      easing,
      useNativeDriver: true,
    }).start();
  };

  return {
    onPressIn: () => to(scale),
    onPressOut: () => to(1),
    style: { transform: [{ scale: value }] },
  };
}
