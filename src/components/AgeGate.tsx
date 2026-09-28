import React, { useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { palette, spacing, typography } from '../theme/theme';
import { Button } from './ui';

/**
 * The age question, asked once before anything else (0.9.22,
 * docs/PLAY_READINESS.md §7).
 *
 * Asked neutrally: both answers look the same, so the screen does not steer
 * anyone toward the "right" one, which is what Play's families policy means
 * by a neutral age screen. Under 18 is a polite dead end rather than a
 * lecture, with a way back for a mis-tap.
 */
export default function AgeGate({ onConfirmed }: { onConfirmed: () => void }) {
  const [under, setUnder] = useState(false);

  if (under) {
    return (
      <View style={styles.wrap}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.mark}>pinch</Text>
        <Text style={styles.title}>Pinch is for 18 and over.</Text>
        <Text style={styles.body}>
          For anyone younger, the law wants a parent's verified go-ahead before an app touches money
          data, and Pinch has no way to check one. Your budget will keep till your birthday.
        </Text>
        <View style={styles.actions}>
          <Button label="I tapped the wrong one" variant="text" onPress={() => setUnder(false)} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <StatusBar barStyle="light-content" />
      <Text style={styles.mark}>pinch</Text>
      <Text style={styles.title}>First, how old are you?</Text>
      <Text style={styles.body}>Asked once. Nothing leaves your phone.</Text>
      <View style={styles.actions}>
        <Button label="18 or over" variant="outlined" onPress={onConfirmed} />
        <Button label="Under 18" variant="outlined" onPress={() => setUnder(true)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: palette.background,
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  mark: { ...typography.caption, color: palette.accent, marginBottom: spacing.lg },
  title: { ...typography.display, color: palette.textPrimary },
  body: { ...typography.body, color: palette.textSecondary },
  actions: { marginTop: spacing.xl, gap: spacing.sm },
});
