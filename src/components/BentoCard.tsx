import React, { ReactNode } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { palette, radii, spacing } from '../theme/theme';

interface BentoCardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
  accentColor?: string;
}

/** Soft rounded card container — the base unit of the Bento grid. */
export default function BentoCard({ children, style, elevated = false, accentColor }: BentoCardProps) {
  return (
    <View
      style={[
        styles.card,
        elevated && styles.elevated,
        accentColor ? { borderColor: accentColor } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.cardBackground,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
  },
  elevated: {
    backgroundColor: palette.cardBackgroundElevated,
  },
});
