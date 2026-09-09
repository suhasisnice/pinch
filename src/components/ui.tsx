import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { palette, radii, spacing, typography } from '../theme/theme';
import { duration, easing, usePressScale, useReducedMotion } from './motion';
import Icon, { IconName } from './Icon';

/** Shared primitives. Kept in one file so spacing and radii stay consistent. */

export function Screen({
  children,
  scroll = true,
  refreshControl,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  refreshControl?: React.ReactElement;
}) {
  if (!scroll) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        {children}
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
        // Without this, the first tap on any button while the keyboard is up
        // is swallowed to dismiss the keyboard and never reaches onPress. On
        // numeric fields — which have no return key to dismiss with — that
        // reads as a button that simply does nothing.
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function ScreenTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.titleBlock}>
      <Text style={styles.screenTitle}>{title}</Text>
      {subtitle ? <Text style={styles.screenSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
}) {
  const press = usePressScale();

  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;

  return (
    <Animated.View style={press.style}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[styles.card, style]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

export function CardTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.cardTitleRow}>
      <Text style={styles.cardTitle}>{children}</Text>
      {right}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const variantStyle =
    variant === 'primary'
      ? styles.buttonPrimary
      : variant === 'danger'
        ? styles.buttonDanger
        : variant === 'ghost'
          ? styles.buttonGhost
          : styles.buttonSecondary;

  const labelStyle =
    variant === 'primary'
      ? styles.buttonPrimaryLabel
      : variant === 'danger'
        ? styles.buttonDangerLabel
        : styles.buttonSecondaryLabel;

  const press = usePressScale();

  // The caller's style carries layout (a flex:1 in a button row), so it rides
  // on the wrapper; the visual styles stay on the pressable that is scaling.
  return (
    <Animated.View style={[style, press.style]}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        onPressIn={disabled ? undefined : press.onPressIn}
        onPressOut={disabled ? undefined : press.onPressOut}
        style={[styles.button, variantStyle, disabled && styles.buttonDisabled]}
      >
        <Text style={labelStyle}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

export function Chip({
  label,
  selected = false,
  onPress,
  color,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && { backgroundColor: color ?? palette.neonGreen, borderColor: 'transparent' },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  ...inputProps
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={palette.textMuted}
        {...inputProps}
        style={[styles.input, inputProps.style]}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

/**
 * Horizontal progress bar. `fraction` is clamped, and overflow past 100% is
 * shown by colour rather than by a bar that runs off the edge.
 */
export function ProgressBar({
  fraction,
  color = palette.neonGreen,
  height = 8,
}: {
  fraction: number;
  color?: string;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(clamped)).current;
  // A bar that slides to its new length shows the direction of the change,
  // which a bar that simply appears at a different width does not.
  const seeded = useRef(false);

  useEffect(() => {
    if (!seeded.current || reduced) {
      seeded.current = true;
      progress.setValue(clamped);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: clamped,
      duration: duration.quick,
      easing,
      // Width is a layout property, so this one cannot leave the JS thread.
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [clamped, progress, reduced]);

  return (
    <View style={[styles.progressTrack, { height, borderRadius: height / 2 }]}>
      <Animated.View
        style={{
          width: progress.interpolate({
            inputRange: [0, 1],
            outputRange: ['0%', '100%'],
          }),
          height: '100%',
          backgroundColor: color,
          borderRadius: height / 2,
        }}
      />
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={26} color={palette.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={palette.neonGreen} />
      {label ? <Text style={styles.loadingLabel}>{label}</Text> : null}
    </View>
  );
}

export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetDismissArea} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.sheetClose}>Done</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function Row({
  left,
  title,
  subtitle,
  right,
  onPress,
}: {
  left?: React.ReactNode;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
}) {
  const content = (
    <>
      {left ? <View style={styles.rowLeft}>{left}</View> : null}
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.rowRight}>{right}</View> : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        {content}
      </Pressable>
    );
  }
  return <View style={styles.row}>{content}</View>;
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xxl * 2, gap: spacing.md },

  titleBlock: { marginBottom: spacing.xs },
  screenTitle: { ...typography.screenTitle, color: palette.textPrimary },
  screenSubtitle: { ...typography.caption, color: palette.textSecondary, marginTop: 2 },

  card: {
    backgroundColor: palette.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.border,
  },
  pressed: { opacity: 0.7 },

  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  cardTitle: { ...typography.cardTitle, color: palette.textPrimary },

  button: {
    paddingVertical: 13,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: { backgroundColor: palette.neonGreen },
  buttonSecondary: {
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.borderStrong,
  },
  buttonGhost: { backgroundColor: 'transparent' },
  buttonDanger: { backgroundColor: 'rgba(255,77,77,0.15)', borderWidth: 1, borderColor: palette.danger },
  buttonDisabled: { opacity: 0.4 },
  buttonPrimaryLabel: { ...typography.bodyBold, color: '#0B0B0C' },
  buttonSecondaryLabel: { ...typography.bodyBold, color: palette.textPrimary },
  buttonDangerLabel: { ...typography.bodyBold, color: palette.danger },

  chip: {
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: radii.pill,
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
  },
  chipLabel: { ...typography.caption, color: palette.textSecondary },
  chipLabelSelected: { color: '#0B0B0C', fontWeight: '700' },

  field: { gap: 6 },
  fieldLabel: { ...typography.micro, color: palette.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  input: {
    backgroundColor: palette.surfaceElevated,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: palette.textPrimary,
    fontSize: 16,
    borderWidth: 1,
    borderColor: palette.border,
  },
  fieldHint: { ...typography.micro, color: palette.textMuted },

  progressTrack: { width: '100%', backgroundColor: palette.surfaceHigh, overflow: 'hidden' },

  empty: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
  },
  emptyTitle: { ...typography.cardTitle, color: palette.textPrimary },
  emptyBody: {
    ...typography.body,
    color: palette.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  emptyAction: { marginTop: spacing.sm, alignSelf: 'stretch', paddingHorizontal: spacing.lg },

  loading: { paddingVertical: spacing.xl, alignItems: 'center', gap: spacing.sm },
  loadingLabel: { ...typography.caption, color: palette.textSecondary },

  sheetBackdrop: { flex: 1, backgroundColor: palette.scrim, justifyContent: 'flex-end' },
  sheetDismissArea: { flex: 1 },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    maxHeight: '88%',
    paddingBottom: spacing.lg,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.surfaceHigh,
    alignSelf: 'center',
    marginTop: spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  sheetTitle: { ...typography.display, fontSize: 22, color: palette.textPrimary },
  sheetClose: { ...typography.bodyBold, color: palette.neonGreen },
  sheetScroll: { flexGrow: 0 },
  sheetContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.md },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, gap: spacing.sm },
  rowLeft: { width: 38, alignItems: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { ...typography.bodyBold, color: palette.textPrimary },
  rowSubtitle: { ...typography.caption, color: palette.textSecondary },
  rowRight: { alignItems: 'flex-end' },
});
