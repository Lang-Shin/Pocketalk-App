import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/theme';

// Android and web retain the existing translucent surface without native blur.
export function FrostedBackground({ color, radius }: { color: string; radius: number }) {
  const { theme } = useAppTheme();
  if (Platform.OS !== 'ios') return null;

  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}
    >
      <BlurView
        intensity={8}
        tint={theme.isDark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: color }]} />
    </View>
  );
}
