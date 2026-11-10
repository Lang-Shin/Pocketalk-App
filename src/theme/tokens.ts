import type { TextStyle, ViewStyle } from 'react-native';

interface FontFamilySet {
  regular: string;
  medium: string;
  semibold: string;
  bold: string;
  heavy: string;
}

const systemFontFamilies: FontFamilySet = {
  regular: 'System',
  medium: 'System',
  semibold: 'System',
  bold: 'System',
  heavy: 'System',
};

const interFontFamilies: FontFamilySet = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  heavy: 'Inter_800ExtraBold',
};

export function getFontFamilies(platform: string): FontFamilySet {
  return platform === 'ios' || platform === 'macos'
    ? systemFontFamilies
    : interFontFamilies;
}

export const fontFamilies = interFontFamilies;

export const typography = {
  screenHeading: fontFamilies.bold,
  sectionHeading: fontFamilies.semibold,
  financialBalance: fontFamilies.heavy,
  transactionAmount: fontFamilies.bold,
  body: fontFamilies.regular,
  button: fontFamilies.semibold,
  caption: fontFamilies.medium,
  navigation: fontFamilies.semibold,
} as const;

export const fontSizes = {
  display: 34,
  h1: 28,
  h2: 22,
  h3: 17,
  body: 15,
  bodySmall: 13,
  label: 13,
  caption: 12,
  micro: 11,
} as const;

export const lineHeights = {
  display: 40,
  h1: 34,
  h2: 29,
  h3: 24,
  body: 22,
  bodySmall: 19,
  label: 18,
  caption: 17,
  micro: 15,
} as const;

export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const satisfies Record<string, TextStyle['fontWeight']>;

export const spacing = {
  xxs: 4,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 24,
  pill: 999,
} as const;

export const layout = {
  screenPadding: 16,
  maxContentWidth: 760,
  maxWideContentWidth: 1040,
  wideBreakpoint: 1024,
  twoColumnMinWidth: 680,
  touchTarget: 48,
  tabBarMinHeight: 58,
} as const;

export interface GridLayout {
  contentWidth: number;
  columns: 1 | 2;
  cardWidth: number;
}

export function getContentMaxWidth(
  windowWidth: number,
  wide = false,
): number {
  return wide && windowWidth >= layout.wideBreakpoint
    ? layout.maxWideContentWidth
    : layout.maxContentWidth;
}

export function getContentWidth(windowWidth: number, wide = false): number {
  return Math.max(
    0,
    Math.min(windowWidth, getContentMaxWidth(windowWidth, wide)) -
      layout.screenPadding * 2,
  );
}

export function getGridLayout(
  windowWidth: number,
  wide = false,
): GridLayout {
  const contentWidth = getContentWidth(windowWidth, wide);
  const columns: 1 | 2 =
    contentWidth >= layout.twoColumnMinWidth ? 2 : 1;

  return {
    contentWidth,
    columns,
    cardWidth:
      columns === 2 ? (contentWidth - spacing.md) / 2 : contentWidth,
  };
}

export type Tone = 'emerald' | 'amber' | 'coral' | 'blue' | 'violet';

export interface ToneColors {
  background: string;
  foreground: string;
}

export interface AppColors {
  background: string;
  surface: string;
  surfaceAlt: string;
  surfaceMuted: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  primary: string;
  primaryPressed: string;
  onPrimary: string;
  primarySoft: string;
  primarySoftText: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  danger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  heroStart: string;
  heroEnd: string;
  heroText: string;
  heroMuted: string;
  tabInactive: string;
  overlay: string;
  shadow: string;
  skeleton: string;
  categories: Record<Tone, ToneColors>;
}

export interface GlassColors {
  surface: string;
  surfaceStrong: string;
  border: string;
  highlight: string;
  navSurface: string;
  heroSurface: string;
  heroBorder: string;
  sheet: string;
  input: string;
  modalOverlay: string;
}

export interface AppTheme {
  mode: 'light' | 'dark';
  isDark: boolean;
  colors: AppColors;
  glass: GlassColors;
  shadows: {
    card: ViewStyle;
    floating: ViewStyle;
  };
}

