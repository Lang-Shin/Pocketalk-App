import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import type { IconName } from '@/lib/icons';
import { useAppTheme, layout, radii } from '@/theme';
import { AppText } from '../AppText';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
}

export function Chip({ label, selected = false, onPress, icon }: ChipProps) {
  const { theme } = useAppTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected
            ? theme.colors.primary
            : theme.colors.surface,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={14}
          color={
            selected ? theme.colors.onPrimary : theme.colors.textSecondary
          }
        />
      ) : null}
      <AppText
        variant="caption"
        weight="semibold"
        color={selected ? theme.colors.onPrimary : theme.colors.textSecondary}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: layout.touchTarget,
    minWidth: 64,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
});
