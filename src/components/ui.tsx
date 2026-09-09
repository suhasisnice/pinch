import React, { useEffect, useRef, useState } from 'react';
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
import { elevation, layer, palette, radii, spacing, stateLayer, typography } from '../theme/theme';
import { duration, easing, usePressScale, useReducedMotion } from './motion';
import Icon, { IconName } from './Icon';

/**
 * Shared primitives, in Material You's dark resolution.
 *
 * Everything visual in the app composes from this file, which is the point:
 * a screen should never reach for a raw colour or a radius of its own. Where
 * one does, that is a gap here worth closing rather than a local style worth
 * writing.
 */

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
        // A state layer, not a colour change: the surface keeps its identity
        // and simply takes on a film of the content colour while held.
        style={({ pressed }) => [
          styles.card,
          style,
          pressed && { backgroundColor: layer(palette.primary, stateLayer.press) },
        ]}
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

/**
 * MD3's button family. Every one of them is a pill — the single most
 * recognisable thing about this design language, and the first thing that
 * looks wrong if it is only *mostly* rounded.
 *
 * The older names (primary/secondary/ghost) still work and map onto the MD3
 * ones, so no screen had to be rewritten to adopt this.
 */
export function Button({
  label,
  onPress,
  variant = 'filled',
  disabled = false,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'filled' | 'tonal' | 'outlined' | 'text' | 'danger' | 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  icon?: IconName;
  style?: ViewStyle;
}) {
  const press = usePressScale();

  const resolved =
    variant === 'primary'
      ? 'filled'
      : variant === 'secondary'
        ? 'tonal'
        : variant === 'ghost'
          ? 'text'
          : variant;

  const containerStyle = {
    filled: styles.buttonFilled,
    tonal: styles.buttonTonal,
    outlined: styles.buttonOutlined,
    text: styles.buttonText,
    danger: styles.buttonDanger,
  }[resolved];

  const labelColor = {
    filled: palette.onPrimary,
    tonal: palette.onSecondaryContainer,
    outlined: palette.primary,
    text: palette.primary,
    danger: palette.onErrorContainer,
  }[resolved];

  // The caller's style carries layout (a flex:1 in a button row), so it rides
  // on the wrapper; the visual styles stay on the pressable that is scaling.
  return (
    <Animated.View style={[style, press.style]}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        onPressIn={disabled ? undefined : press.onPressIn}
        onPressOut={disabled ? undefined : press.onPressOut}
        style={({ pressed }) => [
          styles.button,
          containerStyle,
          pressed && { backgroundColor: layer(labelColor, stateLayer.press) },
          disabled && styles.buttonDisabled,
        ]}
      >
        {icon ? <Icon name={icon} size={18} color={labelColor} /> : null}
        <Text style={[styles.buttonLabel, { color: labelColor }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Floating action button. Tertiary-coloured by MD3 convention, which is what
 * keeps it from competing with every filled button on the screen.
 */
export function FAB({
  icon,
  label,
  onPress,
  style,
}: {
  icon: IconName;
  label?: string;
  onPress: () => void;
  style?: ViewStyle;
}) {
  const press = usePressScale(0.94);

  return (
    <Animated.View style={[style, press.style, elevation.level3]}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={({ pressed }) => [
          styles.fab,
          label ? styles.fabExtended : null,
          pressed && { backgroundColor: layer(palette.onTertiary, stateLayer.press) },
        ]}
      >
        <Icon name={icon} size={22} color={palette.onTertiary} />
        {label ? <Text style={styles.fabLabel}>{label}</Text> : null}
      </Pressable>
    </Animated.View>
  );
}

/**
 * A soft, out-of-focus orb of colour.
 *
 * MD3's atmospheric backgrounds are CSS blur on a coloured shape, which
 * React Native has no equivalent for — expo-blur blurs what is *behind* a
 * view, not the view itself. A radial gradient fading to nothing produces
 * the same effect honestly, and on the GPU, which a stack of translucent
 * circles faking a falloff would not.
 */
export function BlurOrb({
  color,
  size,
  opacity = 0.28,
  style,
}: {
  color: string;
  size: number;
  opacity?: number;
  style?: ViewStyle;
}) {
  // Concentric rings, each a little wider and fainter: an approximation of a
  // gaussian falloff cheap enough to leave running behind a scrolling list.
  const rings = 6;
  return (
    <View pointerEvents="none" style={[{ width: size, height: size }, style]}>
      {Array.from({ length: rings }).map((_, index) => {
        const scale = (index + 1) / rings;
        const ringSize = size * scale;
        return (
          <View
            key={index}
            style={{
              position: 'absolute',
              left: (size - ringSize) / 2,
              top: (size - ringSize) / 2,
              width: ringSize,
              height: ringSize,
              borderRadius: ringSize / 2,
              backgroundColor: color,
              opacity: (opacity / rings) * (rings - index) * 0.6,
            }}
          />
        );
      })}
    </View>
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
  const selectedBackground = color ?? palette.secondaryContainer;
  const selectedLabel = color ? palette.onPrimary : palette.onSecondaryContainer;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && { backgroundColor: selectedBackground, borderColor: 'transparent' },
        pressed && { backgroundColor: layer(palette.primary, stateLayer.press) },
      ]}
    >
      <Text style={[styles.chipLabel, selected && { color: selectedLabel, fontWeight: '500' }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * MD3's filled text field: rounded at the top, square along the bottom, and
 * underlined by a rule that takes the primary colour while focused. The
 * shape is the affordance — it reads as somewhere to type before you have
 * read the label.
 */
export function Field({
  label,
  hint,
  ...inputProps
}: TextInputProps & { label: string; hint?: string }) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, focused && { color: palette.primary }]}>{label}</Text>
      <TextInput
        placeholderTextColor={palette.textMuted}
        {...inputProps}
        onFocus={(event) => {
          setFocused(true);
          inputProps.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          inputProps.onBlur?.(event);
        }}
        style={[
          styles.input,
          focused && { borderBottomColor: palette.primary },
          inputProps.style,
        ]}
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
  color = palette.primary,
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
        <Icon name={icon} size={26} color={palette.onSecondaryContainer} />
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
      <ActivityIndicator color={palette.primary} />
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
            <Pressable onPress={onClose} hitSlop={12} style={styles.sheetCloseHit}>
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

  if (!onPress) return <View style={styles.row}>{content}</View>;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && {
          backgroundColor: layer(palette.primary, stateLayer.press),
          borderRadius: radii.sm,
        },
      ]}
    >
      {content}
    </Pressable>
  );
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

  // Tonal separation, not a border: MD3 leans on the surface stepping up a
  // tone rather than drawing a line around everything.
  card: {
    backgroundColor: palette.surfaceContainerLow,
    borderRadius: radii.lg,
    padding: spacing.md,
    ...elevation.level1,
  },

  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  cardTitle: { ...typography.cardTitle, color: palette.textPrimary },

  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 44, // WCAG touch target, and MD3's comfortable button height.
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
  },
  buttonFilled: { backgroundColor: palette.primary },
  buttonTonal: { backgroundColor: palette.secondaryContainer },
  buttonOutlined: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: palette.outline,
  },
  buttonText: { backgroundColor: 'transparent', paddingHorizontal: spacing.md },
  buttonDanger: { backgroundColor: palette.errorContainer },
  buttonDisabled: { opacity: 0.38 },
  buttonLabel: { ...typography.label },

  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    width: 56,
    height: 56,
    borderRadius: radii.fab,
    backgroundColor: palette.tertiary,
  },
  fabExtended: { width: 'auto', paddingHorizontal: spacing.lg },
  fabLabel: { ...typography.label, color: palette.onTertiary },

  chip: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: palette.outlineVariant,
  },
  chipLabel: { ...typography.micro, color: palette.textSecondary },

  field: { gap: 6 },
  fieldLabel: {
    ...typography.micro,
    color: palette.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  // Rounded at the top, square at the bottom, underlined: the MD3 filled
  // text field. The asymmetry is the whole signature — rounding all four
  // corners turns it back into a generic box.
  input: {
    backgroundColor: palette.surfaceContainerHigh,
    borderTopLeftRadius: radii.input,
    borderTopRightRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    color: palette.textPrimary,
    fontSize: 16,
    borderBottomWidth: 2,
    borderBottomColor: palette.outline,
  },
  fieldHint: { ...typography.micro, color: palette.textMuted },

  progressTrack: {
    width: '100%',
    backgroundColor: palette.surfaceContainerHighest,
    overflow: 'hidden',
  },

  empty: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.secondaryContainer,
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
    backgroundColor: palette.surfaceContainerLow,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    maxHeight: '88%',
    paddingBottom: spacing.lg,
  },
  sheetHandle: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.outlineVariant,
    alignSelf: 'center',
    marginTop: spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  sheetTitle: { ...typography.display, fontSize: 24, lineHeight: 32, color: palette.textPrimary },
  sheetCloseHit: { paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radii.pill },
  sheetClose: { ...typography.label, color: palette.primary },
  sheetScroll: { flexGrow: 0 },
  sheetContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.md },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: spacing.sm },
  rowLeft: { width: 38, alignItems: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { ...typography.bodyBold, color: palette.textPrimary },
  rowSubtitle: { ...typography.caption, color: palette.textSecondary },
  rowRight: { alignItems: 'flex-end' },
});
