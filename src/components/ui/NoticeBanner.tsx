import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import type { IconName } from '@/lib/icons';
import { useAppTheme, radii, spacing } from '@/theme';
import { AppText } from '../AppText';

type NoticeTone = 'info' | 'warning' | 'success';

interface NoticeBannerProps {
  title: string;
  message?: string;
  tone?: NoticeTone;
  icon?: IconName;
}

export function NoticeBanner({
  title,
  message,
  tone = 'info',
  icon,
}: NoticeBannerProps) {
  const { theme } = useAppTheme();

  const palette = {
    info: {
      background: theme.colors.primarySoft,
      foreground: theme.colors.primarySoftText,
      defaultIcon: 'information-circle-outline' as IconName,
    },
    warning: {
      background: theme.colors.warningSoft,
      foreground: theme.colors.warning,
      defaultIcon: 'alert-circle-outline' as IconName,
    },
    success: {
      background: theme.colors.successSoft,
      foreground: theme.colors.success,
      defaultIcon: 'checkmark-circle-outline' as IconName,
    },
  }[tone];

  return (
    <View
      accessibilityRole="summary"
      style={[
        styles.container,
        {
          backgroundColor: palette.background,
          borderColor: palette.foreground + '33',
        },
      ]}
    >
      <Ionicons
        name={icon ?? palette.defaultIcon}
        size={20}
        color={palette.foreground}
      />
      <View style={styles.copy}>
        <AppText variant="label" color={palette.foreground}>
          {title}
        </AppText>
        {message ? (
          <AppText variant="caption" color={palette.foreground}>
            {message}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
});
