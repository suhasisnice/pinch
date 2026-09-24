import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CATEGORIES, SUBCATEGORIES, isCategory } from '../math/categoryTaxonomy';
import { categoryColor, palette, spacing, typography } from '../theme/theme';
import { Chip } from './ui';

export interface CategoryChoice {
  category: string | null;
  subcategory: string | null;
}

/**
 * Picks a category, then optionally one level deeper.
 *
 * The top level is always the first choice, because that is what every
 * chart and budget adds up. Sub-categories only appear once a category is
 * chosen, and are optional: "Food" alone is a complete answer.
 */
export default function CategoryPicker({
  value,
  onChange,
  label = 'Category',
}: {
  value: CategoryChoice;
  onChange: (next: CategoryChoice) => void;
  label?: string;
}) {
  const subs = isCategory(value.category) ? SUBCATEGORIES[value.category] : [];

  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.wrap}>
        {CATEGORIES.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={value.category === option}
            color={value.category === option ? categoryColor(option) : undefined}
            onPress={() =>
              onChange(
                value.category === option
                  ? { category: null, subcategory: null }
                  : { category: option, subcategory: null }
              )
            }
          />
        ))}
      </View>
      {subs.length > 0 ? (
        <>
          <Text style={styles.subLabel}>More exactly (optional)</Text>
          <View style={styles.wrap}>
            {subs.map((sub) => (
              <Chip
                key={sub}
                label={sub}
                selected={value.subcategory === sub}
                onPress={() =>
                  onChange({
                    category: value.category,
                    subcategory: value.subcategory === sub ? null : sub,
                  })
                }
              />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  label: { ...typography.sectionLabel, color: palette.textSecondary },
  subLabel: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xs },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
