export type ScreenDecorationPreset = 'home' | 'budgets' | 'wallet' | 'history' | 'assistant';

/**
 * Explicit static-asset manifest. Metro cannot scan the directory at runtime,
 * so every supported decoration must be listed here and imported in
 * DecorationLayer.tsx.
 */
export const DECORATION_ASSETS = {
  coin: 'shinecoin.png',
  cards: 'cards.png',
  money: 'spongemoney.png',
  cashbag: 'cashbag.png',
  fourleaf: 'fourleaf.png',
  moneybottle: 'moneybottle.png',
  tororo: 'tororo.png',
} as const;

export type DecorationAsset = keyof typeof DECORATION_ASSETS;

export interface ScreenDecorationPlacement {
  asset: DecorationAsset;
  top: `${number}%`;
  side: 'left' | 'center' | 'right';
  offset: number;
  scale: number;
  maxSize: number;
  rotation: number;
  darkOpacity: number;
  lightOpacity: number;
}

export function decorationHorizontalPosition(
  side: ScreenDecorationPlacement['side'],
  offset: number,
  size: number,
): { left?: number | '50%'; right?: number; marginLeft?: number } {
  if (side === 'center') return { left: '50%', marginLeft: offset - size / 2 };
  return side === 'left' ? { left: offset } : { right: offset };
}

export function decorationOpacity(
  placement: ScreenDecorationPlacement,
  preset: ScreenDecorationPreset,
  isDark: boolean,
): number {
  const base = isDark ? placement.darkOpacity : placement.lightOpacity;
  return preset === 'assistant' ? base : Math.min(base + 0.015, 0.16);
}

/**
 * Seven layered placements per screen: a few stronger focal pieces supported by
 * quieter artwork. Percentage positions distribute pieces through tall scroll
 * content; width-based sizing keeps the composition responsive.
 */
export const SCREEN_DECORATIONS: Record<
  ScreenDecorationPreset,
  readonly ScreenDecorationPlacement[]
