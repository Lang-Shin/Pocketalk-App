import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import type { IconName } from '@/lib/icons';
import { useAppTheme, radii, spacing, type Tone } from '@/theme';
import { AppText } from '../AppText';
import { IconBadge } from './IconBadge';

interface SettingRowProps {
  icon: IconName;
  tone?: Tone;
  label: string;
  description?: string;
  value?: string;
  onPress?: () => void;
  rightElement?: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
}

export function SettingRow({
  icon,
  tone = 'emerald',
  label,
  description,
  value,
  onPress,
  rightElement,
  disabled = false,
  destructive = false,
}: SettingRowProps) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const showChevron = Boolean(onPress) && !rightElement;
  const stackValue = width < 400;

  const content = (
    <>
      <IconBadge icon={icon} tone={tone} size={38} iconSize={18} />
      <View style={styles.copy}>
        <AppText
          variant="bodySmall"
          weight="semibold"
          color={destructive ? theme.colors.danger : theme.colors.text}
        >
          {label}
        </AppText>
        {description ? (
          <AppText variant="caption" color={theme.colors.textSecondary}>
            {description}
          </AppText>
        ) : null}
        {value && stackValue ? (
          <AppText
            variant="caption"
            weight="semibold"
            color={theme.colors.textSecondary}
          >
            {value}
          </AppText>
        ) : null}
      </View>
      {value && !stackValue ? (
        <AppText
          variant="caption"
          color={theme.colors.textSecondary}
          numberOfLines={2}
          style={styles.value}
        >
          {value}
        </AppText>
      ) : null}
      {rightElement}
      {showChevron ? (
        <Ionicons
          name="chevron-forward"
          size={18}
          color={theme.colors.textTertiary}
        />
      ) : null}
    </>
  );

  if (!onPress || disabled) {
    return (
      <View
        accessibilityState={{ disabled }}
        style={[styles.row, { opacity: disabled ? 0.5 : 1 }]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          opacity: pressed ? 0.7 : 1,
          backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
        },
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: -spacing.md,
  },
  copy: {
    flex: 1,
    gap: 1,
  },
  value: {
    flexShrink: 1,
    maxWidth: '45%',
    textAlign: 'right',
  },
});
