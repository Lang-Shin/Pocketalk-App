import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import type { IconName } from '@/lib/icons';
import { useAppTheme, layout, radii } from '@/theme';

interface IconButtonProps {
  icon: IconName;
  accessibilityLabel: string;
  onPress: () => void;
  variant?: 'surface' | 'ghost' | 'primary';
  size?: number;
  disabled?: boolean;
}

export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  variant = 'surface',
  size = 44,
  disabled = false,
}: IconButtonProps) {
  const { theme } = useAppTheme();

  const backgroundColor =
    variant === 'primary'
      ? theme.colors.primary
      : variant === 'surface'
        ? theme.colors.surface
        : 'transparent';
  const iconColor =
    variant === 'primary'
      ? theme.colors.onPrimary
      : variant === 'surface'
        ? theme.colors.text
        : theme.colors.textSecondary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.button,
        {
          width: size,
          height: size,
          borderRadius: radii.pill,
          backgroundColor,
          borderColor:
            variant === 'surface' ? theme.colors.border : 'transparent',
          opacity: disabled ? 0.45 : pressed ? 0.72 : 1,
        },
        variant === 'surface' ? theme.shadows.card : null,
      ]}
    >
      <Ionicons name={icon} size={20} color={iconColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: layout.touchTarget,
    minHeight: layout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
