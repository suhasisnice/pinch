import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Touch feedback, kept small and few (0.9.18 — the user asked to "feel the
 * app", subtle and Linear-like).
 *
 * Android's own view haptics, not the vibrator: they are the short ticks the
 * system keyboard and switches use, and they follow the phone's "touch
 * feedback" setting, so someone who has turned that off feels nothing.
 *
 * Four words, one per kind of moment. A plain row or link gets none; feedback
 * on every tap stops being feedback.
 */
function perform(type: Haptics.AndroidHaptics) {
  if (Platform.OS !== 'android') return;
  Haptics.performAndroidHapticsAsync(type).catch(() => undefined);
}

export const haptic = {
  /** A choice changed: a chip, a tab, a segment. */
  tick: () => perform(Haptics.AndroidHaptics.Segment_Tick),
  /** A switch flipped. */
  toggle: (on: boolean) =>
    perform(on ? Haptics.AndroidHaptics.Toggle_On : Haptics.AndroidHaptics.Toggle_Off),
  /** A button did its thing. */
  press: () => perform(Haptics.AndroidHaptics.Virtual_Key),
  /** Something worth a small beat: payday done, a goal reached, a milestone. */
  success: () => perform(Haptics.AndroidHaptics.Confirm),
  /** It didn't work. */
  reject: () => perform(Haptics.AndroidHaptics.Reject),
};
