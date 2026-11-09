export type ScreenDecorationPreset = 'home' | 'budgets' | 'wallet' | 'history';
export type DecorationAsset = 'coin' | 'cards' | 'money';

export interface ScreenDecorationPlacement {
  asset: DecorationAsset;
  top: `${number}%`;
  side: 'left' | 'right';
  offset: number;
  scale: number;
  maxSize: number;
  rotation: number;
  darkOpacity: number;
  lightOpacity: number;
}

/**
 * Layered compositions use one stronger illustration and two quieter supporting
 * pieces per screen. Percent-based vertical positions stay intentional as the
 * scroll content height changes; sizes scale from the actual viewport width.
 */
export const SCREEN_DECORATIONS: Record<
  ScreenDecorationPreset,
  readonly ScreenDecorationPlacement[]
> = {
  home: [
    { asset: 'coin', top: '5%', side: 'right', offset: -8, scale: 0.34, maxSize: 168, rotation: 9, darkOpacity: 0.13, lightOpacity: 0.11 },
    { asset: 'cards', top: '34%', side: 'left', offset: -54, scale: 0.4, maxSize: 196, rotation: -12, darkOpacity: 0.1, lightOpacity: 0.085 },
    { asset: 'money', top: '73%', side: 'right', offset: -46, scale: 0.42, maxSize: 206, rotation: -14, darkOpacity: 0.075, lightOpacity: 0.065 },
  ],
  budgets: [
    { asset: 'money', top: '4%', side: 'left', offset: -50, scale: 0.4, maxSize: 196, rotation: 12, darkOpacity: 0.07, lightOpacity: 0.06 },
    { asset: 'coin', top: '37%', side: 'right', offset: -38, scale: 0.32, maxSize: 158, rotation: -10, darkOpacity: 0.12, lightOpacity: 0.1 },
    { asset: 'cards', top: '68%', side: 'left', offset: -44, scale: 0.38, maxSize: 186, rotation: -14, darkOpacity: 0.09, lightOpacity: 0.08 },
  ],
  wallet: [
    { asset: 'cards', top: '5%', side: 'right', offset: -10, scale: 0.36, maxSize: 176, rotation: 11, darkOpacity: 0.13, lightOpacity: 0.11 },
    { asset: 'coin', top: '41%', side: 'left', offset: -40, scale: 0.31, maxSize: 154, rotation: -9, darkOpacity: 0.105, lightOpacity: 0.09 },
    { asset: 'money', top: '73%', side: 'right', offset: -52, scale: 0.41, maxSize: 202, rotation: 14, darkOpacity: 0.075, lightOpacity: 0.065 },
  ],
  history: [
    { asset: 'coin', top: '9%', side: 'left', offset: -30, scale: 0.27, maxSize: 134, rotation: -8, darkOpacity: 0.075, lightOpacity: 0.065 },
    { asset: 'cards', top: '43%', side: 'right', offset: -46, scale: 0.34, maxSize: 168, rotation: 12, darkOpacity: 0.065, lightOpacity: 0.055 },
    { asset: 'money', top: '71%', side: 'left', offset: -50, scale: 0.38, maxSize: 186, rotation: -13, darkOpacity: 0.05, lightOpacity: 0.045 },
  ],
};
