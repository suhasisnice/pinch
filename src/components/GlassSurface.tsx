import React, { ReactNode } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { palette, radii } from '../theme/theme';

interface GlassSurfaceProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
}

/**
 * Glassmorphism surface: a real gaussian blur (expo-blur) plus a faint
 * translucent tint and hairline border, used for modals and the Survival
 * Mode takeover.
 */
export default function GlassSurface({ children, style, intensity = 40 }: GlassSurfaceProps) {
  return (
    <View style={[styles.wrapper, style]}>
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.tint} pointerEvents="none" />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: radii.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: palette.glassBorder,
  },
  tint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.glassOverlay,
  },
  content: {
    position: 'relative',
  },
});
