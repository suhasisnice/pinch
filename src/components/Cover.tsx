import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { categoryColor, coverFill, coverTone, hueFor, palette } from '../theme/theme';
import Icon, { IconName, categoryIcon, isIconName } from './Icon';

/**
 * Artwork for things that have no artwork.
 *
 * Spotify is a wall of covers; a finance list is a wall of text. The spec's
 * translation — "album art → contextual finance icons / category visuals" —
 * is this: a small square in the thing's own colour, deep enough to sit on
 * the dark surface, with the icon lit in the full hue. Solid tones only, no
 * gradients. The colour is the category's (or, for a goal or outing, one
 * picked from its name), so the same thing always wears the same colour.
 */
export default function Cover({
  hue,
  icon,
  size = 40,
  fill,
  children,
}: {
  hue: string;
  icon?: IconName;
  size?: number;
  /**
   * 0–1. Fills the tile from the bottom in a brighter tone — a goal's cover
   * shows how full it is before you read a number.
   */
  fill?: number;
  children?: React.ReactNode;
}) {
  const level = fill === undefined ? 0 : Math.max(0, Math.min(1, fill));
  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.24),
          backgroundColor: coverTone(hue),
        },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {level > 0 ? (
        <View
          style={[styles.fill, { height: `${level * 100}%`, backgroundColor: coverFill(hue) }]}
        />
      ) : null}
      {children ?? (icon ? <Icon name={icon} size={Math.round(size * 0.46)} color={hue} /> : null)}
    </View>
  );
}

/** A transaction's cover: its category's colour and icon. */
export function CategoryCover({
  category,
  size = 40,
}: {
  category: string | null | undefined;
  size?: number;
}) {
  return <Cover hue={categoryColor(category)} icon={categoryIcon(category)} size={size} />;
}

/**
 * A goal or outing's cover: its chosen icon, in a colour picked from its
 * name, so "Goa trip" is always the same colour wherever it appears.
 */
export function NamedCover({
  name,
  icon,
  size = 48,
  fill,
}: {
  name: string;
  icon: string | null | undefined;
  size?: number;
  fill?: number;
}) {
  const hue = hueFor(name);
  return <Cover hue={hue} icon={isIconName(icon) ? icon : 'goals'} size={size} fill={fill} />;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** An event's cover is its date, like a ticket stub. */
export function DateCover({ iso, name, size = 52 }: { iso: string; name: string; size?: number }) {
  const d = new Date(iso);
  const hue = hueFor(name);
  return (
    <Cover hue={hue} size={size}>
      <Text style={[styles.month, { color: hue }]}>{MONTHS[d.getMonth()]}</Text>
      <Text style={styles.day}>{d.getDate()}</Text>
    </Cover>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  month: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  day: {
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '800',
    color: palette.textPrimary,
    fontVariant: ['tabular-nums'],
  },
});
