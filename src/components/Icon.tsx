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
 *
 * The Today screen's own controls were picked by hand from other families
 * (Iconoir bells, a Solar cog, and the filled Phosphor and Solar glyphs in
 * FILLED below), all MIT or CC BY licensed, paths copied from Iconify.
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
  settings: [['circle', { cx: 12, cy: 12, r: 3 }], 'M13.7654 2.15224C13.3978 2 12.9319 2 12 2C11.0681 2 10.6022 2 10.2346 2.15224C9.74457 2.35523 9.35522 2.74458 9.15223 3.23463C9.05957 3.45834 9.0233 3.7185 9.00911 4.09799C8.98826 4.65568 8.70226 5.17189 8.21894 5.45093C7.73564 5.72996 7.14559 5.71954 6.65219 5.45876C6.31645 5.2813 6.07301 5.18262 5.83294 5.15102C5.30704 5.08178 4.77518 5.22429 4.35436 5.5472C4.03874 5.78938 3.80577 6.1929 3.33983 6.99993C2.87389 7.80697 2.64092 8.21048 2.58899 8.60491C2.51976 9.1308 2.66227 9.66266 2.98518 10.0835C3.13256 10.2756 3.3397 10.437 3.66119 10.639C4.1338 10.936 4.43789 11.4419 4.43786 12C4.43783 12.5581 4.13375 13.0639 3.66118 13.3608C3.33965 13.5629 3.13248 13.7244 2.98508 13.9165C2.66217 14.3373 2.51966 14.8691 2.5889 15.395C2.64082 15.7894 2.87379 16.193 3.33973 17C3.80568 17.807 4.03865 18.2106 4.35426 18.4527C4.77508 18.7756 5.30694 18.9181 5.83284 18.8489C6.07289 18.8173 6.31632 18.7186 6.65204 18.5412C7.14547 18.2804 7.73556 18.27 8.2189 18.549C8.70224 18.8281 8.98826 19.3443 9.00911 19.9021C9.02331 20.2815 9.05957 20.5417 9.15223 20.7654C9.35522 21.2554 9.74457 21.6448 10.2346 21.8478C10.6022 22 11.0681 22 12 22C12.9319 22 13.3978 22 13.7654 21.8478C14.2554 21.6448 14.6448 21.2554 14.8477 20.7654C14.9404 20.5417 14.9767 20.2815 14.9909 19.902C15.0117 19.3443 15.2977 18.8281 15.781 18.549C16.2643 18.2699 16.8544 18.2804 17.3479 18.5412C17.6836 18.7186 17.927 18.8172 18.167 18.8488C18.6929 18.9181 19.2248 18.7756 19.6456 18.4527C19.9612 18.2105 20.1942 17.807 20.6601 16.9999C21.1261 16.1929 21.3591 15.7894 21.411 15.395C21.4802 14.8691 21.3377 14.3372 21.0148 13.9164C20.8674 13.7243 20.6602 13.5628 20.3387 13.3608C19.8662 13.0639 19.5621 12.558 19.5621 11.9999C19.5621 11.4418 19.8662 10.9361 20.3387 10.6392C20.6603 10.4371 20.8675 10.2757 21.0149 10.0835C21.3378 9.66273 21.4803 9.13087 21.4111 8.60497C21.3592 8.21055 21.1262 7.80703 20.6602 7C20.1943 6.19297 19.9613 5.78945 19.6457 5.54727C19.2249 5.22436 18.693 5.08185 18.1671 5.15109C17.9271 5.18269 17.6837 5.28136 17.3479 5.4588C16.8545 5.71959 16.2644 5.73002 15.7811 5.45096C15.2977 5.17191 15.0117 4.65566 14.9909 4.09794C14.9767 3.71848 14.9404 3.45833 14.8477 3.23463C14.6448 2.74458 14.2554 2.35523 13.7654 2.15224Z'], // Solar settings-linear
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
  bell: ['M18 8.4c0-1.697-.632-3.325-1.757-4.525S13.59 2 12 2s-3.117.674-4.243 1.875C6.632 5.075 6 6.703 6 8.4C6 15.867 3 18 3 18h18s-3-2.133-3-9.6M13.73 21a2 2 0 0 1-3.46 0'], // Iconoir bell
  bellDot: ['M18.134 11C18.715 16.375 21 18 21 18H3s3-2.133 3-9.6c0-1.697.632-3.325 1.757-4.525S10.41 2 12 2q.507 0 1 .09M19 8a3 3 0 1 0 0-6a3 3 0 0 0 0 6m-5.27 13a2 2 0 0 1-3.46 0'], // Iconoir bell-notification
} satisfies Record<string, Shape[]>;

