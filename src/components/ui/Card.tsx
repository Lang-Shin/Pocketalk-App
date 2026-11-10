import type { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

import { useAppTheme, radii, spacing } from '@/theme';
import { FrostedBackground } from './FrostedBackground';

interface CardProps extends ViewProps {
  padded?: boolean;
  variant?: 'solid' | 'glass';
  frosted?: boolean;
}

export function Card({
  children,
  style,
  padded = true,
  variant = 'solid',
  frosted = false,
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
          backgroundColor: isGlass && frosted && Platform.OS === 'ios'
            ? 'transparent'
            : isGlass
            ? theme.glass.surface
            : theme.colors.surface,
          borderColor: isGlass ? theme.glass.border : theme.colors.border,
          ...theme.shadows.card,
        },
        padded && styles.padded,
        style,
      ]}
    >
      {isGlass && frosted ? (
        <FrostedBackground color={theme.glass.surface} radius={radii.md} />
      ) : null}
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