> = {
  home: [
    { asset: 'coin', top: '4%', side: 'right', offset: -6, scale: 0.33, maxSize: 168, rotation: 8, darkOpacity: 0.145, lightOpacity: 0.12 },
    { asset: 'cards', top: '21%', side: 'left', offset: -52, scale: 0.38, maxSize: 190, rotation: -11, darkOpacity: 0.115, lightOpacity: 0.095 },
    { asset: 'cashbag', top: '38%', side: 'right', offset: -34, scale: 0.3, maxSize: 150, rotation: 12, darkOpacity: 0.11, lightOpacity: 0.095 },
    { asset: 'fourleaf', top: '51%', side: 'center', offset: 0, scale: 0.29, maxSize: 146, rotation: -9, darkOpacity: 0.1, lightOpacity: 0.085 },
    { asset: 'moneybottle', top: '64%', side: 'right', offset: -48, scale: 0.36, maxSize: 180, rotation: 13, darkOpacity: 0.09, lightOpacity: 0.075 },
    { asset: 'tororo', top: '78%', side: 'left', offset: -36, scale: 0.31, maxSize: 156, rotation: -12, darkOpacity: 0.085, lightOpacity: 0.07 },
    { asset: 'money', top: '88%', side: 'right', offset: -45, scale: 0.34, maxSize: 170, rotation: -15, darkOpacity: 0.09, lightOpacity: 0.075 },
  ],
  budgets: [
    { asset: 'money', top: '3%', side: 'left', offset: -48, scale: 0.36, maxSize: 180, rotation: 12, darkOpacity: 0.09, lightOpacity: 0.075 },
    { asset: 'moneybottle', top: '18%', side: 'right', offset: -38, scale: 0.33, maxSize: 164, rotation: -10, darkOpacity: 0.095, lightOpacity: 0.08 },
    { asset: 'coin', top: '33%', side: 'left', offset: -26, scale: 0.28, maxSize: 140, rotation: -13, darkOpacity: 0.135, lightOpacity: 0.115 },
    { asset: 'tororo', top: '47%', side: 'center', offset: 0, scale: 0.3, maxSize: 150, rotation: 14, darkOpacity: 0.085, lightOpacity: 0.07 },
    { asset: 'cards', top: '61%', side: 'left', offset: -48, scale: 0.35, maxSize: 174, rotation: -12, darkOpacity: 0.1, lightOpacity: 0.085 },
    { asset: 'cashbag', top: '74%', side: 'right', offset: -34, scale: 0.29, maxSize: 146, rotation: 10, darkOpacity: 0.105, lightOpacity: 0.09 },
    { asset: 'fourleaf', top: '86%', side: 'left', offset: -36, scale: 0.27, maxSize: 136, rotation: -15, darkOpacity: 0.09, lightOpacity: 0.075 },
  ],
  wallet: [
    { asset: 'cards', top: '3%', side: 'right', offset: -8, scale: 0.34, maxSize: 170, rotation: 10, darkOpacity: 0.145, lightOpacity: 0.12 },
    { asset: 'moneybottle', top: '17%', side: 'left', offset: -42, scale: 0.32, maxSize: 160, rotation: -12, darkOpacity: 0.1, lightOpacity: 0.085 },
    { asset: 'coin', top: '30%', side: 'right', offset: -32, scale: 0.28, maxSize: 140, rotation: -8, darkOpacity: 0.125, lightOpacity: 0.105 },
    { asset: 'fourleaf', top: '44%', side: 'left', offset: -40, scale: 0.27, maxSize: 136, rotation: 11, darkOpacity: 0.095, lightOpacity: 0.08 },
    { asset: 'money', top: '57%', side: 'center', offset: 0, scale: 0.36, maxSize: 180, rotation: 14, darkOpacity: 0.085, lightOpacity: 0.07 },
    { asset: 'tororo', top: '70%', side: 'left', offset: -34, scale: 0.29, maxSize: 146, rotation: -14, darkOpacity: 0.09, lightOpacity: 0.075 },
    { asset: 'cashbag', top: '84%', side: 'right', offset: -36, scale: 0.3, maxSize: 142, rotation: 9, darkOpacity: 0.11, lightOpacity: 0.095 },
  ],
  history: [
    { asset: 'coin', top: '8%', side: 'left', offset: -28, scale: 0.25, maxSize: 126, rotation: -7, darkOpacity: 0.085, lightOpacity: 0.07 },
    { asset: 'cards', top: '21%', side: 'right', offset: -44, scale: 0.31, maxSize: 150, rotation: 10, darkOpacity: 0.07, lightOpacity: 0.06 },
    { asset: 'moneybottle', top: '34%', side: 'left', offset: -38, scale: 0.27, maxSize: 136, rotation: -11, darkOpacity: 0.06, lightOpacity: 0.05 },
    { asset: 'fourleaf', top: '47%', side: 'right', offset: -40, scale: 0.23, maxSize: 120, rotation: 12, darkOpacity: 0.06, lightOpacity: 0.05 },
    { asset: 'cashbag', top: '60%', side: 'center', offset: 0, scale: 0.24, maxSize: 122, rotation: -9, darkOpacity: 0.07, lightOpacity: 0.06 },
    { asset: 'tororo', top: '74%', side: 'right', offset: -36, scale: 0.26, maxSize: 132, rotation: 13, darkOpacity: 0.055, lightOpacity: 0.045 },
    { asset: 'money', top: '87%', side: 'left', offset: -44, scale: 0.3, maxSize: 150, rotation: -14, darkOpacity: 0.05, lightOpacity: 0.042 },
  ],
  assistant: [
    { asset: 'coin', top: '8%', side: 'right', offset: -24, scale: 0.24, maxSize: 104, rotation: 8, darkOpacity: 0.065, lightOpacity: 0.055 },
    { asset: 'cashbag', top: '32%', side: 'left', offset: -32, scale: 0.22, maxSize: 96, rotation: -9, darkOpacity: 0.05, lightOpacity: 0.04 },
    { asset: 'fourleaf', top: '59%', side: 'center', offset: 0, scale: 0.2, maxSize: 88, rotation: 10, darkOpacity: 0.045, lightOpacity: 0.035 },
    { asset: 'tororo', top: '83%', side: 'right', offset: -30, scale: 0.23, maxSize: 100, rotation: -8, darkOpacity: 0.05, lightOpacity: 0.04 },
  ],
};
