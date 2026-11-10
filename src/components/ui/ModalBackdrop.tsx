import { BlurView } from 'expo-blur';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/theme';

interface ModalBackdropProps {
  onDismiss: () => void;
  dismissLabel: string;
}

export function ModalBackdrop({
  onDismiss,
  dismissLabel,
}: ModalBackdropProps) {
  const { theme } = useAppTheme();
  const useBackdropBlur = Platform.OS === 'ios';

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {useBackdropBlur ? (
        <BlurView
          intensity={theme.isDark ? 20 : 16}
          tint={theme.isDark ? 'dark' : 'light'}
          pointerEvents="none"
          accessible={false}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: useBackdropBlur
              ? theme.glass.modalOverlay
              : theme.colors.overlay,
          },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={dismissLabel}
        onPress={onDismiss}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
