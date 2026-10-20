import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAppTheme, spacing } from '@/theme';
import { AppText } from '../AppText';
import { AppButton } from './AppButton';

export function LoadingState({ label = 'Loading your money map…' }: { label?: string }) {
  const { theme } = useAppTheme();

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={styles.container}
    >
      <ActivityIndicator size="small" color={theme.colors.primary} />
      <AppText variant="bodySmall" color={theme.colors.textSecondary}>
        {label}
      </AppText>
    </View>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  const { theme } = useAppTheme();

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.iconCircle,
          { backgroundColor: theme.colors.dangerSoft },
        ]}
      >
        <Ionicons
          name="alert-circle-outline"
          size={24}
          color={theme.colors.danger}
        />
      </View>
      <AppText variant="h3" align="center">
        We could not load this screen
      </AppText>
      <AppText
        variant="bodySmall"
        align="center"
        color={theme.colors.textSecondary}
      >
        {message}
      </AppText>
      <AppButton label="Try again" icon="refresh" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
