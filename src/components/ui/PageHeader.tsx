import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme, spacing } from '@/theme';
import { AppText } from '../AppText';
import { IconButton } from './IconButton';

interface PageHeaderProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  preview?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function PageHeader({
  title,
  eyebrow,
  subtitle,
  onBack,
  right,
  preview = true,
  style,
}: PageHeaderProps) {
  const { theme } = useAppTheme();

  return (
    <View style={[styles.container, style]}>
      <View style={styles.row}>
        {onBack ? (
          <IconButton
            icon="arrow-back"
            accessibilityLabel="Go back"
            onPress={onBack}
            variant="ghost"
          />
        ) : null}
        <View style={styles.copy}>
          {eyebrow ? (
            <AppText
              variant="micro"
              color={theme.colors.textTertiary}
              style={styles.eyebrow}
            >
              {eyebrow.toUpperCase()}
            </AppText>
          ) : null}
          <AppText variant="h1">{title}</AppText>
        </View>
        {right}
      </View>
      {subtitle ? (
        <AppText variant="bodySmall" color={theme.colors.textSecondary}>
          {subtitle}
        </AppText>
      ) : null}
      {preview ? (
        <View
          style={[
            styles.previewPill,
            { backgroundColor: theme.colors.surfaceAlt },
          ]}
        >
          <Ionicons
            name="flask-outline"
            size={12}
            color={theme.colors.textSecondary}
          />
          <AppText variant="micro" color={theme.colors.textSecondary}>
            SAMPLE DATA
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    letterSpacing: 1.1,
  },
  previewPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
});
