import { useEffect, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { ScreenDecorations } from '@/components/ui/DecorationLayer';
import { radii, useAppTheme } from '@/theme';
import { LAUNCH_FADE_MS, launchExitDuration, scheduleLaunchExit } from './launchTiming';

export function LaunchExperience() {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(true);
  const [opacity] = useState(() => new Animated.Value(1));
  const [logoOpacity] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));

  useEffect(() => {
    let mounted = true;
    if (reducedMotion) {
      logoOpacity.setValue(1);
    } else {
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: LAUNCH_FADE_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    }
    const cancel = scheduleLaunchExit(() => {
      const duration = launchExitDuration(reducedMotion);
      if (duration === 0) {
        if (mounted) setVisible(false);
        return;
      }
      Animated.timing(opacity, {
        toValue: 0,
        duration,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (mounted && finished) setVisible(false);
      });
    });
    return () => {
      mounted = false;
      cancel();
      opacity.stopAnimation();
      logoOpacity.stopAnimation();
    };
  }, [logoOpacity, opacity, reducedMotion]);

  if (!visible) return null;
  return (
    <Animated.View
      accessibilityViewIsModal
      style={[styles.overlay, { backgroundColor: theme.colors.background, opacity }]}
    >
      <View pointerEvents="none" accessible={false} style={styles.decorations}>
        <ScreenDecorations preset="home" width={width} />
      </View>
      <Animated.View style={[styles.logoSurface, { backgroundColor: theme.glass.surfaceStrong, borderColor: theme.glass.border, opacity: logoOpacity }]}>
        <Image
          source={require('../../../assets/branding/Pocketa.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Pocketa"
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 100, alignItems: 'center', justifyContent: 'center' },
  decorations: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.3 },
  logoSurface: { width: '76%', maxWidth: 300, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radii.xxl, borderWidth: StyleSheet.hairlineWidth },
  logo: { width: '88%', height: '88%' },
});
