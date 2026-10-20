import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import type { IconName } from '@/lib/icons';
import { useAppTheme, spacing } from '@/theme';
import { AppText } from '../AppText';
import { AppButton } from './AppButton';

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  title,
  description,
  icon = 'leaf-outline',
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const { theme } = useAppTheme();

  return (
    <View style={styles.container}>
      <View
        style={[styles.iconCircle, { backgroundColor: theme.colors.primarySoft }]}
      >
        <Ionicons name={icon} size={26} color={theme.colors.primarySoftText} />
      </View>
      <AppText variant="h3" align="center">
        {title}
      </AppText>
      <AppText
        variant="bodySmall"
        align="center"
        color={theme.colors.textSecondary}
      >
        {description}
      </AppText>
      {actionLabel && onAction ? (
        <AppButton label={actionLabel} onPress={onAction} size="small" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
});
