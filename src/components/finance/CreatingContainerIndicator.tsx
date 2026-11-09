import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { radii, spacing, useAppTheme } from '@/theme';

function Dot({ delay, reduced }: { delay: number; reduced: boolean }) {
  const { theme } = useAppTheme();
  const opacity = useSharedValue(reduced ? 0.7 : 0.35);
  useEffect(() => {
    if (reduced) {
      opacity.value = 0.7;
    } else {
      opacity.value = withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 380 }),
            withTiming(0.35, { duration: 380 }),
          ),
          -1,
        ),
      );
    }
    return () => cancelAnimation(opacity);
  }, [delay, opacity, reduced]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[styles.dot, { backgroundColor: theme.colors.primary }, style]}
    />
  );
}

export function CreatingContainerIndicator() {
  const { theme } = useAppTheme();
  const reduced = useReducedMotion();
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel="Creating container"
      accessibilityLiveRegion="polite"
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.primarySoft,
          borderColor: theme.colors.primary,
        },
      ]}
    >
      <View style={styles.dots} accessible={false}>
        {[0, 130, 260].map((delay) => (
          <Dot key={delay} delay={delay} reduced={reduced} />
        ))}
      </View>
      <AppText variant="caption" weight="semibold" color={theme.colors.primarySoftText}>
        Creating container...
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dots: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  dot: { width: 5, height: 5, borderRadius: 3 },
});
