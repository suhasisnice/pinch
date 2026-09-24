import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing, typography } from '../theme/theme';
import { Button, Sheet } from './ui';

/**
 * The app's own dialogs, replacing React Native's `Alert`.
 *
 * `Alert.alert` renders the platform's dialog, which on Android is a light
 * Material box — white card, blue text, its own type and corners. In an app
 * that is otherwise near-black with one green accent, every confirmation
 * and every result looked like it belonged to a different, older product,
 * and these are not rare screens: they are where deleting, resetting and
 * blocking actually happen.
 *
 * Presented imperatively on purpose. The call sites being replaced are
 * mid-flow — inside an async handler, branching on which button was
 * pressed — and rewriting each into rendered state would mean a visible
 * state field per dialog across seven files. Awaiting a promise keeps them
 * reading the way they already do.
 */
export type DialogAction = {
  label: string;
  /** Returned by `showDialog` when this is the button pressed. */
  value: string;
  variant?: 'filled' | 'secondary' | 'ghost' | 'danger';
};

export interface DialogRequest {
  title: string;
  message?: string;
  /**
   * Shown as a list under the message, each on its own line. For results
   * that are genuinely a list — which rules skipped what, what a sweep
   * changed — where one run-on paragraph is the wrong shape.
   */
  items?: Array<{ label: string; detail?: string }>;
  actions: DialogAction[];
  /** Value resolved when the sheet is dismissed without choosing. Defaults to null. */
  dismissValue?: string | null;
}

type Presenter = (request: DialogRequest) => Promise<string | null>;

let present: Presenter | null = null;

/**
 * Shows a dialog and resolves with the `value` of the button pressed, or
 * `dismissValue` if it was dismissed.
 *
 * Resolves immediately with null when no host is mounted, so a call from a
 * background path can never hang waiting for a UI that is not there.
 */
export function showDialog(request: DialogRequest): Promise<string | null> {
  if (!present) return Promise.resolve(null);
  return present(request);
}

/** The common case: a question with a confirm and a cancel. Resolves true when confirmed. */
export async function showConfirm(options: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  const result = await showDialog({
    title: options.title,
    message: options.message,
    actions: [
      { label: options.cancelLabel ?? 'Cancel', value: 'cancel', variant: 'ghost' },
      {
        label: options.confirmLabel ?? 'Confirm',
        value: 'confirm',
        variant: options.destructive ? 'danger' : 'filled',
      },
    ],
    dismissValue: 'cancel',
  });
  return result === 'confirm';
}

/** Plain acknowledgement — a result to read, with one way out. */
export function showMessage(
  title: string,
  message?: string,
  items?: DialogRequest['items']
): Promise<string | null> {
  return showDialog({
    title,
    message,
    items,
    actions: [{ label: 'Done', value: 'ok' }],
    dismissValue: 'ok',
  });
}

/**
 * Mounted once, at the root. Everything above talks to whatever instance is
 * currently mounted.
 */
export function DialogHost() {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const resolver = useRef<((value: string | null) => void) | null>(null);

  useEffect(() => {
    present = (next) =>
      new Promise<string | null>((resolve) => {
        resolver.current = resolve;
        setRequest(next);
      });
    return () => {
      present = null;
    };
  }, []);

  const settle = useCallback((value: string | null) => {
    setRequest(null);
    const resolve = resolver.current;
    resolver.current = null;
    // Always resolves, so an awaiting caller is never left hanging on a
    // dialog the user swiped away.
    resolve?.(value);
  }, []);

  if (!request) return null;

  return (
    <Sheet
      visible
      onClose={() => settle(request.dismissValue === undefined ? null : request.dismissValue)}
      title={request.title}
    >
      {request.message ? <Text style={styles.message}>{request.message}</Text> : null}

      {request.items && request.items.length > 0 ? (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {request.items.map((item, index) => (
            <View key={`${item.label}-${index}`} style={styles.item}>
              <Text style={styles.itemLabel}>{item.label}</Text>
              {item.detail ? <Text style={styles.itemDetail}>{item.detail}</Text> : null}
            </View>
          ))}
        </ScrollView>
      ) : null}

      {request.actions.map((action) => (
        <Button
          key={action.value}
          label={action.label}
          variant={action.variant ?? 'filled'}
          onPress={() => settle(action.value)}
        />
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  message: { ...typography.body, color: palette.textSecondary, lineHeight: 22 },

  // Capped so a long result scrolls inside the sheet rather than pushing the
  // buttons off the bottom of the screen.
  list: { maxHeight: 280 },
  listContent: { gap: spacing.sm },
  item: {
    backgroundColor: palette.surfaceElevated,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: 2,
  },
  itemLabel: { ...typography.bodyBold, color: palette.textPrimary },
  itemDetail: { ...typography.caption, color: palette.textMuted },
});
