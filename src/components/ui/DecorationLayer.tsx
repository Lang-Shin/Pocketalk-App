import { memo } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/theme';

import {
  SCREEN_DECORATIONS,
  decorationHorizontalPosition,
  decorationOpacity,
  type DecorationAsset,
  type ScreenDecorationPreset,
} from './screenDecorations';

const sources = {
  coin: require('../../../assets/decorations/shinecoin.png'),
  cards: require('../../../assets/decorations/cards.png'),
  money: require('../../../assets/decorations/spongemoney.png'),
  cashbag: require('../../../assets/decorations/cashbag.png'),
  fourleaf: require('../../../assets/decorations/fourleaf.png'),
  moneybottle: require('../../../assets/decorations/moneybottle.png'),
  tororo: require('../../../assets/decorations/tororo.png'),
} satisfies Record<DecorationAsset, unknown>;

export const ScreenDecorations = memo(function ScreenDecorations({
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
                opacity: decorationOpacity(placement, preset, theme.isDark),
                transform: [{ rotate: `${placement.rotation}deg` }],
              },
              decorationHorizontalPosition(placement.side, placement.offset, size),
            ]}
          />
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  artwork: {
    position: 'absolute',
  },
});