const lightColors: AppColors = {
  background: '#F3EEE6',
  surface: '#FFFBF5',
  surfaceAlt: '#EAE1D4',
  surfaceMuted: '#F5EFE7',
  text: '#292629',
  textSecondary: '#5F5852',
  textTertiary: '#6C635B',
  border: '#D9CEC0',
  primary: '#765A33',
  primaryPressed: '#594124',
  onPrimary: '#FFFFFF',
  primarySoft: '#EDE0CC',
  primarySoftText: '#594124',
  accent: '#E39A2B',
  accentSoft: '#FFF1D8',
  accentText: '#6B4400',
  danger: '#B83A45',
  dangerSoft: '#FCE7E9',
  success: '#13784A',
  successSoft: '#DFF4E8',
  warning: '#9A5B00',
  warningSoft: '#FFF4D8',
  heroStart: '#302F32',
  heroEnd: '#302F32',
  heroText: '#FFFFFF',
  heroMuted: '#D4C9B8',
  tabInactive: '#70665C',
  overlay: 'rgba(8, 28, 22, 0.48)',
  shadow: '#0A2A22',
  skeleton: '#E5EDE8',
  categories: {
    emerald: { background: '#E2F4EB', foreground: '#0B6B50' },
    amber: { background: '#FFF1D6', foreground: '#875200' },
    coral: { background: '#FCE8E5', foreground: '#A33B34' },
    blue: { background: '#E6F0FA', foreground: '#215C91' },
    violet: { background: '#F0EAFB', foreground: '#6241A0' },
  },
};

const darkColors: AppColors = {
  background: '#252427',
  surface: '#302F32',
  surfaceAlt: '#39373B',
  surfaceMuted: '#39373B',
  text: '#F2EDE5',
  textSecondary: '#C8C2BB',
  textTertiary: '#B0AAA4',
  border: '#49464A',
  primary: '#D3B88D',
  primaryPressed: '#E4CDA7',
  onPrimary: '#252427',
  primarySoft: '#484034',
  primarySoftText: '#EBD5B2',
  accent: '#D3B88D',
  accentSoft: '#484034',
  accentText: '#EBD5B2',
  danger: '#FF8E98',
  dangerSoft: '#3D1A1E',
  success: '#6ADFA5',
  successSoft: '#10372A',
  warning: '#F4C15C',
  warningSoft: '#3A2A0D',
  heroStart: '#39373B',
  heroEnd: '#39373B',
  heroText: '#F2EDE5',
  heroMuted: '#D8CEC1',
  tabInactive: '#B0AAA4',
  overlay: 'rgba(0, 0, 0, 0.66)',
  shadow: '#000000',
  skeleton: '#49464A',
  categories: {
    emerald: { background: '#173D31', foreground: '#7BE0AD' },
    amber: { background: '#493817', foreground: '#F4C875' },
    coral: { background: '#4C2D30', foreground: '#F5A6A0' },
    blue: { background: '#20394D', foreground: '#9ACAF4' },
    violet: { background: '#3B3050', foreground: '#D1B5F4' },
  },
};

const lightGlass: GlassColors = {
  surface: 'rgba(255, 251, 245, 0.78)',
  surfaceStrong: 'rgba(255, 251, 245, 0.91)',
  border: 'rgba(118, 90, 51, 0.18)',
  highlight: 'rgba(255, 255, 255, 0.64)',
  navSurface: 'rgba(255, 251, 245, 0.9)',
  heroSurface: 'rgba(48, 47, 50, 0.94)',
  heroBorder: 'rgba(211, 184, 141, 0.3)',
  sheet: 'rgba(255, 251, 245, 0.97)',
  input: 'rgba(245, 239, 231, 0.78)',
  modalOverlay: 'rgba(30, 25, 20, 0.34)',
};

const darkGlass: GlassColors = {
  surface: 'rgba(57, 55, 59, 0.72)',
  surfaceStrong: 'rgba(57, 55, 59, 0.88)',
  border: 'rgba(211, 184, 141, 0.18)',
  highlight: 'rgba(255, 255, 255, 0.08)',
  navSurface: 'rgba(48, 47, 50, 0.9)',
  heroSurface: 'rgba(57, 55, 59, 0.88)',
  heroBorder: 'rgba(211, 184, 141, 0.24)',
  sheet: 'rgba(48, 47, 50, 0.98)',
  input: 'rgba(57, 55, 59, 0.64)',
  modalOverlay: 'rgba(0, 0, 0, 0.38)',
};

export function createTheme(mode: 'light' | 'dark'): AppTheme {
  const isDark = mode === 'dark';
  const colors = isDark ? darkColors : lightColors;

  return {
    mode,
    isDark,
    colors,
    glass: isDark ? darkGlass : lightGlass,
    shadows: {
      card: {
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0,
        shadowRadius: 16,
        elevation: 0,
      },
      floating: {
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: isDark ? 0.3 : 0.12,
        shadowRadius: 24,
        elevation: isDark ? 3 : 5,
      },
    },
  };
}
