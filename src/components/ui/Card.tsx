import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { useAppTheme, radii, spacing } from '@/theme';

interface CardProps extends ViewProps {
  padded?: boolean;
}

export function Card({
  children,
  style,
  padded = true,
  ...props
}: PropsWithChildren<CardProps>) {
  const { theme } = useAppTheme();

  return (
    <View
      {...props}
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          ...theme.shadows.card,
        },
        padded && styles.padded,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
  },
  padded: {
    padding: spacing.lg,
  },
});
