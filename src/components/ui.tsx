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
import {
  elevation,
  layer,
  onColor,
  palette,
  radii,
  spacing,
  stateLayer,
  typography,
} from '../theme/theme';
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
  underHeader = false,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  refreshControl?: React.ReactElement;
  /**
   * A stack screen whose navigation header already clears the status bar.
   * Insetting again left a status-bar-sized gap under the back arrow.
   */
  underHeader?: boolean;
}) {
  const edges: Array<'top'> = underHeader ? [] : ['top'];
  if (!scroll) {
    return (
      <SafeAreaView style={styles.screen} edges={edges}>
        {children}
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
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

/**
 * The screen's name, and at most one action beside it.
 *
 * The action sits here, small, rather than as a full-width green pill above
 * the content: a tab whose first and loudest element is "create another"
 * leads with the least common task. It stays the primary colour, so it is
 * still the obvious thing to tap when that is what you came for.
 */
export function ScreenTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void; icon?: IconName };
}) {
  return (
    <View style={[styles.titleBlock, action && styles.titleRow]}>
      <View style={styles.titleText}>
        <Text style={styles.screenTitle}>{title}</Text>
        {subtitle ? <Text style={styles.screenSubtitle}>{subtitle}</Text> : null}
      </View>
      {action ? (
        <Button
          label={action.label}
          icon={action.icon ?? 'add'}
          onPress={action.onPress}
          size="small"
          variant="tonal"
        />
      ) : null}
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
        accessibilityRole="button"
        // A state layer, not a colour change: the surface keeps its identity
        // and simply takes on a film of the content colour while held.
        style={({ pressed }) => [
          styles.card,
          style,
          pressed && { backgroundColor: layer(palette.accent, stateLayer.press) },
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
  size = 'regular',
}: {
  label: string;
  onPress: () => void;
  variant?: 'filled' | 'tonal' | 'outlined' | 'text' | 'danger' | 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  icon?: IconName;
  style?: ViewStyle;
  /** 'small' is for a header action beside a screen title. */
  size?: 'regular' | 'small';
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
    filled: palette.onAccent,
    // Spec: "Secondary: Dark pill" — a neutral dark surface, not a tint of
    // the one accent (that would read as a second, weaker green button).
    tonal: palette.textPrimary,
    outlined: palette.textPrimary,
    // Green is state and the primary action, not the colour of every
    // tappable word — a text button is quiet by design.
    text: palette.textPrimary,
    // Red on its own muted red, so it reads as a live destructive action
    // rather than a disabled one.
    danger: palette.danger,
  }[resolved];

  // The spec reserves capitals for the primary action. Every other button in
  // sentence case is what keeps a sheet with four actions from shouting.
  const labelStyle = resolved === 'filled' ? styles.buttonLabel : styles.buttonLabelQuiet;

  // The caller's style carries layout (a flex:1 in a button row), so it rides
  // on the wrapper; the visual styles stay on the pressable that is scaling.
  return (
    <Animated.View style={[style, press.style]}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        onPressIn={disabled ? undefined : press.onPressIn}
        onPressOut={disabled ? undefined : press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [
          styles.button,
          containerStyle,
          size === 'small' && styles.buttonSmall,
          pressed && { backgroundColor: layer(labelColor, stateLayer.press) },
          disabled && styles.buttonDisabled,
        ]}
      >
        {icon ? <Icon name={icon} size={size === 'small' ? 16 : 18} color={labelColor} /> : null}
        <Text style={[labelStyle, size === 'small' && styles.buttonLabelSmall, { color: labelColor }]}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * A compact circular icon action — the spec's "Icon actions: Compact
 * circular/rounded control", not a Material extended FAB with a label
 * riding along it. `PHASE_3_TODAY.md` itself argues the Today add-action
 * should be "a compact floating pill... rather than a giant floating
 * circle," which points toward `Button` for that specific case; this stays
 * available for a genuine icon-only floating action elsewhere.
 *
 * (Currently unused by any screen — kept as a design-system primitive for
 * whichever phase needs a floating icon action next.)
 */
export function FAB({
  icon,
  onPress,
  accessibilityLabel,
  style,
}: {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  style?: ViewStyle;
}) {
  const press = usePressScale(0.94);

  return (
    <Animated.View style={[style, press.style, elevation.level2]}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [
          styles.fab,
          pressed && { backgroundColor: layer(palette.onAccent, stateLayer.press) },
        ]}
      >
        <Icon name={icon} size={22} color={palette.onAccent} />
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
  const selectedBackground = color ?? palette.accent;
  // A caller-supplied tint can be any colour, so the label is measured
  // against it rather than assumed. See onColor in theme.ts.
  const selectedLabel = color ? onColor(color) : palette.onAccent;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        selected && { backgroundColor: selectedBackground },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.chipLabel, selected && { color: selectedLabel }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A row of filter chips that scrolls sideways instead of wrapping onto a
 * second line — one line of options, the way every music app does it.
 */
export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipScroll}
      contentContainerStyle={styles.chipScrollContent}
    >
      {children}
    </ScrollView>
  );
}

/** A search well: the magnifier says what it is, so it needs no label. */
export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search',
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.search, focused && { borderColor: palette.accent }]}>
      <Icon name="search" size={18} color={palette.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.searchInput}
        returnKeyType="search"
        accessibilityLabel={placeholder}
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
          <Icon name="close" size={16} color={palette.textMuted} />
        </Pressable>
      ) : null}
    </View>
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
      <Text style={[styles.fieldLabel, focused && { color: palette.accent }]}>{label}</Text>
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
          focused && { borderColor: palette.accent },
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
  color = palette.accent,
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
      {/* A quiet glyph, not a badge. An icon in a tinted circle is the stock
          empty state of every generated template; here the words do the
          work and the icon only sets the subject. */}
      <Icon name={icon} size={24} color={palette.textMuted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={palette.accent} />
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
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.sheetCloseHit}
            >
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
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      style={({ pressed }) => [
        styles.row,
        pressed && {
          backgroundColor: layer(palette.accent, stateLayer.press),
          borderRadius: radii.sm,
        },
      ]}
    >
      {content}
    </Pressable>
  );
}

