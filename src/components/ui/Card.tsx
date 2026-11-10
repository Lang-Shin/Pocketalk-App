import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { useAppTheme, radii, spacing } from '@/theme';

interface CardProps extends ViewProps {
  padded?: boolean;
  variant?: 'solid' | 'glass';
}

export function Card({
  children,
  style,
  padded = true,
  variant = 'solid',
  ...props
}: PropsWithChildren<CardProps>) {
  const { theme } = useAppTheme();
  const isGlass = variant === 'glass';

  return (
    <View
      {...props}
      style={[
        styles.card,
        {
          backgroundColor: isGlass
            ? theme.glass.surface
            : theme.colors.surface,
          borderColor: isGlass ? theme.glass.border : theme.colors.border,
          ...theme.shadows.card,
        },
        padded && styles.padded,
        style,
      ]}
    >
      {isGlass ? (
        <View
          pointerEvents="none"
          accessible={false}
          style={[styles.highlight, { backgroundColor: theme.glass.highlight }]}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
  },
  padded: {
    padding: spacing.lg,
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: spacing.lg,
    right: spacing.lg,
    height: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
  },
});
