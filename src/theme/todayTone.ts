import { useSyncExternalStore } from 'react';
import { palette } from './theme';

/**
 * How today is going, as a colour, shared between Today (which works it out)
 * and the tab bar (which wears it on Today's icon). The other tabs have fixed
 * hues (`place`); Today's is the day itself.
 */
let tone: string = palette.good;
const listeners = new Set<() => void>();

export function setTodayTone(next: string) {
  if (next === tone) return;
  tone = next;
  listeners.forEach((l) => l());
}

export function useTodayTone(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => tone
  );
}