/** Glyphs drawn as filled shapes rather than strokes. A pair is [path, opacity]: the soft second tone. */
const FILLED = {
  transactions: { box: 24, paths: ['M10.25 4.00003C10.25 3.69074 10.0602 3.41317 9.77191 3.30105C9.48366 3.18892 9.15614 3.26524 8.94715 3.49324L3.44715 9.49324C3.24617 9.71248 3.19374 10.0298 3.3135 10.302C3.43327 10.5743 3.70259 10.75 4.00002 10.75H20C20.4142 10.75 20.75 10.4142 20.75 10C20.75 9.58582 20.4142 9.25003 20 9.25003L10.25 9.25003V4.00003Z', 'M13.75 20L13.75 14.75H4.00002C3.5858 14.75 3.25002 14.4142 3.25002 14C3.25002 13.5858 3.5858 13.25 4.00002 13.25L20 13.25C20.2974 13.25 20.5668 13.4258 20.6865 13.698C20.8063 13.9703 20.7539 14.2876 20.5529 14.5068L15.0529 20.5068C14.8439 20.7348 14.5164 20.8111 14.2281 20.699C13.9399 20.5869 13.75 20.3093 13.75 20Z'] },
  addCircle: { box: 256, paths: [['M224 128a96 96 0 1 1-96-96a96 96 0 0 1 96 96', .2], 'M128 24a104 104 0 1 0 104 104A104.11 104.11 0 0 0 128 24m0 192a88 88 0 1 1 88-88a88.1 88.1 0 0 1-88 88m48-88a8 8 0 0 1-8 8h-32v32a8 8 0 0 1-16 0v-32H88a8 8 0 0 1 0-16h32V88a8 8 0 0 1 16 0v32h32a8 8 0 0 1 8 8'] },
  alert: { box: 256, paths: ['M128 26a102 102 0 1 0 102 102A102.12 102.12 0 0 0 128 26m0 192a90 90 0 1 1 90-90a90.1 90.1 0 0 1-90 90m-6-82V80a6 6 0 0 1 12 0v56a6 6 0 0 1-12 0m16 36a10 10 0 1 1-10-10a10 10 0 0 1 10 10'] },
  receipt: { box: 256, paths: [['M224 56v152l-32-16l-32 16l-32-16l-32 16l-32-16l-32 16V56a8 8 0 0 1 8-8h176a8 8 0 0 1 8 8', .2], 'M72 104a8 8 0 0 1 8-8h96a8 8 0 0 1 0 16H80a8 8 0 0 1-8-8m8 40h96a8 8 0 0 0 0-16H80a8 8 0 0 0 0 16m152-88v152a8 8 0 0 1-11.58 7.15L192 200.94l-28.42 14.21a8 8 0 0 1-7.16 0L128 200.94l-28.42 14.21a8 8 0 0 1-7.16 0L64 200.94l-28.42 14.21A8 8 0 0 1 24 208V56a16 16 0 0 1 16-16h176a16 16 0 0 1 16 16m-16 0H40v139.06l20.42-10.22a8 8 0 0 1 7.16 0L96 199.06l28.42-14.22a8 8 0 0 1 7.16 0L160 199.06l28.42-14.22a8 8 0 0 1 7.16 0L216 195.06Z'] },
} satisfies Record<string, { box: number; paths: Array<string | [string, number]> }>;

export type IconName = keyof typeof GLYPHS | keyof typeof FILLED;

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
  if (name in FILLED) {
    const { box, paths } = FILLED[name as keyof typeof FILLED];
    return (
      <Svg width={size} height={size} viewBox={`0 0 ${box} ${box}`} fill={color}>
        {paths.map((p, i) =>
          typeof p === 'string' ? <Path key={i} d={p} /> : <Path key={i} d={p[0]} opacity={p[1]} />
        )}
      </Svg>
    );
  }
  const shapes: readonly Shape[] = GLYPHS[name as keyof typeof GLYPHS];
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
