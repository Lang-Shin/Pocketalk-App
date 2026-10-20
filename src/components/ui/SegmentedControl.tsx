import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import type { IconName } from '@/lib/icons';
import { useAppTheme, layout, radii } from '@/theme';
import { AppText } from '../AppText';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: SegmentedControlProps<T>) {
  const { theme } = useAppTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.surfaceAlt,
          borderColor: theme.colors.border,
        },
      ]}
    >
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.option,
              selected
                ? {
                    backgroundColor: theme.colors.surface,
                    ...theme.shadows.card,
                  }
                : null,
              { opacity: pressed ? 0.78 : 1 },
            ]}
          >
            {option.icon ? (
              <Ionicons
                name={option.icon}
                size={15}
                color={
                  selected ? theme.colors.primary : theme.colors.textSecondary
                }
              />
            ) : null}
            <AppText
              variant="caption"
              weight="semibold"
              color={
                selected ? theme.colors.text : theme.colors.textSecondary
              }
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  option: {
    flex: 1,
    minHeight: layout.touchTarget,
    borderRadius: radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
});
