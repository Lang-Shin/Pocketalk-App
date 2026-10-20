import { Pressable, StyleSheet, View } from 'react-native';

import { useAppTheme, spacing } from '@/theme';
import { AppText } from '../AppText';

interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  subtitle?: string;
}

export function SectionHeader({
  title,
  actionLabel,
  onAction,
  subtitle,
}: SectionHeaderProps) {
  const { theme } = useAppTheme();

  return (
    <View style={styles.container}>
      <View style={styles.copy}>
        <AppText variant="h3">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" color={theme.colors.textSecondary}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          hitSlop={8}
          style={({ pressed }) => [{ opacity: pressed ? 0.65 : 1 }]}
        >
          <AppText variant="label" color={theme.colors.primary}>
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
});
