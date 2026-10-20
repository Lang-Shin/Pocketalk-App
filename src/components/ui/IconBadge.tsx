import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import type { IconName } from '@/lib/icons';
import { useAppTheme, type Tone } from '@/theme';

interface IconBadgeProps {
  icon: IconName;
  tone?: Tone;
  size?: number;
  iconSize?: number;
}

export function IconBadge({
  icon,
  tone = 'emerald',
  size = 44,
  iconSize = 20,
}: IconBadgeProps) {
  const { theme } = useAppTheme();
  const toneColors = theme.colors.categories[tone];

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: toneColors.background,
        },
      ]}
    >
      <Ionicons name={icon} size={iconSize} color={toneColors.foreground} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
