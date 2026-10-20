import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { useAppTheme, radii } from '@/theme';

type ProgressTone = 'primary' | 'success' | 'warning' | 'danger';

interface ProgressBarProps {
  value: number;
  tone?: ProgressTone;
  height?: number;
  accessibilityLabel: string;
}

export function ProgressBar({
  value,
  tone = 'primary',
  height = 8,
  accessibilityLabel,
}: ProgressBarProps) {
  const { theme } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const progress = Math.min(Math.max(value, 0), 1);
  const [animatedValue] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reducedMotion) {
      animatedValue.setValue(progress);
      return;
    }

    Animated.timing(animatedValue, {
      toValue: progress,
      duration: 520,
      useNativeDriver: false,
    }).start();
  }, [animatedValue, progress, reducedMotion]);

  const color =
    tone === 'success'
      ? theme.colors.success
      : tone === 'warning'
        ? theme.colors.warning
        : tone === 'danger'
          ? theme.colors.danger
          : theme.colors.primary;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.round(progress * 100),
      }}
      style={[
        styles.track,
        {
          height,
          backgroundColor: theme.colors.surfaceAlt,
          borderRadius: height / 2,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.fill,
          {
            width: animatedValue.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
            backgroundColor: color,
            borderRadius: height / 2,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
  },
});
