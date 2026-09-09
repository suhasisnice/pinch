import React from 'react';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { palette } from '../theme/theme';

/**
 * One icon vocabulary for the whole app.
 *
 * Screens name what they mean ("delete", "streak") rather than which glyph
 * they want, so the icon set can change in one place and nothing drifts.
 * Drawn from Feather and Material Community Icons — both open source sets
 * that ship with @expo/vector-icons — instead of emoji, which render as a
 * different picture on every Android version and skin.
 */
type FeatherName = React.ComponentProps<typeof Feather>['name'];
type MaterialName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

type Glyph = { set: 'feather'; name: FeatherName } | { set: 'material'; name: MaterialName };

const feather = (name: FeatherName): Glyph => ({ set: 'feather', name });
const material = (name: MaterialName): Glyph => ({ set: 'material', name });

const GLYPHS = {
  // Navigation
  today: feather('sun'),
  outings: material('party-popper'),
  goals: feather('target'),
  squad: feather('users'),
  insights: feather('bar-chart-2'),
  settings: feather('settings'),
  inbox: feather('inbox'),

  // Actions
  add: feather('plus'),
  edit: feather('edit-2'),
  delete: feather('trash-2'),
  close: feather('x'),
  check: feather('check'),
  chevronRight: feather('chevron-right'),
  chevronDown: feather('chevron-down'),
  search: feather('search'),
  refresh: feather('refresh-cw'),
  split: material('call-split'),
  contacts: material('contacts-outline'),
  whatsapp: material('whatsapp'),
  send: feather('send'),
  archive: feather('archive'),
  play: feather('play'),
  lock: feather('lock'),
  eye: feather('eye'),
  eyeOff: feather('eye-off'),

  // States and signals
  warning: feather('alert-triangle'),
  error: feather('alert-octagon'),
  info: feather('info'),
  streak: material('fire'),
  ghost: material('ghost'),
  trendUp: feather('trending-up'),
  trendDown: feather('trending-down'),
  flat: feather('minus'),
  clock: feather('clock'),
  moon: feather('moon'),
  calendar: feather('calendar'),
  wallet: material('wallet-outline'),
  savings: material('piggy-bank-outline'),
  receipt: material('receipt'),
  sparkle: material('star-four-points-outline'),
  empty: material('inbox-outline'),

  // Pickable labels for a goal or an outing. Stored by name in the database's
  // `emoji` column, which used to hold a literal emoji — anything unrecognised
  // still renders as text, so rows written by an older build keep working.
  party: material('party-popper'),
  beach: material('beach'),
  movie: material('movie-open-outline'),
  pizza: material('pizza'),
  concert: material('microphone-variant'),
  hike: material('hiking'),
  bowling: material('bowling'),
  cricket: material('cricket'),
  cake: material('cake-variant-outline'),
  road: material('car-outline'),
  laptop: material('laptop'),
  phone: material('cellphone'),
  headphones: material('headphones'),
  guitar: material('guitar-acoustic'),
  bike: material('bike'),
  shoes: material('shoe-sneaker'),
  camera: material('camera-outline'),
  gift: material('gift-outline'),
  ticket: material('ticket-outline'),
  book: material('book-open-page-variant-outline'),

  // Spend categories — these match the keys in theme.categoryColors.
  Food: material('silverware-fork-knife'),
  Outing: material('party-popper'),
  Transport: material('bus'),
  Shopping: feather('shopping-bag'),
  Subscriptions: feather('repeat'),
  Academics: material('school-outline'),
  Health: feather('heart'),
  Other: material('dots-horizontal'),
  Uncategorised: feather('help-circle'),
} satisfies Record<string, Glyph>;

export type IconName = keyof typeof GLYPHS;

export default function Icon({
  name,
  size = 18,
  color = palette.textSecondary,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  const glyph: Glyph = GLYPHS[name];
  if (glyph.set === 'feather') {
    return <Feather name={glyph.name} size={size} color={color} />;
  }
  return <MaterialCommunityIcons name={glyph.name} size={size} color={color} />;
}

/** Icons offered when naming an outing. */
export const OUTING_ICONS: IconName[] = [
  'party',
  'pizza',
  'movie',
  'beach',
  'concert',
  'hike',
  'bowling',
  'cricket',
  'cake',
  'road',
];

/** Icons offered when naming a savings goal. */
export const GOAL_ICONS: IconName[] = [
  'goals',
  'laptop',
  'phone',
  'headphones',
  'guitar',
  'bike',
  'shoes',
  'camera',
  'ticket',
  'gift',
];

/** True when a stored label is one of ours rather than a legacy emoji. */
export function isIconName(value: string | null | undefined): value is IconName {
  return value != null && value in GLYPHS;
}

/** The icon for a spend category, falling back to the generic one. */
export function categoryIcon(category: string | null | undefined): IconName {
  if (!category) return 'Uncategorised';
  return (category in GLYPHS ? category : 'Other') as IconName;
}
