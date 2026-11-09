import { Image, StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/theme';

import {
  SCREEN_DECORATIONS,
  type DecorationAsset,
  type ScreenDecorationPreset,
} from './screenDecorations';

const sources = {
  coin: require('../../../assets/decorations/shinecoin.png'),
  cards: require('../../../assets/decorations/cards.png'),
  money: require('../../../assets/decorations/spongemoney.png'),
} satisfies Record<DecorationAsset, unknown>;

export function ScreenDecorations({
  preset,
  width,
}: {
  preset: ScreenDecorationPreset;
  width: number;
}) {
  const { theme } = useAppTheme();

  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      {SCREEN_DECORATIONS[preset].map((placement, index) => {
        const size = Math.min(width * placement.scale, placement.maxSize);
        return (
          <Image
            key={`${preset}-${placement.asset}-${index}`}
            source={sources[placement.asset]}
            resizeMode="contain"
            accessible={false}
            style={[
              styles.artwork,
              {
                width: size,
                height: size,
                top: placement.top,
                opacity: theme.isDark
                  ? placement.darkOpacity
                  : placement.lightOpacity,
                transform: [{ rotate: `${placement.rotation}deg` }],
              },
              placement.side === 'left'
                ? { left: placement.offset }
                : { right: placement.offset },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  artwork: {
    position: 'absolute',
  },
});
