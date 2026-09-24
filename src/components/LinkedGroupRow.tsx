import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { TransactionRow } from '../db/types';
import { LedgerItem } from '../math/reimbursement';
import { formatMoney } from '../utils/format';
import {
  categoryColor,
  layer,
  palette,
  radii,
  spacing,
  stateLayer,
  typography,
} from '../theme/theme';
import { duration, easing, useReducedMotion } from './motion';
import { Dot } from './ui';
import Icon from './Icon';

type Group = Extract<LedgerItem, { type: 'group' }>;

/**
 * A spend and the money that paid it back, as one line at the net.
 *
 * Collapsed, it reads the way the user thinks about it — "dinner cost me
 * 600" — rather than as a 2,400 out and an 1,800 in to be subtracted by eye.
 * Tapping opens it to the real movements underneath, each still tappable,
 * because both still happened and the bank statement will show both.
 */
export default function LinkedGroupRow({
  group,
  onOpen,
}: {
  group: Group;
  onOpen: (transaction: TransactionRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const to = expanded ? 1 : 0;
    if (reduced) {
      progress.setValue(to);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: to,
      duration: duration.short,
      easing,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [expanded, progress, reduced]);

  const spends = group.members.filter((m) => m.direction === 'DEBIT');
  const credits = group.members.filter((m) => m.direction === 'CREDIT');

  const title =
    spends.length === 0
      ? 'Paid back'
      : spends.length === 1
        ? spends[0].merchant
        : `${spends[0].merchant} + ${spends.length - 1} more`;
  const payers = [...new Set(credits.map((c) => c.merchant))];
  const subtitle =
    payers.length === 0
      ? 'Linked'
      : `Paid back by ${payers.length === 1 ? payers[0] : `${payers[0]} + ${payers.length - 1}`}`;

  const even = Math.abs(group.net) < 0.01;
  const moneyIn = group.net < 0;

  return (
    <View>
      <Pressable
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title}, ${subtitle}, net ${even ? 'nothing' : formatMoney(Math.abs(group.net))}`}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: layer(palette.textPrimary, 0.05) },
        ]}
      >
        <View style={styles.badge}>
          <Icon name="check" size={12} color={palette.textPrimary} />
        </View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <View style={styles.right}>
          <Text style={[styles.net, (even || moneyIn) && { color: palette.textPrimary }]}>
            {even ? 'Even' : `${moneyIn ? '+' : '−'}${formatMoney(Math.abs(group.net))}`}
          </Text>
          <Animated.View
            style={{
              transform: [
                {
                  rotate: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '180deg'],
                  }),
                },
              ],
            }}
          >
            <Icon name="chevronDown" size={16} color={palette.textMuted} />
          </Animated.View>
        </View>
      </Pressable>

      {expanded ? (
        <Animated.View
          style={[
            styles.members,
            {
              opacity: progress,
              transform: [
                { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) },
              ],
            },
          ]}
        >
          {group.members.map((member) => (
            <Pressable
              key={member.id}
              onPress={() => onOpen(member)}
              accessibilityRole="button"
              accessibilityLabel={`${member.merchant}, ${member.direction === 'CREDIT' ? 'received' : 'paid'} ${formatMoney(member.amount)}`}
              style={({ pressed }) => [
                styles.member,
                pressed && { backgroundColor: layer(palette.textPrimary, 0.05) },
              ]}
            >
              <Dot
                color={
                  member.direction === 'CREDIT'
                    ? palette.textPrimary
                    : categoryColor(member.category)
                }
                size={8}
              />
              <Text style={styles.memberTitle} numberOfLines={1}>
                {member.merchant}
              </Text>
              <Text
                style={[
                  styles.memberAmount,
                  member.direction === 'CREDIT' && { color: palette.textPrimary },
                ]}
              >
                {member.direction === 'CREDIT' ? '+' : '−'}
                {formatMoney(member.amount)}
              </Text>
            </Pressable>
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
  },
  badge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: palette.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  title: { ...typography.body, color: palette.textPrimary },
  subtitle: { ...typography.caption, color: palette.textSecondary },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  net: { ...typography.bodyBold, color: palette.textPrimary },

  members: {
    marginLeft: spacing.sm + 1,
    paddingLeft: spacing.md,
    borderLeftWidth: 1,
    borderLeftColor: palette.border,
    marginBottom: spacing.xs,
  },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.xs,
  },
  memberTitle: { ...typography.caption, color: palette.textSecondary, flex: 1 },
  memberAmount: { ...typography.caption, color: palette.textSecondary },
});
