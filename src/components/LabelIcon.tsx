import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Icon, { isIconName } from './Icon';
import { palette } from '../theme/theme';

/**
 * Renders the symbol stored against a goal or an outing.
 *
 * The column behind this used to hold a literal emoji, so rows written by an
 * older build still contain one. Anything we do not recognise as an icon name
 * is rendered as text, which keeps those rows looking exactly as they did
 * rather than showing a broken placeholder.
 */
export default function LabelIcon({
  label,
  size = 22,
  color = palette.violet,
}: {
  label: string | null | undefined;
  size?: number;
  color?: string;
}) {
  if (isIconName(label)) {
    return <Icon name={label} size={size} color={color} />;
  }
  return <Text style={[styles.legacy, { fontSize: size }]}>{label ?? ''}</Text>;
}

/** Same, in a tinted circle — the form used in list rows and card headers. */
export function LabelIconBadge({
  label,
  color = palette.violet,
  size = 40,
}: {
  label: string | null | undefined;
  color?: string;
  size?: number;
}) {
  return (
    <View
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 2, borderColor: color },
      ]}
    >
      <LabelIcon label={label} size={Math.round(size * 0.5)} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  legacy: { color: palette.textPrimary },
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
  },
});
