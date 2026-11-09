import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { radii, spacing, useAppTheme } from '@/theme';

function ThinkingDot({ delay, color, reduced }: { delay: number; color: string; reduced: boolean }) {
  const opacity = useSharedValue(reduced ? 0.7 : 0.35);
  useEffect(() => {
    if (reduced) {
      opacity.value = 0.7;
    } else {
      opacity.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 380 }), withTiming(0.35, { duration: 380 })), -1));
    }
    return () => cancelAnimation(opacity);
  }, [delay, opacity, reduced]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.dot, { backgroundColor: color }, animated]} />;
}

export function AssistantThinkingIndicator() {
  const { theme } = useAppTheme();
  const reduced = useReducedMotion();
  return (
    <View accessibilityRole="text" accessibilityLabel="Assistant is thinking" accessibilityLiveRegion="polite" style={[styles.container, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <View style={styles.dots} accessible={false}>
        {[0, 130, 260].map((delay) => <ThinkingDot key={delay} delay={delay} color={theme.colors.primary} reduced={reduced} />)}
      </View>
      <AppText variant="caption" color={theme.colors.textSecondary}>Thinking…</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  dots: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  dot: { width: 5, height: 5, borderRadius: 3 },
});