/**
 * A section heading that sits on the page, not inside a box. Most of what a
 * screen shows is a list with a name; wrapping each in a card is the
 * "card per concept" look the spec warns against.
 */
export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  /** A short text action on the right, e.g. "See all". */
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={12} accessibilityRole="button" accessibilityLabel={action}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * One section of a screen: a heading on the page, and its rows together on
 * one surface, separated by hairlines.
 *
 * The container is what makes a screen read as segments instead of one long
 * scroll — things inside a shared boundary are seen as belonging together
 * (common region), so the eye can take a screen in as five chunks rather than
 * forty lines. It groups a *concept*, never a single row: a card per row is
 * what the spec rules out, a surface per section is what it asks for.
 */
export function Group({
  title,
  action,
  onAction,
  footer,
  children,
}: {
  title?: string;
  action?: string;
  onAction?: () => void;
  /** One short line under the surface — a key to what is above, not an essay. */
  footer?: string;
  children: React.ReactNode;
}) {
  const items = React.Children.toArray(children).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <View style={styles.group}>
      {title ? <SectionHeader title={title} action={action} onAction={onAction} /> : null}
      <View style={styles.groupSurface}>
        {items.map((child, index) => (
          <React.Fragment key={(child as React.ReactElement).key ?? index}>
            {index > 0 ? <View style={styles.divider} /> : null}
            {child}
          </React.Fragment>
        ))}
      </View>
      {footer ? <Text style={styles.groupFooter}>{footer}</Text> : null}
    </View>
  );
}

/**
 * A person, as their initials on a round tile. People get a face, things get
 * an icon: the shape alone tells a contact row from a merchant row.
 */
export function Avatar({ name, size = 38 }: { name: string; size?: number }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('') || '?';
  return (
    <View
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Text style={[styles.avatarText, { fontSize: Math.round(size * 0.36) }]}>{initials}</Text>
    </View>
  );
}

/**
 * Two figures side by side on one surface, split by a hairline — for a pair
 * that is read together ("owed to you" / "you owe"), which as two separate
 * cards looked like two unrelated things.
 */
