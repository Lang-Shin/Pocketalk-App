import { Ionicons } from '@expo/vector-icons';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type { IconName } from '@/lib/icons';
import { useAppTheme, layout, radii } from '@/theme';
import { AppText } from '../AppText';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'regular' | 'small';

interface AppButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  fullWidth?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  size = 'regular',
  icon,
  fullWidth = false,
  disabled = false,
  style,
  accessibilityHint,
}: AppButtonProps) {
  const { theme } = useAppTheme();

  const palette: Record<
    ButtonVariant,
    { background: string; text: string; border: string }
  > = {
    primary: {
      background: theme.colors.primary,
      text: theme.colors.onPrimary,
      border: theme.colors.primary,
    },
    secondary: {
      background: theme.colors.primarySoft,
      text: theme.colors.primarySoftText,
      border: theme.colors.primarySoft,
    },
    outline: {
      background: 'transparent',
      text: theme.colors.text,
      border: theme.colors.border,
    },
    ghost: {
      background: 'transparent',
      text: theme.colors.primary,
      border: 'transparent',
    },
    danger: {
      background: theme.colors.dangerSoft,
      text: theme.colors.danger,
      border: theme.colors.dangerSoft,
    },
  };

  const colors = palette[variant];
  const small = size === 'small';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: small ? 40 : layout.touchTarget,
          paddingHorizontal: small ? 12 : 18,
          backgroundColor: colors.background,
          borderColor: colors.border,
          opacity: disabled ? 0.45 : pressed ? 0.78 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      <View style={styles.row}>
        {icon ? (
          <Ionicons
            name={icon}
            size={small ? 16 : 18}
            color={colors.text}
          />
        ) : null}
        <AppText
          variant="label"
          color={colors.text}
          weight="semibold"
          numberOfLines={1}
        >
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
