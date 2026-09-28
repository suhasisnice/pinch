import React from 'react';
import Svg, { Circle, Ellipse, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';
import { palette } from '../theme/theme';

/**
 * One icon vocabulary for the whole app, drawn in one hand.
 *
 * Screens name what they mean ("split", "warning") rather than which glyph
 * they want, so the set can change here and nothing drifts. Until 0.9.25 this
 * mixed Feather with Material Community Icons: two stroke weights, two corner
 * styles, and a party popper for a tab — the mix read as assembled, not
 * designed. Every glyph is now a Lucide outline (ISC licence, paths copied
 * from lucide-static 1.48), drawn with react-native-svg at one thin stroke to
 * sit beside the thin numerals. `today` is our own: the open ring of
 * Today's hero.
 */
type Shape =
  | string
  | [
      'circle' | 'rect' | 'line' | 'polyline' | 'polygon' | 'ellipse',
      Record<string, string | number>,
    ];

const GLYPHS = {
  today: ['M12 3a9 9 0 1 1-9 9'], // Today's ring, three-quarters full
  outings: [
    'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0',
    ['circle', { cx: 12, cy: 10, r: 3 }],
  ], // map-pin
  goals: [
    'M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528',
  ], // flag
  squad: [
    'M18 21a8 8 0 0 0-16 0',
    ['circle', { cx: 10, cy: 8, r: 5 }],
    'M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3',
  ], // users-round
  insights: ['M5 21v-6', 'M12 21V3', 'M19 21V9'], // chart-no-axes-column
  settings: [
    'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915',
    ['circle', { cx: 12, cy: 12, r: 3 }],
  ], // settings
  inbox: [
    ['polyline', { points: '22 12 16 12 14 15 10 15 8 12 2 12' }],
    'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  ], // inbox
  add: ['M5 12h14', 'M12 5v14'], // plus
  edit: [
    'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
    'm15 5 4 4',
  ], // pencil
  close: ['M18 6 6 18', 'm6 6 12 12'], // x
  check: ['M20 6 9 17l-5-5'], // check
  chevronRight: ['m9 18 6-6-6-6'], // chevron-right
  chevronDown: ['m6 9 6 6 6-6'], // chevron-down
  search: ['m21 21-4.34-4.34', ['circle', { cx: 11, cy: 11, r: 8 }]], // search
  split: ['M16 3h5v5', 'M8 3H3v5', 'M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3', 'm15 9 6-6'], // split
  contacts: [
    'M16 2v2',
    'M17.915 21a6 6 0 10-12 0',
    'M8 2v2',
    ['circle', { cx: 12, cy: 11, r: 4 }],
    ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
  ], // contact-round
  play: ['M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z'], // play
  lock: [
    ['rect', { width: 18, height: 11, x: 3, y: 11, rx: 2, ry: 2 }],
    'M7 11V7a5 5 0 0 1 10 0v4',
  ], // lock
  eye: [
    'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0',
    ['circle', { cx: 12, cy: 12, r: 3 }],
  ], // eye
  eyeOff: [
    'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49',
    'M14.084 14.158a3 3 0 0 1-4.242-4.242',
    'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143',
    'm2 2 20 20',
  ], // eye-off
  warning: [
    'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
    'M12 9v4',
    'M12 17h.01',
  ], // triangle-alert
  info: [['circle', { cx: 12, cy: 12, r: 10 }], 'M12 16v-4', 'M12 8h.01'], // info
  ghost: [
    'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49',
    'M14.084 14.158a3 3 0 0 1-4.242-4.242',
    'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143',
    'm2 2 20 20',
  ], // eye-off
  trendUp: ['M16 7h6v6', 'm22 7-8.5 8.5-5-5L2 17'], // trending-up
  trendDown: ['M16 17h6v-6', 'm22 17-8.5-8.5-5 5L2 7'], // trending-down
  clock: [['circle', { cx: 12, cy: 12, r: 10 }], 'M12 6v6l4 2'], // clock
  calendar: [
    'M8 2v3',
    'M16 2v3',
    ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
    'M3 9h18',
  ], // calendar
  wallet: [
    'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1',
    'M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4',
  ], // wallet
  savings: [
    ['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }],
    ['circle', { cx: 7.5, cy: 7.5, r: 0.5, fill: 'currentColor' }],
    'm7.9 7.9 2.7 2.7',
    ['circle', { cx: 16.5, cy: 7.5, r: 0.5, fill: 'currentColor' }],
    'm13.4 10.6 2.7-2.7',
    ['circle', { cx: 7.5, cy: 16.5, r: 0.5, fill: 'currentColor' }],
    'm7.9 16.1 2.7-2.7',
    ['circle', { cx: 16.5, cy: 16.5, r: 0.5, fill: 'currentColor' }],
    'm13.4 13.4 2.7 2.7',
    ['circle', { cx: 12, cy: 12, r: 2 }],
  ], // vault
  empty: [
    ['polyline', { points: '22 12 16 12 14 15 10 15 8 12 2 12' }],
    'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  ], // inbox
  party: [
    'M5.8 11.3 2 22l10.7-3.79',
    'M4 3h.01',
    'M22 8h.01',
    'M15 2h.01',
    'M22 20h.01',
    'm22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10',
    'm22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17',
    'm11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7',
    'M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z',
  ], // party-popper
  beach: [
    'M13 8c0-2.76-2.46-5-5.5-5S2 5.24 2 8h2l1-1 1 1h4',
    'M13 7.14A5.82 5.82 0 0 1 16.5 6c3.04 0 5.5 2.24 5.5 5h-3l-1-1-1 1h-3',
    'M5.89 9.71c-2.15 2.15-2.3 5.47-.35 7.43l4.24-4.25.7-.7.71-.71 2.12-2.12c-1.95-1.96-5.27-1.8-7.42.35',
    'M11 15.5c.5 2.5-.17 4.5-1 6.5h4c2-5.5-.5-12-1-14',
  ], // tree-palm
  movie: [
    'm12.296 3.464 3.02 3.956',
    'M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z',
    'M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    'm6.18 5.276 3.1 3.899',
  ], // clapperboard
  pizza: [
    'm12 14-1 1',
    'm13.75 18.25-1.25 1.42',
    'M17.775 5.654a15.68 15.68 0 0 0-12.121 12.12',
    'M18.8 9.3a1 1 0 0 0 2.1 7.7',
    'M21.964 20.732a1 1 0 0 1-1.232 1.232l-18-5a1 1 0 0 1-.695-1.232A19.68 19.68 0 0 1 15.732 2.037a1 1 0 0 1 1.232.695z',
  ], // pizza
  concert: [
    'm11 7.601-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12',
    'M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2-2.072-.356-2.775-3.369-1.5-4.5',
    ['circle', { cx: 16, cy: 7, r: 5 }],
  ], // mic-vocal
  hike: ['m8 3 4 8 5-5 5 15H2L8 3z'], // mountain
  bowling: [
    ['line', { x1: 6, x2: 10, y1: 11, y2: 11 }],
    ['line', { x1: 8, x2: 8, y1: 9, y2: 13 }],
    ['line', { x1: 15, x2: 15.01, y1: 12, y2: 12 }],
    ['line', { x1: 18, x2: 18.01, y1: 10, y2: 10 }],
    'M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z',
  ], // gamepad-2
  cricket: [
    'M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2',
    'M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2',
    'M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3',
    'M4 22h16',
    'M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z',
    'M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3',
  ], // trophy
  cake: [
    'M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8',
    'M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1',
    'M2 21h20',
    'M7 8v3',
    'M12 8v3',
    'M17 8v3',
    'M7 4h.01',
    'M12 4h.01',
    'M17 4h.01',
  ], // cake
  road: [
    'M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2',
    ['circle', { cx: 7, cy: 17, r: 2 }],
    'M9 17h6',
    ['circle', { cx: 17, cy: 17, r: 2 }],
  ], // car
  laptop: [
    'M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z',
    'M20.054 15.987H3.946',
  ], // laptop
  phone: [['rect', { width: 14, height: 20, x: 5, y: 2, rx: 2, ry: 2 }], 'M12 18h.01'], // smartphone
  headphones: [
    'M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3',
  ], // headphones
  guitar: [
    'm11.9 12.1 4.514-4.514',
    'M20.1 2.3a1 1 0 0 0-1.4 0l-1.114 1.114A2 2 0 0 0 17 4.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 17.828 7h1.344a2 2 0 0 0 1.414-.586L21.7 5.3a1 1 0 0 0 0-1.4z',
    'm6 16 2 2',
    'M8.23 9.85A3 3 0 0 1 11 8a5 5 0 0 1 5 5 3 3 0 0 1-1.85 2.77l-.92.38A2 2 0 0 0 12 18a4 4 0 0 1-4 4 6 6 0 0 1-6-6 4 4 0 0 1 4-4 2 2 0 0 0 1.85-1.23z',
  ], // guitar
  bike: [
    ['circle', { cx: 18.5, cy: 17.5, r: 3.5 }],
    ['circle', { cx: 5.5, cy: 17.5, r: 3.5 }],
    ['circle', { cx: 15, cy: 5, r: 1 }],
    'M12 17.5V14l-3-3 4-3 2 3h2',
  ], // bike
  shoes: [
    'M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z',
    'M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z',
    'M16 17h4',
    'M4 13h4',
  ], // footprints
  camera: [
    'M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z',
    ['circle', { cx: 12, cy: 13, r: 3 }],
  ], // camera
  gift: [
    'M12 7v14',
    'M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8',
    'M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5',
    ['rect', { x: 3, y: 7, width: 18, height: 4, rx: 1 }],
  ], // gift
  ticket: [
    'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z',
    'M13 5v2',
    'M13 17v2',
    'M13 11v2',
  ], // ticket
  book: [
    'M12 5v16',
    'M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z',
  ], // book-open
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof GLYPHS;

const ELEMENTS = {
  circle: Circle,
  rect: Rect,
  line: Line,
  polyline: Polyline,
  polygon: Polygon,
  ellipse: Ellipse,
} as const;

export default function Icon({
  name,
  size = 18,
  color = palette.textSecondary,
  strokeWidth = 1.75,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const shapes: readonly Shape[] = GLYPHS[name];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shapes.map((shape, i) => {
        if (typeof shape === 'string') return <Path key={i} d={shape} />;
        const Element = ELEMENTS[shape[0]] as React.ComponentType<Record<string, unknown>>;
        return <Element key={i} {...shape[1]} />;
      })}
    </Svg>
  );
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
  return value != null && Object.prototype.hasOwnProperty.call(GLYPHS, value);
}
