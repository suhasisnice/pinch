import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { palette } from '../theme/theme';
import { useReducedMotion } from './motion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * A hairline ring that empties as the day's money is spent — the one visual
 * on Today, with the number set inside it.
 *
 * Thin on purpose: a fat donut is a dashboard widget; a 3px ring with a
 * small bead at its end reads as an instrument. A faint glow in the ring's
 * own colour sits behind it — the one place the app uses a gradient, and
 * only because the colour itself is information (fine, careful, over).
 */
export default function Ring({
  fraction,
  color,
  size = 272,
  stroke = 3,
  children,
}: {
  /** 0–1: how much of the ring is still lit (what is left, not what is gone). */
  fraction: number;
  color: string;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const target = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const progress = useRef(new Animated.Value(reduced ? target : 0)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(target);
      return;
    }
    Animated.timing(progress, {
      toValue: target,
      duration: 700,
      easing: Easing.bezier(0.2, 0, 0, 1),
      useNativeDriver: false,
    }).start();
  }, [progress, target, reduced]);

  const r = (size - stroke) / 2 - 10;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const dashOffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
            {/* A halo hugging the ring, not a filled disc behind the number. */}
            <Stop offset="0.72" stopColor={color} stopOpacity={0} />
            <Stop offset="0.9" stopColor={color} stopOpacity={0.07} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={c} cy={c} r={size / 2} fill="url(#glow)" />
        <Circle
          cx={c}
          cy={c}
          r={r}
          stroke={palette.surfaceElevated}
          strokeWidth={stroke}
          fill="none"
        />
        {/* Starts at twelve o'clock and runs clockwise, like a clock face. */}
        <AnimatedCircle
          cx={c}
          cy={c}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </Svg>
      <View style={styles.center}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
});
