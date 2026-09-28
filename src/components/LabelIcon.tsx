import React from 'react';
import { StyleSheet, Text } from 'react-native';
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
  color = palette.textPrimary,
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

const styles = StyleSheet.create({
  legacy: { color: palette.textPrimary },
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceElevated,
  },
});