export function StatPair({
  items,
}: {
  items: Array<{ label: string; value: string; color?: string }>;
}) {
  return (
    <View style={styles.statPair}>
      {items.map((item, index) => (
        <React.Fragment key={item.label}>
          {index > 0 ? <View style={styles.statDivider} /> : null}
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>{item.label}</Text>
            <Text
              style={[styles.statValue, item.color ? { color: item.color } : null]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {item.value}
            </Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

/** A hairline between rows of one list. */
export function Divider() {
  return <View style={styles.divider} />;
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  // The spec's 20px gutter, and 24px between sections so a screen reads as
  // a few distinct blocks rather than one even stack. Things that belong
  // together stay close inside their own section (8px), which is what makes
  // the larger gap between sections legible as structure.
  scrollContent: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.lg,
  },

  titleBlock: { marginBottom: spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  titleText: { flex: 1 },
  screenTitle: { ...typography.screenTitle, color: palette.textPrimary },
  screenSubtitle: { ...typography.caption, color: palette.textSecondary, marginTop: 2 },

  // Tonal separation only. A drop shadow on #121212 is invisible except as
  // a smudge along the bottom edge, and the spec asks for contrast between
  // surfaces over shadows.
  card: {
    backgroundColor: palette.surface,
    borderRadius: radii.card,
    padding: spacing.md,
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
  buttonFilled: { backgroundColor: palette.accent },
  // Spec: "Secondary: Dark pill" — not a green tint (see labelColor above).
  buttonTonal: { backgroundColor: palette.surfaceElevated },
  buttonOutlined: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: palette.border,
  },
  buttonText: { backgroundColor: 'transparent', paddingHorizontal: spacing.md },
  buttonDanger: { backgroundColor: palette.dangerMuted },
  buttonDisabled: { opacity: 0.38 },
  buttonLabel: { ...typography.label },
  buttonLabelQuiet: { ...typography.bodyBold, fontSize: 15, letterSpacing: 0.1 },
  buttonSmall: { minHeight: 36, paddingVertical: 7, paddingHorizontal: spacing.md, gap: 6 },
  buttonLabelSmall: { fontSize: 13 },

  // 48px, not MD3's standard 56 — "compact," per the spec's icon-action language.
  fab: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: palette.accent,
  },

  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: palette.surfaceElevated,
  },
  chipLabel: { ...typography.caption, fontWeight: '600', color: palette.textPrimary },
  chipScroll: { flexGrow: 0, marginHorizontal: -spacing.gutter },
  chipScrollContent: { gap: spacing.sm, paddingHorizontal: spacing.gutter },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surfaceElevated,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  searchInput: { flex: 1, color: palette.textPrimary, fontSize: 16, paddingVertical: 12 },

  field: { gap: 6 },
  // Sentence case, weight for hierarchy. Capitals with wide tracking on
  // every label is the default of every template; the spec only asks for
  // uppercase on button labels.
  fieldLabel: { ...typography.caption, fontWeight: '600', color: palette.textSecondary },
  // A filled, softly rounded well that takes a green ring while focused —
  // Spotify's search field, not the MD3 underline it replaces.
  input: {
    backgroundColor: palette.surfaceElevated,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    color: palette.textPrimary,
    fontSize: 16,
  },
  fieldHint: { ...typography.caption, color: palette.textMuted },

  progressTrack: {
    width: '100%',
    backgroundColor: palette.surfaceElevated,
    overflow: 'hidden',
  },

  empty: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.sm },
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
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
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
  sheetClose: { ...typography.bodyBold, color: palette.textPrimary },
  sheetScroll: { flexGrow: 0 },
  sheetContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.md },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: spacing.sm },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  sectionTitle: { ...typography.cardTitle, color: palette.textPrimary },
  sectionAction: { ...typography.caption, fontWeight: '600', color: palette.textSecondary },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.border },
  group: { gap: spacing.xs },
  groupSurface: {
    backgroundColor: palette.surface,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    overflow: "hidden",
  },
  groupFooter: { ...typography.caption, color: palette.textMuted, paddingHorizontal: spacing.xs, marginTop: 2 },
  avatar: {
    backgroundColor: palette.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontWeight: '700', color: palette.textPrimary, letterSpacing: 0.3 },
  statPair: {
    flexDirection: 'row',
    backgroundColor: palette.surface,
    borderRadius: radii.card,
    paddingVertical: spacing.md,
  },
  statDivider: { width: StyleSheet.hairlineWidth, backgroundColor: palette.border },
  statCell: { flex: 1, paddingHorizontal: spacing.md, gap: 2 },
  statLabel: { ...typography.caption, color: palette.textSecondary },
  statValue: { ...typography.heroCompact, fontSize: 26, lineHeight: 32, color: palette.textPrimary },
  rowLeft: { width: 38, alignItems: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { ...typography.bodyBold, color: palette.textPrimary },
  rowSubtitle: { ...typography.caption, color: palette.textSecondary },
  rowRight: { alignItems: 'flex-end' },
});
