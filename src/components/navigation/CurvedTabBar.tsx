import { Tabs } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { spacing, useAppTheme } from '@/theme';
import { BAR_HEIGHT, BAR_TOP, INDICATOR_SIZE, curvedBarPath, tabCenter } from './tabGeometry';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];
const AnimatedPath = Animated.createAnimatedComponent(Path);

export function CurvedTabBar({ state, descriptors, navigation, insets }: TabBarProps) {
  const { theme } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());
  const active = useSharedValue(state.index);

  useEffect(() => {
    active.value = reduceMotion
      ? state.index
      : withTiming(state.index, { duration: 300, easing: Easing.inOut(Easing.cubic) });
  }, [active, reduceMotion, state.index]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const pathProps = useAnimatedProps(() => ({
    d: curvedBarPath(width, tabCenter(width, active.value, state.routes.length), state.routes.length),
  }));
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tabCenter(width, active.value, state.routes.length) - INDICATOR_SIZE / 2 }],
  }));

  if (keyboardVisible) return null;

  return (
    <View style={[styles.outer, { paddingBottom: insets.bottom }]}>
      <View style={styles.bar} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 ? (
          <>
            <Svg width={width} height={BAR_TOP + BAR_HEIGHT} style={StyleSheet.absoluteFill} pointerEvents="none">
              <AnimatedPath animatedProps={pathProps} fill={theme.colors.surface} stroke={theme.colors.border} strokeWidth={1} />
            </Svg>
            <Animated.View pointerEvents="none" style={[styles.indicator, { backgroundColor: theme.colors.primary }, indicatorStyle]} />
          </>
        ) : null}
        <View style={styles.tabs}>
          {state.routes.map((route, index) => {
            const descriptor = descriptors[route.key];
            if (!descriptor) return null;
            const options = descriptor.options;
            const focused = state.index === index;
            const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : options.title ?? route.name;
            const onPress = () => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
            };
            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
                accessibilityState={{ selected: focused }}
                onPress={onPress}
                onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
                style={styles.tab}
              >
                <TabIcon index={index} progress={active} renderIcon={options.tabBarIcon} activeColor={theme.colors.onPrimary} inactiveColor={theme.colors.tabInactive} />
                <AppText variant="micro" numberOfLines={1} color={focused ? theme.colors.primary : theme.colors.tabInactive}>
                  {label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function TabIcon({ index, progress, renderIcon, activeColor, inactiveColor }: {
  index: number;
  progress: SharedValue<number>;
  renderIcon: TabBarProps['descriptors'][string]['options']['tabBarIcon'];
  activeColor: string;
  inactiveColor: string;
}) {
  const motion = useAnimatedStyle(() => {
    const emphasis = interpolate(progress.value, [index - 1, index, index + 1], [0, 1, 0], Extrapolation.CLAMP);
    return { transform: [{ translateY: -31 * emphasis }] };
  });
  const activeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [index - 1, index, index + 1], [0, 1, 0], Extrapolation.CLAMP),
  }));
  const inactiveStyle = useAnimatedStyle(() => ({
    opacity: 1 - interpolate(progress.value, [index - 1, index, index + 1], [0, 1, 0], Extrapolation.CLAMP),
  }));
  return (
    <Animated.View style={[styles.icon, motion]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.iconInner, inactiveStyle]}>
        {renderIcon?.({ focused: false, color: inactiveColor, size: 22 })}
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.iconInner, activeStyle]}>
        {renderIcon?.({ focused: true, color: activeColor, size: 22 })}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  outer: { paddingHorizontal: spacing.lg },
  bar: { height: BAR_TOP + BAR_HEIGHT, width: '100%' },
  indicator: { position: 'absolute', top: 0, left: 0, width: INDICATOR_SIZE, height: INDICATOR_SIZE, borderRadius: INDICATOR_SIZE / 2 },
  tabs: { position: 'absolute', left: 0, right: 0, top: BAR_TOP, bottom: 0, flexDirection: 'row' },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', paddingTop: 16, gap: 2 },
  icon: { width: 26, height: 26 },
  iconInner: { alignItems: 'center', justifyContent: 'center' },
});
